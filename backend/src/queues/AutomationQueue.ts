import Bull from "bull";
import { Op } from "sequelize";
import moment from "moment";
import { logger } from "../utils/logger";
import AutomationTask from "../models/AutomationTask";
import AutomationStep from "../models/AutomationStep";
import AutomationEnrollment from "../models/AutomationEnrollment";
import AutomationJourney from "../models/AutomationJourney";
import { sendStep } from "../services/AutomationServices/SendStepService";

const connection = process.env.REDIS_URI || "";

export const automationQueue = new Bull("AutomationQueue", connection, {
  defaultJobOptions: { removeOnComplete: true, removeOnFail: 100 }
});

const BATCH = Number(process.env.AUTOMATION_BATCH || 100);
const MAX_ATTEMPTS = Number(process.env.AUTOMATION_MAX_ATTEMPTS || 5);

/**
 * Processa as tarefas vencidas (runAt <= agora, status "pending"). Para cada
 * uma faz uma TRAVA ATÔMICA (pending -> sending) para não enviar duas vezes,
 * envia o template e grava o resultado. Falha real reagenda com backoff; falta
 * de template/conexão reagenda para +60min (sem contar tentativa).
 */
async function handleDispatch(): Promise<void> {
  const now = new Date();

  // Recuperação: tarefas presas em "sending" há mais de 10 min (ex.: o processo
  // caiu no meio de um envio) voltam para "pending" e são re-tentadas.
  await AutomationTask.update(
    { status: "pending" },
    {
      where: {
        status: "sending",
        updatedAt: { [Op.lt]: moment().subtract(10, "minutes").toDate() }
      }
    }
  );

  const due = await AutomationTask.findAll({
    where: { status: "pending", runAt: { [Op.lte]: now } },
    order: [["runAt", "ASC"]],
    limit: BATCH
  });

  for (const task of due) {
    // Trava atômica: só segue quem conseguir mudar pending -> sending.
    // eslint-disable-next-line no-await-in-loop
    const [claimed] = await AutomationTask.update(
      { status: "sending" },
      { where: { id: task.id, status: "pending" } }
    );
    if (!claimed) continue;

    // eslint-disable-next-line no-await-in-loop
    const step = await AutomationStep.findByPk(task.stepId);
    // eslint-disable-next-line no-await-in-loop
    const enrollment = await AutomationEnrollment.findByPk(task.enrollmentId);

    if (!step || !enrollment || enrollment.status === "canceled") {
      // eslint-disable-next-line no-await-in-loop
      await task.update({ status: "canceled" });
      continue;
    }

    let journeyWhatsappId: number | null = null;
    try {
      // eslint-disable-next-line no-await-in-loop
      const journey = await AutomationJourney.findByPk(step.journeyId);
      journeyWhatsappId = journey?.whatsappId || null;
    } catch (e) {
      // best-effort
    }

    // eslint-disable-next-line no-await-in-loop
    const result = await sendStep(step, enrollment, journeyWhatsappId);

    if (result.ok) {
      // eslint-disable-next-line no-await-in-loop
      await task.update({
        status: "sent",
        wamid: result.wamid || null,
        sentAt: new Date(),
        lastError: null
      });
    } else if (result.skipped) {
      // Sem template vinculado / sem conexão: tenta de novo em 1h, sem punir.
      // eslint-disable-next-line no-await-in-loop
      await task.update({
        status: "pending",
        runAt: moment().add(60, "minutes").toDate()
      });
    } else {
      const attempts = (task.attempts || 0) + 1;
      if (attempts >= MAX_ATTEMPTS) {
        // eslint-disable-next-line no-await-in-loop
        await task.update({
          status: "failed",
          attempts,
          lastError: result.error || "falha"
        });
      } else {
        // eslint-disable-next-line no-await-in-loop
        await task.update({
          status: "pending",
          attempts,
          lastError: result.error || "falha",
          runAt: moment().add(5 * attempts, "minutes").toDate()
        });
      }
    }
  }
}

export async function startAutomationQueue(): Promise<void> {
  try {
    const repeatables = await automationQueue.getRepeatableJobs();
    await Promise.all(
      repeatables.map(r => automationQueue.removeRepeatableByKey(r.key))
    );
  } catch (e) {
    // best-effort
  }

  automationQueue.process("Dispatch", async () => {
    try {
      await handleDispatch();
    } catch (err: any) {
      logger.error(`[Automação] erro no dispatch: ${err?.message}`);
    }
  });

  await automationQueue.add(
    "Dispatch",
    {},
    { repeat: { cron: "* * * * *" }, removeOnComplete: true, removeOnFail: 100 }
  );

  logger.info("[Automação] worker de disparo registrado (a cada 1 min)");
}

export default automationQueue;
