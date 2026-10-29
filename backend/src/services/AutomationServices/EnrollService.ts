import { Op } from "sequelize";
import moment from "moment";
import sequelize from "../../database";
import AppError from "../../errors/AppError";
import AutomationJourney from "../../models/AutomationJourney";
import AutomationStep from "../../models/AutomationStep";
import AutomationEnrollment from "../../models/AutomationEnrollment";
import AutomationTask from "../../models/AutomationTask";
import { logger } from "../../utils/logger";
import { EVENT_TO_JOURNEY } from "./automationBlueprint";
import { ensureJourneys } from "./EnsureJourneysService";

export interface EnrollParams {
  companyId: number;
  tipo: string; // os_encerrada | venda_entregue | visita_sem_fechar
  numero: string;
  nome?: string;
  dataEvento: string | Date; // ISO-8601
  externalRef?: string;
  data?: any; // loja, modelo, placa, etc.
}

export interface EnrollResult {
  enrollmentId: number;
  status: string; // created | existing | skipped
  journey: string;
  scheduled: { step: string; runAt: Date }[];
}

const onlyDigits = (s: string): string => String(s || "").replace(/\D/g, "");

/** Normaliza o número: só dígitos, com DDI 55 quando vier sem (padrão BR). */
function normalizeNumber(num: string): string {
  let n = onlyDigits(num);
  if (n && !n.startsWith("55") && n.length <= 11) n = `55${n}`;
  return n;
}

/**
 * Inscreve um cliente numa jornada a partir de um evento do API interno.
 * Idempotente por (tipo + externalRef). Agenda, em transação, as tarefas dos
 * passos "event" (os "on_survey" são agendados pela ramificação, na Fase 2).
 */
export async function enroll(params: EnrollParams): Promise<EnrollResult> {
  const { companyId, tipo, data } = params;
  const numero = normalizeNumber(params.numero);
  const nome = params.nome || "";

  if (!tipo || !EVENT_TO_JOURNEY[tipo]) {
    throw new AppError(`tipo inválido: ${tipo}`, 400);
  }
  if (!numero) {
    throw new AppError("numero inválido", 400);
  }

  const eventAt = params.dataEvento
    ? moment(params.dataEvento).toDate()
    : new Date();
  if (!eventAt || Number.isNaN(eventAt.getTime())) {
    throw new AppError("dataEvento inválida (use ISO-8601)", 400);
  }

  const journeyKey = EVENT_TO_JOURNEY[tipo];

  // Garante as jornadas da empresa (idempotente) e pega a desta.
  await ensureJourneys(companyId);
  const journey = await AutomationJourney.findOne({
    where: { companyId, key: journeyKey },
    include: [{ model: AutomationStep }]
  });
  if (!journey) {
    throw new AppError(`jornada '${journeyKey}' não encontrada`, 500);
  }

  const externalRef = params.externalRef ? String(params.externalRef) : "";
  const dedupeKey = externalRef
    ? `${tipo}:${externalRef}`
    : `${tipo}:${numero}:${moment(eventAt).format("YYYYMMDDHHmm")}`;

  // Idempotência.
  const existing = await AutomationEnrollment.findOne({
    where: { companyId, dedupeKey }
  });
  if (existing) {
    logger.info(
      `[Automação] evento repetido ignorado (dedupeKey=${dedupeKey}, enrollment=${existing.id}).`
    );
    return {
      enrollmentId: existing.id,
      status: "existing",
      journey: journeyKey,
      scheduled: []
    };
  }

  if (!journey.isActive) {
    logger.info(
      `[Automação] jornada '${journeyKey}' inativa — evento não agendado.`
    );
    return { enrollmentId: 0, status: "skipped", journey: journeyKey, scheduled: [] };
  }

  const scheduled: { step: string; runAt: Date }[] = [];

  const result = await sequelize.transaction(async t => {
    const enrollment = await AutomationEnrollment.create(
      {
        companyId,
        journeyId: journey.id,
        contactNumber: numero,
        contactName: nome,
        eventAt,
        externalRef: externalRef || null,
        dedupeKey,
        status: "active",
        data: data || {}
      } as any,
      { transaction: t }
    );

    const eventSteps = (journey.steps || []).filter(
      s => s.isActive && s.triggerType === "event"
    );
    for (const step of eventSteps) {
      const runAt = moment(eventAt)
        .add(Number(step.offsetMinutes) || 0, "minutes")
        .toDate();
      // eslint-disable-next-line no-await-in-loop
      await AutomationTask.create(
        {
          companyId,
          enrollmentId: enrollment.id,
          stepId: step.id,
          runAt,
          status: "pending",
          attempts: 0
        } as any,
        { transaction: t }
      );
      scheduled.push({ step: step.key, runAt });
    }

    return enrollment;
  });

  logger.info(
    `[Automação] inscrição criada enrollment=${result.id} jornada=${journeyKey} passos=${scheduled.length} (dedupeKey=${dedupeKey}).`
  );

  return {
    enrollmentId: result.id,
    status: "created",
    journey: journeyKey,
    scheduled
  };
}

export default enroll;
