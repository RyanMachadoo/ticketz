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

// Trava simples em memória para não rodar o agente duas vezes no mesmo ticket
// ao mesmo tempo (ex.: cliente manda várias mensagens seguidas).
const runningTickets = new Set<number>();

/** Mapeia e normaliza o histórico para o formato da Anthropic (alterna papéis). */
async function buildConversation(
  ticketId: number,
  companyId: number
): Promise<AnthropicMessage[]> {
  const messages = await Message.findAll({
    where: { ticketId, companyId },
    order: [
      ["createdAt", "ASC"],
      ["id", "ASC"]
    ],
    limit: HISTORY_LIMIT
  });

  const turns: { role: "user" | "assistant"; text: string }[] = [];
  messages.forEach(m => {
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

  return turns.map(t => ({ role: t.role, content: t.text }));
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

    const systemPrompt = [
      agent.systemPrompt || "",
      "",
      `Contexto do atendimento: você está conversando com ${
        contactName || "um cliente"
      }${contactNumber ? ` (${contactNumber})` : ""} pelo WhatsApp.`,
      ctwaLine,
      memoryLine,
      "Responda em português do Brasil, de forma objetiva e cordial. Use as ferramentas disponíveis quando precisar consultar dados ou executar ações. Anote na memória (anotar_memoria) os fatos úteis para não repetir perguntas. Transfira para um humano quando não puder resolver."
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

    const messages = await buildConversation(ticketId, companyId);
    if (!messages.length) return;

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
