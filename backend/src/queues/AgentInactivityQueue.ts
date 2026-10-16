import Bull from "bull";
import Message from "../models/Message";
import Queue from "../models/Queue";
import Ticket from "../models/Ticket";
import { logger } from "../utils/logger";
import { transferTicketToHuman } from "../services/AIAgentServices/AgentToolRunner";

/**
 * Monitor de inatividade do agente de IA.
 *
 * Quando o agente responde e o cliente fica em silêncio por X minutos
 * (configurável por agente: inactivityTimeoutMinutes), o atendimento é
 * repassado para um vendedor humano — o lead "esfriou" e não deve ficar preso
 * no robô. É agendado a cada resposta do agente (reagenda empurrando o prazo)
 * e, ao disparar, só transfere se o cliente realmente não respondeu.
 *
 * Event-driven (job atrasado por ticket), sem polling. Economiza recursos e é
 * preciso. Tudo best-effort: nunca quebra o atendimento.
 */

const redisConnection =
  process.env.REDIS_URI || process.env.IO_REDIS_SERVER || "";

export const inactivityQueue = new Bull(
  "AIAgentInactivityQueue",
  redisConnection,
  {
    defaultJobOptions: {
      attempts: 1,
      removeOnComplete: true,
      removeOnFail: true
    }
  }
);

interface InactivityJob {
  ticketId: number;
  companyId: number;
  transferQueueId: number | null;
  minutes: number;
}

const jobIdFor = (ticketId: number): string => `inact-${ticketId}`;

/**
 * Agenda (ou reagenda) a verificação de inatividade para um ticket. Chamado
 * após cada resposta do agente. Remove o job anterior para "empurrar" o prazo.
 */
export async function scheduleInactivityCheck(
  ticketId: number,
  companyId: number,
  minutes: number,
  transferQueueId: number | null
): Promise<void> {
  const mins = Number(minutes);
  if (!mins || mins <= 0) return; // recurso desligado para este agente

  const jobId = jobIdFor(ticketId);
  try {
    const existing = await inactivityQueue.getJob(jobId);
    if (existing) await existing.remove().catch(() => undefined);
  } catch (e) {
    // segue — pior caso, o add abaixo é ignorado por jobId duplicado
  }

  await inactivityQueue
    .add(
      { ticketId, companyId, transferQueueId: transferQueueId || null, minutes: mins } as InactivityJob,
      { jobId, delay: mins * 60 * 1000 }
    )
    .catch(err =>
      logger.error(
        `[Agente IA] falha ao agendar inatividade ticket=${ticketId}: ${err?.message}`
      )
    );
}

/** Cancela a verificação pendente (ex.: ticket encerrado manualmente). */
export async function cancelInactivityCheck(ticketId: number): Promise<void> {
  try {
    const existing = await inactivityQueue.getJob(jobIdFor(ticketId));
    if (existing) await existing.remove().catch(() => undefined);
  } catch (e) {
    // best-effort
  }
}

/** Processa o disparo: transfere para humano se o cliente ficou sem responder. */
async function handleInactivity(job: InactivityJob): Promise<void> {
  const { ticketId, companyId, transferQueueId, minutes } = job;
  try {
    const ticket = await Ticket.findByPk(ticketId);
    if (!ticket || ticket.companyId !== companyId) return;
    if (ticket.useAgent === false) return; // já saiu do agente
    if (ticket.status === "closed") return;
    if (!ticket.queueId) return;

    const queue = await Queue.findByPk(ticket.queueId);
    if (!queue || !queue.aiAgentId) return; // não está mais numa fila de agente

    // A última mensagem precisa ser do AGENTE (fromMe): significa que estamos
    // esperando o cliente. Se o cliente respondeu por último, não transfere.
    const lastMsg = await Message.findOne({
      where: { ticketId, companyId },
      order: [
        ["createdAt", "DESC"],
        ["id", "DESC"]
      ]
    });
    if (!lastMsg || !lastMsg.fromMe) return;

    const ageMin =
      (Date.now() - new Date(lastMsg.createdAt).getTime()) / 60000;
    if (ageMin < minutes - 0.5) return; // ainda não atingiu (reagendado)

    await transferTicketToHuman({
      companyId,
      ticketId,
      transferQueueId: transferQueueId || null,
      motivo: `Cliente sem resposta há ~${Math.round(
        ageMin
      )} min — repassando para um vendedor dar sequência.`
    });
    logger.info(
      `[Agente IA] inatividade: ticket=${ticketId} transferido após ~${Math.round(
        ageMin
      )}min sem resposta do cliente.`
    );
  } catch (err: any) {
    logger.error(
      `[Agente IA] erro no monitor de inatividade ticket=${ticketId}: ${err?.message}`
    );
  }
}

inactivityQueue.process(async job => {
  await handleInactivity(job.data as InactivityJob);
});

logger.info("[Agente IA] monitor de inatividade registrado");
