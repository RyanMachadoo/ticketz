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
  executeTool
} from "./AgentToolRunner";

/**
 * Orquestra uma resposta do agente de IA para um ticket:
 *  1) carrega o agente vinculado à fila do ticket;
 *  2) monta o histórico da conversa;
 *  3) chama a API da Anthropic com as ferramentas;
 *  4) executa as ferramentas pedidas (loop) até a resposta final;
 *  5) envia a resposta final ao cliente pelo canal do ticket.
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

  try {
    const ticket = await Ticket.findByPk(ticketId);
    if (!ticket || ticket.companyId !== companyId) return;
    if (ticket.useAgent === false) return; // atendente assumiu / já transferido
    if (ticket.status === "closed") return;
    if (ticket.userId) return; // humano assumiu
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

    const fullTicket = await ShowTicketService(ticketId, companyId);
    const contactName = fullTicket.contact?.name || "";
    const contactNumber = fullTicket.contact?.number || "";

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
      "Responda em português do Brasil, de forma objetiva e cordial. Use as ferramentas disponíveis quando precisar consultar dados ou executar ações. Transfira para um humano quando não puder resolver."
    ].join("\n");

    const tools = buildAnthropicTools(agent.tools || []);
    const ctx: AgentToolContext = {
      companyId,
      ticketId,
      contactName,
      contactNumber,
      transferQueueId: agent.transferQueueId || null
    };

    const messages = await buildConversation(ticketId, companyId);
    if (!messages.length) return;

    const maxSteps = agent.maxToolSteps || 5;
    let finalText = "";
    let transferred = false;

    for (let step = 0; step <= maxSteps; step += 1) {
      // eslint-disable-next-line no-await-in-loop
      const resp = await callMessages({
        apiKey: agent.apiKey,
        model: agent.model,
        maxTokens: agent.maxTokens,
        temperature: Number(agent.temperature),
        system: systemPrompt,
        messages,
        tools
      });

      const toolUses = extractToolUses(resp.content);

      if (resp.stopReason === "tool_use" && toolUses.length) {
        // Registra a vez do assistente (com os pedidos de ferramenta).
        messages.push({ role: "assistant", content: resp.content });

        const toolResults: any[] = [];
        // eslint-disable-next-line no-restricted-syntax
        for (const tu of toolUses) {
          // eslint-disable-next-line no-await-in-loop
          const result = await executeTool(tu.name, tu.input, agent.tools, ctx);
          if (result.transferred) transferred = true;
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
  } catch (err: any) {
    describeAnthropicError(err);
  } finally {
    runningTickets.delete(ticketId);
  }
}

export default handleAgentReply;
