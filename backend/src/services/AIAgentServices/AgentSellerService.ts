import AIAgent from "../../models/AIAgent";
import Whatsapp from "../../models/Whatsapp";
import GetDefaultWhatsApp from "../../helpers/GetDefaultWhatsApp";
import { SendMessage } from "../../helpers/SendMessage";
import * as EvoHubProvider from "../EvoHubServices/EvoHubProvider";
import { logger } from "../../utils/logger";

/**
 * Rodízio de vendedores + handoff do lead via WhatsApp do PRÓPRIO vendedor.
 *
 * Em vez de o vendedor pegar o ticket na plataforma, ao transferir o agente
 * escolhe um vendedor (por preferência do cliente OU por round-robin) e manda
 * uma mensagem no WhatsApp dele com o contexto do lead e um link para chamar o
 * cliente. O vendedor atende do número próprio.
 *
 * Tudo best-effort: falha de envio NUNCA quebra a transferência.
 */

export interface SellerConfig {
  nome: string;
  numero: string; // só dígitos (com DDI/DDD), ex.: 5516999998888
  aliases?: string[];
  ativo?: boolean;
}

const stripAccents = (s: string): string =>
  (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "");
const norm = (s: string): string =>
  stripAccents(String(s || "")).toLowerCase().trim();
const onlyDigits = (s: string): string => String(s || "").replace(/\D/g, "");

/** Vendedores ativos e com número válido. */
function activeSellers(agent: AIAgent): SellerConfig[] {
  const list = Array.isArray(agent.sellers) ? agent.sellers : [];
  return list
    .map((s: any) => ({
      nome: String(s?.nome || "").trim(),
      numero: onlyDigits(s?.numero),
      aliases: Array.isArray(s?.aliases) ? s.aliases : [],
      ativo: s?.ativo === undefined ? true : !!s.ativo
    }))
    .filter(s => s.ativo && s.numero && s.nome);
}

/**
 * Descobre um agente com rodízio de vendedores configurado para a empresa —
 * usado quando o handoff NÃO parte de uma fila de IA (ex.: lead de campanha que
 * tocou num botão e não tem agente vinculado). Preferência: um agente ativo com
 * vendedores; senão qualquer agente ativo da empresa.
 */
export async function resolveSellerAgent(
  companyId: number
): Promise<AIAgent | null> {
  try {
    const agents = await AIAgent.findAll({
      where: { companyId, isActive: true },
      order: [["id", "ASC"]]
    });
    const withSellers = agents.find(a => activeSellers(a).length > 0);
    return withSellers || agents[0] || null;
  } catch (err: any) {
    logger.error(
      `[Agente IA][rodízio] falha ao resolver agente de vendedores: ${err?.message}`
    );
    return null;
  }
}

/** Casa o nome de preferência do cliente com um vendedor (nome ou alias). */
function matchPreference(
  sellers: SellerConfig[],
  preference: string
): SellerConfig | null {
  const p = norm(preference);
  if (!p) return null;
  return (
    sellers.find(s => {
      const names = [s.nome, ...(s.aliases || [])].map(norm);
      return names.some(n => n && (n === p || n.includes(p) || p.includes(n)));
    }) || null
  );
}

/** Monta a mensagem de handoff enviada ao vendedor. */
function buildHandoffMessage(params: {
  sellerName: string;
  contactName: string;
  contactNumber: string;
  motivo?: string;
  viaPreference: boolean;
}): string {
  const { sellerName, contactName, contactNumber, motivo, viaPreference } =
    params;
  const num = onlyDigits(contactNumber);
  const linha = (label: string, val?: string) =>
    val ? `${label}: ${val}\n` : "";
  return (
    `🚗 *Novo lead — Francauto (via Xistinho)*\n` +
    `Olá, ${sellerName.split(" ")[0]}!\n\n` +
    linha("👤 Cliente", contactName || "—") +
    linha("📱 WhatsApp", contactNumber || "—") +
    (motivo ? `📝 Contexto: ${motivo}\n` : "") +
    (viaPreference ? "⭐ O cliente pediu você.\n" : "🔁 Rodízio automático.\n") +
    (num ? `\n➡️ Chamar o cliente: https://wa.me/${num}\n` : "") +
    `\nResponda o quanto antes 🙌`
  );
}

export interface HandoffResult {
  sellerName: string;
  viaPreference: boolean;
}

/**
 * Envia a mensagem ao vendedor pelo canal da conexão.
 *  - Baileys: texto livre (SendMessage).
 *  - Oficial (EvoHub): se houver template configurado, usa o template (1 var no
 *    body) — único jeito garantido FORA da janela de 24h. Senão tenta texto
 *    livre (só funciona se o vendedor falou com a empresa nas últimas 24h).
 * Nunca lança para fora: devolve true/false.
 */
async function sendToSeller(
  connection: Whatsapp,
  numero: string,
  body: string,
  agent: AIAgent
): Promise<boolean> {
  try {
    if (connection && connection.channel === "whatsapp_oficial") {
      const tpl = String(agent.sellerTemplateName || "").trim();
      if (tpl) {
        const lang = String(agent.sellerTemplateLang || "pt_BR").trim() || "pt_BR";
        // Parâmetros de template NÃO podem ter quebra de linha: compacta tudo.
        const compact = body
          .replace(/\s*\n\s*/g, " · ")
          .replace(/\s{2,}/g, " ")
          .trim();
        await EvoHubProvider.sendTemplate(connection, numero, tpl, lang, [
          { type: "body", parameters: [{ type: "text", text: compact }] }
        ]);
        return true;
      }
      await EvoHubProvider.sendText(connection, numero, body);
      return true;
    }
    // Baileys (ou canal não-oficial)
    await SendMessage(connection, { number: numero, body });
    return true;
  } catch (err: any) {
    logger.error(
      `[Agente IA][rodízio] falha ao enviar aviso ao vendedor (${
        connection?.channel || "?"
      }): ${err?.message}. ${
        connection?.channel === "whatsapp_oficial"
          ? "No canal oficial, fora da janela de 24h é preciso um template aprovado (configure sellerTemplateName)."
          : ""
      }`
    );
    return false;
  }
}

/**
 * Escolhe o vendedor (preferência -> rodízio) e o avisa no WhatsApp dele.
 * Atualiza o ponteiro do rodízio quando a escolha foi por round-robin.
 * Retorna o vendedor avisado, ou null se não houver vendedor/for falha.
 */
export async function handoffToSeller(params: {
  agent: AIAgent;
  companyId: number;
  contactName: string;
  contactNumber: string;
  motivo?: string;
  preference?: string;
  whatsappId?: number; // conexão do ticket (preferida p/ enviar o aviso)
}): Promise<HandoffResult | null> {
  const {
    agent,
    companyId,
    contactName,
    contactNumber,
    motivo,
    preference,
    whatsappId
  } = params;
  try {
    const sellers = activeSellers(agent);
    if (!sellers.length) return null; // rodízio não configurado

    let seller: SellerConfig | null = null;
    let viaPreference = false;

    if (preference) {
      seller = matchPreference(sellers, preference);
      if (seller) viaPreference = true;
    }

    if (!seller) {
      const idx = (Number(agent.sellerRotationIndex) || 0) % sellers.length;
      seller = sellers[idx];
      // avança o ponteiro do rodízio (só quando foi round-robin)
      try {
        await agent.update({ sellerRotationIndex: idx + 1 });
      } catch (e) {
        // não crítico
      }
    }

    const body = buildHandoffMessage({
      sellerName: seller.nome,
      contactName,
      contactNumber,
      motivo,
      viaPreference
    });

    // Conexão do aviso: 1) a configurada (ideal: Baileys secundário interno);
    // 2) a do ticket; 3) a padrão da empresa.
    let connection: Whatsapp | null = null;
    const notifyId = Number(agent.sellerNotifyWhatsappId) || 0;
    if (notifyId) connection = await Whatsapp.findByPk(notifyId);
    if (!connection && whatsappId) connection = await Whatsapp.findByPk(whatsappId);
    if (!connection) connection = await GetDefaultWhatsApp(companyId);

    const sent = await sendToSeller(connection, seller.numero, body, agent);
    if (!sent) return null;

    logger.info(
      `[Agente IA][rodízio] lead enviado ao vendedor ${seller.nome} (${
        viaPreference ? "preferência" : "rodízio"
      }) via ${connection?.channel || "?"}.`
    );
    return { sellerName: seller.nome, viaPreference };
  } catch (err: any) {
    logger.error(
      `[Agente IA][rodízio] falha ao avisar vendedor: ${err?.message}`
    );
    return null;
  }
}
