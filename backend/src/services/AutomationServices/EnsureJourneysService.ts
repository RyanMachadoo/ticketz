import AutomationJourney from "../../models/AutomationJourney";
import AutomationStep from "../../models/AutomationStep";
import { BLUEPRINT } from "./automationBlueprint";

/**
 * Garante que a empresa tenha as jornadas/passos padrão (idempotente). Cria o
 * que faltar, sem sobrescrever o que já existe (ex.: templateName que o Ryan já
 * vinculou). Retorna as jornadas com os passos.
 */
export async function ensureJourneys(
  companyId: number
): Promise<AutomationJourney[]> {
  for (const bj of BLUEPRINT) {
    // eslint-disable-next-line no-await-in-loop
    let journey = await AutomationJourney.findOne({
      where: { companyId, key: bj.key }
    });
    if (!journey) {
      // eslint-disable-next-line no-await-in-loop
      journey = await AutomationJourney.create({
        companyId,
        key: bj.key,
        name: bj.name,
        isActive: true
      } as any);
    }

    for (const bs of bj.steps) {
      // eslint-disable-next-line no-await-in-loop
      const exists = await AutomationStep.findOne({
        where: { journeyId: journey.id, key: bs.key }
      });
      if (!exists) {
        // eslint-disable-next-line no-await-in-loop
        await AutomationStep.create({
          companyId,
          journeyId: journey.id,
          key: bs.key,
          order: bs.order,
          name: bs.name,
          triggerType: bs.triggerType,
          offsetMinutes: bs.offsetMinutes,
          kind: bs.kind,
          templateName: bs.templateName || null,
          templateLanguage: "pt_BR",
          templateParams: bs.templateParams || [],
          surveyConfig: bs.surveyConfig || null,
          isActive: true
        } as any);
      }
    }
  }

  return AutomationJourney.findAll({
    where: { companyId },
    include: [{ model: AutomationStep }],
    order: [
      ["id", "ASC"],
      [{ model: AutomationStep, as: "steps" }, "order", "ASC"]
    ]
  });
}

export default ensureJourneys;
