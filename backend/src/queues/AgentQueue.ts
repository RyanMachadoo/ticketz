import Bull from "bull";
import Message from "../models/Message";
import Whatsapp from "../models/Whatsapp";
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

// Concorrência: processa vários tickets em paralelo para não serializar as
// respostas sob carga (cada resposta espera a API da Anthropic). Ajustável por
// env AGENT_CONCURRENCY. A trava por ticket (runningTickets, no HandleAgentReply)
// evita rodar o MESMO ticket duas vezes ao mesmo tempo.
const AGENT_CONCURRENCY = Math.max(
  1,
  Number(process.env.AGENT_CONCURRENCY || 4)
);

agentQueue.process(AGENT_CONCURRENCY, async job => {
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
    if (ticket.status === "closed") return;

    const queueHasAgent = !!(ticket.queue && ticket.queue.aiAgentId);

    if (queueHasAgent) {
      // Caso clássico: controle pela FILA. HandleAgentReply reativa useAgent se
      // voltou para a fila da IA após transfer. Para parar, mova p/ fila sem IA.
      enqueue(ticket, message.companyId, `fila=${ticket.queue.name || ticket.queueId}`);
      return;
    }

    // Caso NOVO: agente PADRÃO da conexão. Atua no primeiro contato / tickets
    // sem fila com IA, mas só quando NÃO há atendente humano (userId null) e a
    // IA não foi desligada (useAgent !== false). Precisa carregar a conexão —
    // faz async e enfileira no .then (continua fire-and-forget).
    if (ticket.userId) return; // humano assumiu: não fala por cima
    if (ticket.useAgent === false) return; // transferido: respeita o handoff
    if (!ticket.whatsappId) return;

    Whatsapp.findByPk(ticket.whatsappId)
      .then(conn => {
        if (conn && conn.defaultAiAgentId) {
          enqueue(ticket, message.companyId, `conexão padrão agente=${conn.defaultAiAgentId}`);
        }
      })
      .catch(() => {
        /* best-effort */
      });
  } catch (err: any) {
    logger.error(`[Agente IA] maybeEnqueueAgent erro: ${err?.message}`);
  }
}

/** Enfileira o job do agente (debounce por janela de tempo). */
function enqueue(ticket: any, companyId: number, origem: string): void {
  const bucket = Math.floor(Date.now() / DEBOUNCE_MS);
  logger.info(
    `[Agente IA] ticket=${ticket.id} agendado (debounce ${DEBOUNCE_MS}ms, ${origem}).`
  );
  agentQueue
    .add(
      { ticketId: ticket.id, companyId },
      { jobId: `agent-${ticket.id}-${bucket}`, delay: DEBOUNCE_MS }
    )
    .catch(err => {
      logger.error(
        `[Agente IA] falha ao enfileirar ticket=${ticket.id}: ${err?.message}`
      );
    });
}

logger.info("[Agente IA] fila de respostas registrada");
