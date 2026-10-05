import Bull from "bull";
import Message from "../models/Message";
import { logger } from "../utils/logger";
import handleAgentReply from "../services/AIAgentServices/HandleAgentReply";

/**
 * Fila do agente de IA. Quando chega uma mensagem do cliente num ticket cuja
 * fila tem um agente vinculado (e o agente ainda está conduzindo), enfileira
 * aqui o processamento da resposta — fora do caminho crítico da mensagem.
 */

const redisConnection =
  process.env.REDIS_URI || process.env.IO_REDIS_SERVER || "";

// Debounce: junta mensagens em rajada (cliente mandando várias linhas seguidas)
// numa resposta só, mais natural e mais barato. O job espera este tempo e, ao
// rodar, lê TODO o histórico — então enxerga todas as mensagens do período.
const DEBOUNCE_MS = Number(process.env.AGENT_DEBOUNCE_MS || 8000);

export const agentQueue = new Bull("AIAgentQueue", redisConnection, {
  defaultJobOptions: {
    attempts: 1, // não repetir: evita respostas duplicadas se algo falhar no meio
    removeOnComplete: true,
    removeOnFail: true
  }
});

interface AgentJob {
  ticketId: number;
  companyId: number;
}

agentQueue.process(async job => {
  const { ticketId, companyId } = job.data as AgentJob;
  await handleAgentReply(ticketId, companyId);
});

/**
 * Decide, a partir de uma mensagem recém-criada, se o agente deve responder,
 * e enfileira o job. Fire-and-forget e à prova de erro — NUNCA deve quebrar o
 * fluxo de criação de mensagens.
 */
export function maybeEnqueueAgent(message: Message): void {
  try {
    if (!message || message.fromMe) return;

    const ticket: any = message.ticket;
    if (!ticket) return;
    if (ticket.isGroup) return;

    // Só faz sentido logar/decidir quando a FILA do ticket tem agente. Para
    // tickets em filas sem agente, fica em silêncio (não é caso do agente).
    const queueHasAgent = !!(ticket.queue && ticket.queue.aiAgentId);
    if (!queueHasAgent) return;

    // A partir daqui a fila TEM agente: deixamos claro no log por que atua ou não.
    if (ticket.status === "closed") {
      logger.info(`[Agente IA] ticket=${ticket.id} NÃO atua: ticket fechado.`);
      return;
    }
    // Obs.: NÃO bloqueamos por userId. O controle é pela FILA: enquanto o ticket
    // estiver na fila do agente (e useAgent != false), o agente responde. Para
    // parar, transfira para outra fila (ou desligue com useAgent=false).
    if (ticket.useAgent === false) {
      logger.info(
        `[Agente IA] ticket=${ticket.id} NÃO atua: já transferido/desligado (useAgent=false).`
      );
      return;
    }

    // jobId por "janela de tempo": mensagens do mesmo intervalo colapsam num
    // único job (debounce). Ao rodar, o handler lê todo o histórico.
    const bucket = Math.floor(Date.now() / DEBOUNCE_MS);
    logger.info(
      `[Agente IA] ticket=${ticket.id} agendado (debounce ${DEBOUNCE_MS}ms, fila=${ticket.queue.name || ticket.queueId}, agenteId=${ticket.queue.aiAgentId}).`
    );
    agentQueue
      .add(
        { ticketId: ticket.id, companyId: message.companyId },
        { jobId: `agent-${ticket.id}-${bucket}`, delay: DEBOUNCE_MS }
      )
      .catch(err => {
        logger.error(
          `[Agente IA] falha ao enfileirar ticket=${ticket.id}: ${err?.message}`
        );
      });
  } catch (err: any) {
    logger.error(`[Agente IA] maybeEnqueueAgent erro: ${err?.message}`);
  }
}

logger.info("[Agente IA] fila de respostas registrada");
