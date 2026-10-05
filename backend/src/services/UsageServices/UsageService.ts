import { Op } from "sequelize";
import MessageUsage from "../../models/MessageUsage";
import Whatsapp from "../../models/Whatsapp";
import { logger } from "../../utils/logger";

/**
 * Controle de uso/custo do canal oficial (EvoHub / Cloud API).
 *
 * Contabiliza mensagens de SERVIÇO (atendimento) enviadas por número, por mês,
 * calcula o custo estimado em R$ (com franquia grátis) e decide o bloqueio de
 * novos envios quando o limite mensal é atingido.
 *
 * Regras de bloqueio (mensagens de serviço):
 *  - bloqueio manual do admin (usageManualBlock) -> bloqueado;
 *  - limite mensal definido e atingido -> bloqueado, A NÃO SER que o admin tenha
 *    liberado o mês corrente (usageOverridePeriod === período atual);
 *  - ao virar o mês, a contagem zera (nova linha de período) e o override perde
 *    a validade -> o limite volta a valer sozinho.
 */

export type UsageCategory =
  | "service"
  | "marketing"
  | "utility"
  | "authentication";

/** Período de cobrança no formato "YYYY-MM" (mês corrente). */
export function getCurrentPeriod(date = new Date()): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  return `${year}-${month}`;
}

/** Total de mensagens de uma categoria no período (0 se não houver registro). */
export async function getUsageCount(
  whatsappId: number,
  category: UsageCategory = "service",
  period: string = getCurrentPeriod()
): Promise<number> {
  const row = await MessageUsage.findOne({
    where: { whatsappId, period, category }
  });
  return row?.count ?? 0;
}

/**
 * Incrementa o contador de uma categoria de forma atômica (sem corrida entre
 * envios simultâneos). Cria a linha do período se ainda não existir.
 */
export async function incrementUsage(
  whatsapp: Whatsapp,
  category: UsageCategory = "service",
  amount = 1
): Promise<void> {
  const period = getCurrentPeriod();
  try {
    const [row] = await MessageUsage.findOrCreate({
      where: { whatsappId: whatsapp.id, period, category },
      defaults: {
        whatsappId: whatsapp.id,
        companyId: whatsapp.companyId,
        period,
        category,
        count: 0
      } as any
    });
    await row.increment("count", { by: amount });
  } catch (err) {
    // Nunca deixar a contabilização derrubar o envio.
    logger.error(
      `[Uso] falha ao incrementar contador conexao=${whatsapp.id} categoria=${category}: ${
        (err as Error)?.message
      }`
    );
  }
}

/** Diz se a conexão está com o envio de SERVIÇO bloqueado no período atual. */
export function isServiceBlocked(
  whatsapp: Whatsapp,
  serviceCount: number,
  period: string = getCurrentPeriod()
): boolean {
  if (whatsapp.usageManualBlock) return true;

  const limit = whatsapp.serviceMonthlyLimit;
  if (limit === null || limit === undefined || Number(limit) <= 0) {
    return false; // sem limite configurado
  }

  const overridden = whatsapp.usageOverridePeriod === period;
  if (overridden) return false; // admin liberou este mês

  return serviceCount >= Number(limit);
}

/**
 * Verifica, ANTES de enviar, se a conexão pode enviar uma mensagem de serviço.
 * Lança erro (capturado pelo chamador) quando bloqueado, para não enviar.
 */
export async function assertServiceSendAllowed(
  whatsapp: Whatsapp
): Promise<void> {
  if (whatsapp.channel !== "whatsapp_oficial") return;
  const count = await getUsageCount(whatsapp.id, "service");
  if (isServiceBlocked(whatsapp, count)) {
    const reason = whatsapp.usageManualBlock
      ? "bloqueio manual do admin"
      : "limite mensal de mensagens atingido";
    const error: any = new Error(
      `[Uso] envio bloqueado na conexao ${whatsapp.id}: ${reason}`
    );
    error.usageBlocked = true;
    error.reason = reason;
    throw error;
  }
}

const toNumber = (v: any): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Resumo de uso/custo de UMA conexão oficial no mês corrente, para a tela de
 * Custos. Custo de serviço = mensagens acima da franquia * preço de serviço.
 */
export async function buildUsageSummary(whatsapp: Whatsapp) {
  const period = getCurrentPeriod();

  const rows = await MessageUsage.findAll({
    where: { whatsappId: whatsapp.id, period }
  });

  const counts: Record<string, number> = {
    service: 0,
    marketing: 0,
    utility: 0,
    authentication: 0
  };
  rows.forEach(r => {
    counts[r.category] = (counts[r.category] || 0) + r.count;
  });

  const freeTier = toNumber(whatsapp.serviceFreeTier);
  const serviceCount = counts.service;
  const serviceBillable = Math.max(0, serviceCount - freeTier);

  const priceService = toNumber(whatsapp.priceService);
  const priceMarketing = toNumber(whatsapp.priceMarketing);
  const priceUtility = toNumber(whatsapp.priceUtility);
  const priceAuthentication = toNumber(whatsapp.priceAuthentication);

  const costService = serviceBillable * priceService;
  const costMarketing = counts.marketing * priceMarketing;
  const costUtility = counts.utility * priceUtility;
  const costAuthentication = counts.authentication * priceAuthentication;
  const costTotal =
    costService + costMarketing + costUtility + costAuthentication;

  const limit =
    whatsapp.serviceMonthlyLimit === null ||
    whatsapp.serviceMonthlyLimit === undefined
      ? null
      : Number(whatsapp.serviceMonthlyLimit);

  const blocked = isServiceBlocked(whatsapp, serviceCount, period);

  return {
    whatsappId: whatsapp.id,
    name: whatsapp.name,
    period,
    counts,
    serviceCount,
    freeTier,
    serviceBillable,
    limit,
    manualBlock: !!whatsapp.usageManualBlock,
    overrideActive: whatsapp.usageOverridePeriod === period,
    blocked,
    prices: {
      service: priceService,
      marketing: priceMarketing,
      utility: priceUtility,
      authentication: priceAuthentication
    },
    cost: {
      service: costService,
      marketing: costMarketing,
      utility: costUtility,
      authentication: costAuthentication,
      total: costTotal
    }
  };
}

/** Resumo de todas as conexões oficiais de uma empresa. */
export async function listOfficialUsage(companyId: number) {
  const connections = await Whatsapp.findAll({
    where: { companyId, channel: "whatsapp_oficial" },
    order: [["name", "ASC"]]
  });
  return Promise.all(connections.map(c => buildUsageSummary(c)));
}

/** Histórico de períodos anteriores (para gráfico/relatório), opcional. */
export async function listUsageHistory(
  whatsappId: number,
  limitMonths = 6
) {
  return MessageUsage.findAll({
    where: { whatsappId, category: { [Op.ne]: null } },
    order: [["period", "DESC"]],
    limit: limitMonths * 4
  });
}
