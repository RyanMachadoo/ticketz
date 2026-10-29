import Whatsapp from "../../models/Whatsapp";
import AutomationStep from "../../models/AutomationStep";
import AutomationEnrollment from "../../models/AutomationEnrollment";
import * as EvoHubProvider from "../EvoHubServices/EvoHubProvider";
import { logger } from "../../utils/logger";

export interface SendStepResult {
  ok: boolean;
  wamid?: string | null;
  skipped?: boolean;
  error?: string;
}

/** Substitui tokens {nome}, {numero}, {modelo} e {chave} vindos de data. */
function processToken(
  text: string,
  enrollment: AutomationEnrollment
): string {
  let out = String(text || "");
  out = out.replace(/\{nome\}/g, enrollment.contactName || "");
  out = out.replace(/\{numero\}/g, enrollment.contactNumber || "");
  const data = enrollment.data || {};
  out = out.replace(/\{([a-zA-Z0-9_]+)\}/g, (_m, k) =>
    data[k] !== undefined && data[k] !== null ? String(data[k]) : `{${k}}`
  );
  return out;
}

/** Conexão oficial para enviar: a da jornada, senão a oficial padrão da empresa. */
async function resolveConnection(
  companyId: number,
  whatsappId?: number | null
): Promise<Whatsapp | null> {
  if (whatsappId) {
    const w = await Whatsapp.findByPk(whatsappId);
    if (w) return w;
  }
  return Whatsapp.findOne({
    where: { companyId, channel: "whatsapp_oficial" }
  });
}

/**
 * Envia a mensagem de um passo (template da Meta). Retorna skipped quando o
 * passo não tem template vinculado ou não há conexão oficial — sem erro (o Ryan
 * ainda vai vincular). Erros reais voltam com ok=false para o worker retentar.
 */
export async function sendStep(
  step: AutomationStep,
  enrollment: AutomationEnrollment,
  journeyWhatsappId?: number | null
): Promise<SendStepResult> {
  if (!step.templateName) {
    logger.info(
      `[Automação] passo '${step.key}' sem template vinculado — pulado (enrollment=${enrollment.id}).`
    );
    return { ok: false, skipped: true };
  }

  const connection = await resolveConnection(
    enrollment.companyId,
    journeyWhatsappId
  );
  if (!connection) {
    logger.warn(
      `[Automação] sem conexão oficial (EvoHub) para a empresa ${enrollment.companyId} — passo '${step.key}' pulado.`
    );
    return { ok: false, skipped: true };
  }
  if (connection.channel !== "whatsapp_oficial") {
    logger.warn(
      `[Automação] conexão ${connection.id} não é oficial — automações exigem template oficial.`
    );
    return { ok: false, skipped: true };
  }

  const params = (Array.isArray(step.templateParams) ? step.templateParams : [])
    .map(p => processToken(String(p ?? ""), enrollment));

  const components: any[] = [];
  if (params.length) {
    components.push({
      type: "body",
      parameters: params.map(text => ({ type: "text", text }))
    });
  }

  try {
    const res = await EvoHubProvider.sendTemplate(
      connection,
      enrollment.contactNumber,
      step.templateName,
      step.templateLanguage || "pt_BR",
      components.length ? components : undefined
    );
    logger.info(
      `[Automação] enviado passo '${step.key}' template='${step.templateName}' -> ${enrollment.contactNumber} (enrollment=${enrollment.id}).`
    );
    return { ok: true, wamid: res?.wamid || null };
  } catch (err: any) {
    const detail =
      err?.response?.data?.error?.message || err?.message || "erro";
    logger.error(
      `[Automação] falha ao enviar passo '${step.key}' template='${step.templateName}' -> ${enrollment.contactNumber}: ${detail}`
    );
    return { ok: false, error: detail };
  }
}

export default sendStep;
