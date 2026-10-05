import axios from "axios";
import { getIO } from "../../libs/socket";
import Queue from "../../models/Queue";
import Ticket from "../../models/Ticket";
import { logger } from "../../utils/logger";
import { dispatchWebhookEvent } from "../WebhookServices/DispatchWebhook";
import { AnthropicTool } from "./AnthropicProvider";

/**
 * Converte a config de ferramentas do agente (JSON) no formato de tools da
 * Anthropic e executa as chamadas quando o modelo pede.
 *
 * Tipos (kind):
 *  - "http":     chama uma API HTTP externa (método/URL/headers/body com {{param}})
 *  - "webhook":  dispara um webhook de integração (n8n) com os dados coletados
 *  - "transfer": transfere o atendimento para uma fila/humano (nativo)
 *
 * SEGURANÇA: as URLs/headers das ferramentas HTTP são configuradas pelo admin
 * (conteúdo confiável). Mesmo assim, limitamos tempo e tamanho da resposta.
 */

const TRANSFER_TOOL_NAME = "transferir_atendimento";

const jsonTypeOf = (t?: string): string => {
  const v = (t || "string").toLowerCase();
  if (["number", "integer", "boolean"].includes(v)) return v;
  return "string";
};

/** input_schema da Anthropic a partir da lista de parâmetros configurada. */
function buildInputSchema(parameters: any[]): AnthropicTool["input_schema"] {
  const properties: Record<string, any> = {};
  const required: string[] = [];
  (parameters || []).forEach(p => {
    if (!p?.name) return;
    properties[p.name] = {
      type: jsonTypeOf(p.type),
      description: p.description || ""
    };
    if (p.required) required.push(p.name);
  });
  return { type: "object", properties, required };
}

/**
 * Monta a lista de tools (formato Anthropic) para uma config de agente.
 * Sempre inclui a ferramenta nativa de transferência quando habilitada.
 */
export function buildAnthropicTools(tools: any[]): AnthropicTool[] {
  const result: AnthropicTool[] = [];
  (tools || []).forEach(t => {
    if (!t) return;
    if (t.kind === "transfer") {
      result.push({
        name: TRANSFER_TOOL_NAME,
        description:
          t.description ||
          "Transfere o atendimento para uma fila/atendente humano quando necessário (dúvida fora do escopo, pedido do cliente, etc.).",
        input_schema: {
          type: "object",
          properties: {
            motivo: {
              type: "string",
              description: "Motivo da transferência (curto)."
            },
            fila: {
              type: "string",
              description:
                "Nome da fila de destino (opcional). Se vazio, mantém a fila atual."
            }
          },
          required: ["motivo"]
        }
      });
      return;
    }
    if (!t.name) return;
    result.push({
      name: t.name,
      description: t.description || "",
      input_schema: buildInputSchema(t.parameters)
    });
  });
  return result;
}

/** Interpola {{chave}} e {{obj.campo}} usando input + contexto. */
function interpolate(template: string, vars: Record<string, any>): string {
  if (!template) return template;
  return template.replace(/{{\s*([\w.]+)\s*}}/g, (_m, key) => {
    const val = vars[key];
    return val === undefined || val === null ? "" : String(val);
  });
}

/** Achata input + contexto num mapa de chaves (inclui contact.* e ticket.*). */
function buildVars(input: any, ctx: AgentToolContext): Record<string, any> {
  const vars: Record<string, any> = {};
  if (input && typeof input === "object") {
    Object.keys(input).forEach(k => {
      vars[k] = input[k];
    });
  }
  vars["contact.name"] = ctx.contactName;
  vars["contact.number"] = ctx.contactNumber;
  vars["ticket.id"] = ctx.ticketId;
  return vars;
}

export interface AgentToolContext {
  companyId: number;
  ticketId: number;
  contactName: string;
  contactNumber: string;
}

export interface ToolExecutionResult {
  content: string; // texto devolvido ao modelo (tool_result)
  isError: boolean;
  transferred?: boolean;
}

const MAX_RESULT_CHARS = 4000;

const truncate = (s: string): string =>
  s && s.length > MAX_RESULT_CHARS ? `${s.slice(0, MAX_RESULT_CHARS)}…` : s;

/** Executa UMA ferramenta pedida pelo modelo e devolve o resultado em texto. */
export async function executeTool(
  toolName: string,
  input: any,
  agentTools: any[],
  ctx: AgentToolContext
): Promise<ToolExecutionResult> {
  // Transferência (nativa)
  if (toolName === TRANSFER_TOOL_NAME) {
    return executeTransfer(input, ctx);
  }

  const def = (agentTools || []).find(t => t?.name === toolName);
  if (!def) {
    return { content: `Ferramenta '${toolName}' não encontrada.`, isError: true };
  }

  try {
    if (def.kind === "webhook") {
      const event = def.event || "agent.custom";
      await dispatchWebhookEvent(ctx.companyId, event as any, {
        source: "ai-agent",
        ticketId: ctx.ticketId,
        contact: { name: ctx.contactName, number: ctx.contactNumber },
        input
      });
      return {
        content: "Webhook disparado com sucesso.",
        isError: false
      };
    }

    if (def.kind === "http") {
      const vars = buildVars(input, ctx);
      const url = interpolate(def.url || "", vars);
      if (!url) {
        return { content: "URL da ferramenta não configurada.", isError: true };
      }
      const headers: Record<string, string> = {};
      (def.headers || []).forEach((h: any) => {
        if (h?.key) headers[h.key] = interpolate(String(h.value || ""), vars);
      });

      const method = (def.method || "GET").toUpperCase();
      let data: any;
      if (def.bodyTemplate && ["POST", "PUT", "PATCH"].includes(method)) {
        const bodyStr = interpolate(def.bodyTemplate, vars);
        try {
          data = JSON.parse(bodyStr);
          if (!headers["Content-Type"] && !headers["content-type"]) {
            headers["Content-Type"] = "application/json";
          }
        } catch {
          data = bodyStr; // envia como texto se não for JSON válido
        }
      }

      const resp = await axios.request({
        url,
        method: method as any,
        headers,
        data,
        timeout: 15000,
        validateStatus: () => true, // não lança em 4xx/5xx; devolve ao modelo
        maxContentLength: 1_000_000
      });

      const payload =
        typeof resp.data === "string"
          ? resp.data
          : JSON.stringify(resp.data);
      return {
        content: truncate(`HTTP ${resp.status}: ${payload}`),
        isError: resp.status >= 400
      };
    }

    return {
      content: `Tipo de ferramenta '${def.kind}' não suportado.`,
      isError: true
    };
  } catch (err: any) {
    const msg = err?.response?.data
      ? JSON.stringify(err.response.data)
      : err?.message || "erro";
    logger.error(
      `[Agente IA] erro executando ferramenta ${toolName}: ${msg}`
    );
    return { content: truncate(`Erro na ferramenta: ${msg}`), isError: true };
  }
}

/** Transfere o atendimento: tira o agente e deixa o ticket pendente na fila. */
async function executeTransfer(
  input: any,
  ctx: AgentToolContext
): Promise<ToolExecutionResult> {
  const ticket = await Ticket.findByPk(ctx.ticketId);
  if (!ticket) {
    return { content: "Ticket não encontrado para transferir.", isError: true };
  }

  let targetQueueId = ticket.queueId;
  const filaNome = input?.fila ? String(input.fila).trim() : "";
  if (filaNome) {
    const queue = await Queue.findOne({
      where: { name: filaNome, companyId: ctx.companyId }
    });
    if (queue) targetQueueId = queue.id;
  }

  await ticket.update({
    useAgent: false,
    chatbot: false,
    status: "pending",
    userId: null,
    queueId: targetQueueId
  });

  try {
    const io = getIO();
    io.to(`company-${ctx.companyId}-pending`)
      .to(ticket.id.toString())
      .emit(`company-${ctx.companyId}-ticket`, {
        action: "update",
        ticket
      });
  } catch (e) {
    // socket é best-effort
  }

  logger.info(
    `[Agente IA] atendimento transferido (ticket=${ctx.ticketId}) motivo="${
      input?.motivo || ""
    }" fila=${targetQueueId}`
  );

  return {
    content:
      "Atendimento transferido para um atendente humano. Encerre sua participação de forma educada.",
    isError: false,
    transferred: true
  };
}
