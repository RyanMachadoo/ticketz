import moment from "moment";
import AutomationTask from "../../models/AutomationTask";
import AutomationStep from "../../models/AutomationStep";
import AutomationEnrollment from "../../models/AutomationEnrollment";
import AutomationResponse from "../../models/AutomationResponse";
import { logger } from "../../utils/logger";
import { notifyQuality } from "./QualityNotifyService";

const stripAccents = (s: string): string =>
  (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "");
const norm = (s: string): string =>
  stripAccents(String(s || "")).toLowerCase().trim();

/** Descobre a banda a partir do texto do botão, usando o surveyConfig do passo. */
function bandFromButton(surveyConfig: any, buttonText: string): string | null {
  const buttons = surveyConfig?.buttons;
  if (!Array.isArray(buttons)) return null;
  const hit = buttons.find((b: any) => norm(b?.text) === norm(buttonText));
  return hit ? String(hit.band) : null;
}

/** Keys dos passos a agendar para uma banda (tolerante ao formato do config). */
function stepsForBand(surveyConfig: any, band: string): string[] {
  const cfg = surveyConfig?.onBand?.[band];
  if (!cfg) return [];
  if (Array.isArray(cfg.steps)) return cfg.steps;
  // compat com formato antigo:
  const out: string[] = [];
  if (Array.isArray(cfg.nextSteps)) out.push(...cfg.nextSteps);
  if (Array.isArray(cfg.scheduleStepsFromResponse)) {
    out.push(...cfg.scheduleStepsFromResponse.map((s: any) => s.key).filter(Boolean));
  }
  return out;
}

function bandWantsQuality(surveyConfig: any, band: string): boolean {
  const cfg = surveyConfig?.onBand?.[band];
  return !!(cfg && (cfg.quality === true || cfg === "quality"));
}

/**
 * Trata a resposta (botão) de uma pesquisa de automação (PSI). Casa a tarefa
 * pela wamid da mensagem enviada (context.id da resposta). Ramifica por banda:
 *   - banda com steps (ex.: "5" -> cem, agradecimento): agenda esses passos
 *     on_survey (cada um com seu offset a partir de agora);
 *   - banda com quality (ex.: "1-4"): avisa o responsável de qualidade.
 * Idempotente: uma resposta por tarefa.
 */
export async function handleSurveyReply(params: {
  companyId: number;
  contextId?: string;
  buttonText: string;
}): Promise<boolean> {
  const { companyId, contextId } = params;
  const buttonText = String(params.buttonText || "").trim();
  if (!contextId || !buttonText) return false;

  try {
    const task = await AutomationTask.findOne({
      where: { companyId, wamid: contextId }
    });
    if (!task) return false; // não é resposta de uma pesquisa de automação

    const step = await AutomationStep.findByPk(task.stepId);
    if (!step || step.kind !== "survey" || !step.surveyConfig) return false;

    const band = bandFromButton(step.surveyConfig, buttonText);
    if (!band) {
      logger.info(
        `[Automação][pesquisa] resposta "${buttonText}" não casa com nenhuma banda (task=${task.id}).`
      );
      return false;
    }

    // Idempotência: se já respondeu, não ramifica de novo.
    const already = await AutomationResponse.findOne({ where: { taskId: task.id } });
    if (already) {
      logger.info(
        `[Automação][pesquisa] resposta já registrada (task=${task.id}); ignorando duplicada.`
      );
      return true;
    }

    const enrollment = await AutomationEnrollment.findByPk(task.enrollmentId);
    if (!enrollment) return false;

    await AutomationResponse.create({
      companyId,
      enrollmentId: enrollment.id,
      stepId: step.id,
      taskId: task.id,
      band,
      buttonText,
      respondedAt: new Date()
    } as any);

    logger.info(
      `[Automação][pesquisa] resposta registrada: cliente=${enrollment.contactNumber} passo='${step.key}' banda=${band} (task=${task.id}).`
    );

    // Agenda os passos on_survey da banda (ex.: nota 5 -> cem + agradecimento).
    const keys = stepsForBand(step.surveyConfig, band);
    for (const key of keys) {
      // eslint-disable-next-line no-await-in-loop
      const next = await AutomationStep.findOne({
        where: { journeyId: enrollment.journeyId, key, isActive: true }
      });
      if (!next) continue;
      const runAt = moment()
        .add(Number(next.offsetMinutes) || 0, "minutes")
        .toDate();
      // findOrCreate respeita o índice único (enrollmentId, stepId).
      // eslint-disable-next-line no-await-in-loop
      await AutomationTask.findOrCreate({
        where: { enrollmentId: enrollment.id, stepId: next.id },
        defaults: {
          companyId,
          enrollmentId: enrollment.id,
          stepId: next.id,
          runAt,
          status: "pending",
          attempts: 0
        } as any
      });
      logger.info(
        `[Automação][pesquisa] passo on_survey '${next.key}' agendado para ${runAt.toISOString()} (enrollment=${enrollment.id}).`
      );
    }

    // Banda de nota baixa -> avisa qualidade.
    if (bandWantsQuality(step.surveyConfig, band)) {
      await notifyQuality({ companyId, enrollment, step, band, buttonText });
    }

    return true;
  } catch (err: any) {
    logger.error(
      `[Automação][pesquisa] falha ao tratar resposta (contextId=${contextId}): ${err?.message}`
    );
    return false;
  }
}

export default handleSurveyReply;
