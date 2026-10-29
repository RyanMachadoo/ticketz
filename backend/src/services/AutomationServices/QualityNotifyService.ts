import Whatsapp from "../../models/Whatsapp";
import AutomationEnrollment from "../../models/AutomationEnrollment";
import AutomationStep from "../../models/AutomationStep";
import AutomationJourney from "../../models/AutomationJourney";
import GetDefaultWhatsApp from "../../helpers/GetDefaultWhatsApp";
import { SendMessage } from "../../helpers/SendMessage";
import { GetCompanySetting } from "../../helpers/CheckSettings";
import { logger } from "../../utils/logger";

const onlyDigits = (s: string): string => String(s || "").replace(/\D/g, "");

/** Resolve a conexão OFICIAL da jornada (ou a 1ª oficial da empresa). */
async function resolveOfficialConnection(
  companyId: number,
  journeyId: number
): Promise<Whatsapp | null> {
  try {
    const journey = await AutomationJourney.findByPk(journeyId);
    if (journey?.whatsappId) {
      const w = await Whatsapp.findByPk(journey.whatsappId);
      if (w) return w;
    }
  } catch (e) {
    // best-effort
  }
  return Whatsapp.findOne({ where: { companyId, channel: "whatsapp_oficial" } });
}

/**
 * Avisa o responsável de QUALIDADE (número fixo, via conexão Baileys) quando um
 * cliente dá nota baixa (banda 1-4) numa pesquisa de automação.
 *
 * Roteamento (fonte preferida = a CONEXÃO; settings como fallback):
 *   conexão oficial.qualityNumber     -> número do responsável
 *   conexão oficial.notifyWhatsappId  -> conexão (Baileys) que envia o aviso
 *   fallback: settings automationQualityNumber / automationQualityWhatsappId
 * Best-effort: nunca lança.
 */
export async function notifyQuality(params: {
  companyId: number;
  enrollment: AutomationEnrollment;
  step: AutomationStep;
  band: string;
  buttonText: string;
}): Promise<boolean> {
  const { companyId, enrollment, step, band, buttonText } = params;
  try {
    const official = await resolveOfficialConnection(
      companyId,
      enrollment.journeyId
    );

    // Número do responsável: conexão primeiro, settings como fallback.
    let number = onlyDigits(official?.qualityNumber || "");
    if (!number) {
      const numberRaw = await GetCompanySetting(
        companyId,
        "automationQualityNumber",
        ""
      );
      number = onlyDigits(numberRaw);
    }
    if (!number) {
      logger.warn(
        `[Automação][qualidade] número de qualidade não configurado (nem na conexão, nem em settings) — aviso não enviado (enrollment=${enrollment.id}).`
      );
      return false;
    }

    // Conexão do aviso: notifyWhatsappId da conexão, senão settings, senão padrão.
    let notifyId = Number(official?.notifyWhatsappId) || 0;
    if (!notifyId) {
      const raw = await GetCompanySetting(
        companyId,
        "automationQualityWhatsappId",
        ""
      );
      notifyId = Number(raw) || 0;
    }
    let connection: Whatsapp | null = null;
    if (notifyId) connection = await Whatsapp.findByPk(notifyId);
    if (!connection) connection = await GetDefaultWhatsApp(companyId);
    if (!connection) {
      logger.warn(
        `[Automação][qualidade] sem conexão para enviar o aviso (enrollment=${enrollment.id}).`
      );
      return false;
    }

    const data = enrollment.data || {};
    const linhas = [
      "⚠️ *Qualidade — nota baixa na pesquisa*",
      `Cliente: ${enrollment.contactName || "-"} (${enrollment.contactNumber})`,
      `Pesquisa: ${step.name} — resposta: "${buttonText}" (banda ${band})`,
      enrollment.externalRef ? `Ref (O.S./venda): ${enrollment.externalRef}` : "",
      data.loja ? `Loja: ${data.loja}` : "",
      data.modelo ? `Modelo: ${data.modelo}` : "",
      "",
      `Entre em contato com o cliente: https://wa.me/${enrollment.contactNumber}`
    ].filter(Boolean);
    const body = linhas.join("\n");

    await SendMessage(connection, { number, body });
    logger.info(
      `[Automação][qualidade] aviso enviado ao responsável (${number}) via conexão ${connection.id} (enrollment=${enrollment.id}).`
    );
    return true;
  } catch (err: any) {
    logger.error(
      `[Automação][qualidade] falha ao avisar qualidade (enrollment=${params.enrollment?.id}): ${err?.message}`
    );
    return false;
  }
}

export default notifyQuality;
