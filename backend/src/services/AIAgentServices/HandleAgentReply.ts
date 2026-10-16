import AIAgent from "../../models/AIAgent";
import Message from "../../models/Message";
import Queue from "../../models/Queue";
import Ticket from "../../models/Ticket";
import { logger } from "../../utils/logger";
import ShowTicketService from "../TicketServices/ShowTicketService";
import { getReferralForTicket } from "../CtwaServices/CtwaService";
import SendWhatsAppMessage from "../WbotServices/SendWhatsAppMessage";
import {
  AnthropicMessage,
  callMessages,
  describeAnthropicError,
  extractText,
  extractToolUses
} from "./AnthropicProvider";
import {
  AgentToolContext,
  buildAnthropicTools,
  executeTool,
  findToolDef
} from "./AgentToolRunner";
import {
  loadMemory,
  formatMemoryForPrompt
} from "./AgentMemoryService";
import {
  normalizeGuardrails,
  checkToolCall,
  maskPiiInput
} from "./AgentGuardrails";
import { recordTrace, TraceToolCall } from "./AgentTraceService";
import {
  scheduleInactivityCheck,
  cancelInactivityCheck
} from "../../queues/AgentInactivityQueue";

/**
 * Orquestra uma resposta do agente de IA para um ticket (estilo ADK):
 *  1) carrega o agente vinculado à fila do ticket;
 *  2) carrega a MEMÓRIA (sessão + longo prazo) e injeta no contexto;
 *  3) monta o histórico da conversa;
 *  4) chama a API da Anthropic com as ferramentas;
 *  5) aplica GUARDRAILS determinísticos antes de cada ferramenta;
 *  6) executa as ferramentas pedidas (loop) até a resposta final;
 *  7) envia a resposta final ao cliente pelo canal do ticket;
 *  8) grava um TRACE (raio-x) do turno: tokens, custo, latência, trajetória.
 *
 * Tudo protegido por try/catch — uma falha do agente NUNCA quebra o atendimento.
 */

const HISTORY_LIMIT = 40;
const AGENT_TIMEZONE = process.env.AGENT_TIMEZONE || "America/Sao_Paulo";

// Trava simples em memória para não rodar o agente duas vezes no mesmo ticket
// ao mesmo tempo (ex.: cliente manda várias mensagens seguidas).
const runningTickets = new Set<number>();

/** Data/hora atual, por extenso, no fuso configurado (horário de Brasília). */
function nowInTimezone(): string {
  try {
    return new Intl.DateTimeFormat("pt-BR", {
      timeZone: AGENT_TIMEZONE,
      weekday: "long",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    }).format(new Date());
  } catch {
    return new Date().toISOString();
  }
}

interface ConversationBuild {
  messages: AnthropicMessage[];
  resetApplied: boolean; // histórico foi cortado por intervalo longo
  gapDays: number; // dias desde o último contato (quando houve corte)
}

/**
 * Monta e normaliza o histórico para o formato da Anthropic (alterna papéis).
 *
 * "Corte de continuidade": se o cliente volta após um intervalo grande
 * (resetDays, ex.: 3 dias), o histórico é cortado no ponto de retomada para o
 * agente recomeçar o assunto do zero. As PREFERÊNCIAS não se perdem — elas vêm
 * da memória de longo prazo (por contato), não do histórico cru.
 */
async function buildConversation(
  ticketId: number,
  companyId: number,
  resetDays: number
): Promise<ConversationBuild> {
  const messages = await Message.findAll({
    where: { ticketId, companyId },
    order: [
      ["createdAt", "ASC"],
      ["id", "ASC"]
    ],
    limit: HISTORY_LIMIT
  });

  // Detecta o corte: o intervalo longo MAIS RECENTE entre mensagens consecutivas.
  let startIdx = 0;
  let resetApplied = false;
  let gapDays = 0;
  if (resetDays && resetDays > 0 && messages.length > 1) {
    const thresholdMs = resetDays * 24 * 60 * 60 * 1000;
    for (let i = messages.length - 1; i > 0; i -= 1) {
      const gap =
        new Date(messages[i].createdAt).getTime() -
        new Date(messages[i - 1].createdAt).getTime();
      if (gap >= thresholdMs) {
        startIdx = i;
        resetApplied = true;
        gapDays = Math.round(gap / 86400000);
        break;
      }
    }
  }

  const slice = messages.slice(startIdx);
  const turns: { role: "user" | "assistant"; text: string }[] = [];
  slice.forEach(m => {
    let text = (m.body || "").trim();
    if (!text && m.mediaType && m.mediaType !== "chat") {
      text = `[cliente enviou uma mídia do tipo ${m.mediaType}]`;
    }
    if (!text) return;
    const role: "user" | "assistant" = m.fromMe ? "assistant" : "user";
    const last = turns[turns.length - 1];
    if (last && last.role === role) {
      last.text += `\n${text}`;
    } else {
      turns.push({ role, text });
    }
  });

  // Remove turnos iniciais do assistente (a conversa precisa começar com user).
  while (turns.length && turns[0].role === "assistant") {
    turns.shift();
  }

  return {
    messages: turns.map(t => ({ role: t.role, content: t.text })),
    resetApplied,
    gapDays
  };
}

export async function handleAgentReply(
  ticketId: number,
  companyId: number
): Promise<void> {
  if (runningTickets.has(ticketId)) {
    logger.info(`[Agente IA] já processando ticket=${ticketId}; ignorando.`);
    return;
  }
  runningTickets.add(ticketId);

  // Acumuladores de telemetria (viram um AgentTrace no fim).
  const turnStart = Date.now();
  let inputTokens = 0;
  let outputTokens = 0;
  let steps = 0;
  const toolCalls: TraceToolCall[] = [];
  const guardrailEvents: any[] = [];
  let lastStopReason = "";
  let traceAgentId = 0;
  let traceModel = "";
  let traceStatus = "ok";
  let traceError = "";
  let finalText = "";
  let transferred = false;
  let shouldTrace = false;

  try {
    const ticket = await Ticket.findByPk(ticketId);
    if (!ticket || ticket.companyId !== companyId) return;
    if (ticket.useAgent === false) return; // transferido / desligado
    if (ticket.status === "closed") return;
    // Controle é pela fila (não por userId): atua enquanto estiver na fila do agente.
    if (!ticket.queueId) return;

    const queue = await Queue.findByPk(ticket.queueId);
    if (!queue || !queue.aiAgentId) return;

    const agent = await AIAgent.findByPk(queue.aiAgentId);
    if (!agent || !agent.isActive) return;
    if (!agent.apiKey) {
      logger.warn(
        `[Agente IA] agente ${agent.id} sem chave de API; não respondeu.`
      );
      return;
    }

    // A partir daqui é um turno "de verdade": vamos gravar trace no fim.
    shouldTrace = true;
    traceAgentId = agent.id;
    traceModel = agent.model;

    const fullTicket = await ShowTicketService(ticketId, companyId);
    const contactId = fullTicket.contactId || fullTicket.contact?.id || null;
    const contactName = fullTicket.contact?.name || "";
    const contactNumber = fullTicket.contact?.number || "";

    // Memória (sessão + longo prazo) para personalizar e não repetir perguntas.
    const memory = await loadMemory(companyId, ticketId, contactId);
    const memoryLine = formatMemoryForPrompt(memory);

    // Origem Click-to-WhatsApp: se a conversa veio de um anúncio, dá esse
    // contexto ao agente (ele pode personalizar a abordagem pelo anúncio).
    let ctwaLine = "";
    try {
      const ref = await getReferralForTicket(ticketId);
      if (ref) {
        ctwaLine = `Este cliente chegou por um anúncio (Click-to-WhatsApp): "${
          ref.headline || ref.sourceId || "anúncio"
        }". Leve isso em conta na abordagem.`;
      }
    } catch (e) {
      // best-effort
    }

    // Histórico (com corte de continuidade se o cliente sumiu por vários dias).
    const resetDays =
      agent.conversationResetDays === undefined ||
      agent.conversationResetDays === null
        ? 0
        : Number(agent.conversationResetDays);
    const convo = await buildConversation(ticketId, companyId, resetDays);
    const messages = convo.messages;
    if (!messages.length) return;

    // Data/hora atual, para o agente interpretar "ontem", "semana passada" etc.
    const dateLine = `Data e hora atuais: ${nowInTimezone()} (horário de Brasília). Use isto como "hoje" ao interpretar o cliente (ex.: "ontem", "semana passada") — nunca assuma que ainda é a data da última conversa.`;

    // Retomada após intervalo longo: recomeçar o assunto sem citar o passado.
    const resumoLine = convo.resetApplied
      ? `O último contato deste cliente foi há cerca de ${convo.gapDays} dia(s). Comece como um novo atendimento: cumprimente de novo e puxe o assunto do zero. NÃO cite a conversa anterior nem retome pendências antigas a menos que o próprio cliente traga. Você ainda conhece as preferências dele pela memória — use só quando fizer sentido natural.`
      : "";

    const systemPrompt = [
      agent.systemPrompt || "",
      "",
      `Contexto do atendimento: você está conversando com ${
        contactName || "um cliente"
      }${contactNumber ? ` (${contactNumber})` : ""} pelo WhatsApp.`,
      dateLine,
      ctwaLine,
      resumoLine,
      memoryLine,
      "Responda em português do Brasil. Seja OBJETIVO e econômico: mensagens curtas (2 a 4 frases), uma pergunta por vez, sem repetir o que já foi dito — cada mensagem tem custo. Use as ferramentas quando precisar de dados ou ações; para qualquer pergunta sobre modelos, versões, cores, ano ou preço, consulte consultar_estoque ANTES e responda só com o retorno dela. Anote na memória (anotar_memoria) os fatos úteis para não repetir perguntas. Transfira para um humano quando o cliente estiver pronto para comprar/negociar ou quando você não puder resolver."
    ]
      .filter(Boolean)
      .join("\n");

    const guardrails = normalizeGuardrails(agent.guardrails);
    const tools = buildAnthropicTools(agent.tools || []);
    const ctx: AgentToolContext = {
      companyId,
      ticketId,
      contactId,
      contactName,
      contactNumber,
      transferQueueId: agent.transferQueueId || null
    };

    const maxSteps = agent.maxToolSteps || 5;

    for (let step = 0; step <= maxSteps; step += 1) {
      steps += 1;
      // eslint-disable-next-line no-await-in-loop
      const resp = await callMessages({
        apiKey: agent.apiKey,
        model: agent.model,
        maxTokens: agent.maxTokens,
        temperature: Number(agent.temperature),
        system: systemPrompt,
        messages,
        tools,
        workspaceId: agent.anthropicWorkspaceId || undefined
      });

      inputTokens += Number(resp.raw?.usage?.input_tokens || 0);
      outputTokens += Number(resp.raw?.usage?.output_tokens || 0);
      lastStopReason = resp.stopReason || lastStopReason;

      const toolUses = extractToolUses(resp.content);

      if (resp.stopReason === "tool_use" && toolUses.length) {
        logger.info(
          `[Agente IA] ticket=${ticketId} passo ${step}: modelo pediu ${
            toolUses.length
          } ferramenta(s): ${toolUses.map(t => t.name).join(", ")}`
        );
        // Registra a vez do assistente (com os pedidos de ferramenta).
        messages.push({ role: "assistant", content: resp.content });

        const toolResults: any[] = [];
        // eslint-disable-next-line no-restricted-syntax
        for (const tu of toolUses) {
          const def = findToolDef(agent.tools, tu.name);

          // GUARDRAIL determinístico ANTES de executar a ferramenta.
          const decision = checkToolCall({
            cfg: guardrails,
            toolName: tu.name,
            input: tu.input,
            toolDef: def,
            callsSoFar: toolCalls.filter(c => !c.blocked).length
          });

          if (!decision.allowed) {
            if (decision.event) guardrailEvents.push(decision.event);
            toolCalls.push({
              name: tu.name,
              status: "blocked",
              blocked: true,
              isError: true,
              reason: decision.reason
            });
            toolResults.push({
              type: "tool_result",
              tool_use_id: tu.id,
              content: `Ação bloqueada por política de segurança: ${decision.reason} Explique ao cliente de forma educada ou transfira para um humano.`,
              is_error: true
            });
            // eslint-disable-next-line no-continue
            continue;
          }

          const startedAt = Date.now();
          // eslint-disable-next-line no-await-in-loop
          const result = await executeTool(tu.name, tu.input, agent.tools, ctx);
          const ms = Date.now() - startedAt;
          if (result.transferred) transferred = true;

          toolCalls.push({
            name: tu.name,
            status: result.transferred
              ? "transfer"
              : result.isError
              ? "error"
              : "ok",
            ms,
            isError: !!result.isError
          });

          // Auditoria (com máscara de PII quando ligada).
          const auditInput = guardrails.maskPii
            ? maskPiiInput(tu.input)
            : tu.input;
          logger.info(
            `[Agente IA][auditoria] ticket=${ticketId} ferramenta=${tu.name} input=${JSON.stringify(
              auditInput
            ).slice(0, 500)} status=${result.isError ? "erro" : "ok"}`
          );

          toolResults.push({
            type: "tool_result",
            tool_use_id: tu.id,
            content: result.content,
            ...(result.isError ? { is_error: true } : {})
          });
        }
        messages.push({ role: "user", content: toolResults });
        // continua o loop para o modelo concluir com base nos resultados
      } else {
        finalText = extractText(resp.content);
        break;
      }
    }

    // Rede de segurança: se o loop acabou ainda pedindo ferramenta (estourou o
    // limite de passos) e não temos texto, faz UMA chamada final SEM ferramentas
    // para o modelo concluir em texto — assim o cliente nunca fica sem resposta.
    if (!finalText) {
      try {
        steps += 1;
        const closing = await callMessages({
          apiKey: agent.apiKey,
          model: agent.model,
          maxTokens: agent.maxTokens,
          temperature: Number(agent.temperature),
          system: systemPrompt,
          messages,
          workspaceId: agent.anthropicWorkspaceId || undefined
        });
        inputTokens += Number(closing.raw?.usage?.input_tokens || 0);
        outputTokens += Number(closing.raw?.usage?.output_tokens || 0);
        lastStopReason = closing.stopReason || lastStopReason;
        finalText = extractText(closing.content);
      } catch (e) {
        describeAnthropicError(e);
      }
    }

    if (finalText) {
      await SendWhatsAppMessage({ body: finalText, ticket: fullTicket });
      logger.info(
        `[Agente IA] resposta enviada (ticket=${ticketId}, agente=${agent.id}, transferido=${transferred}).`
      );
    } else {
      logger.info(
        `[Agente IA] sem texto final para enviar (ticket=${ticketId}).`
      );
    }

    // Monitor de inatividade: se o agente respondeu e NÃO transferiu, agenda a
    // passagem para um humano caso o cliente fique X min sem responder. Se
    // transferiu, cancela qualquer verificação pendente.
    if (transferred) {
      await cancelInactivityCheck(ticketId);
    } else if (finalText && Number(agent.inactivityTimeoutMinutes) > 0) {
      await scheduleInactivityCheck(
        ticketId,
        companyId,
        Number(agent.inactivityTimeoutMinutes),
        agent.transferQueueId || null
      );
    }

    traceStatus = transferred ? "transferred" : "ok";
  } catch (err: any) {
    traceStatus = "error";
    traceError = describeAnthropicError(err);
  } finally {
    runningTickets.delete(ticketId);

    // Grava o trace do turno (raio-x) — best-effort.
    if (shouldTrace) {
      await recordTrace({
        companyId,
        ticketId,
        agentId: traceAgentId,
        model: traceModel,
        inputTokens,
        outputTokens,
        latencyMs: Date.now() - turnStart,
        steps,
        toolCalls,
        guardrailEvents,
        stopReason: lastStopReason,
        status: traceStatus,
        finalText,
        error: traceError
      });
    }
  }
}

export default handleAgentReply;
