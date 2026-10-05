import axios from "axios";
import { getIO } from "../../libs/socket";
import Queue from "../../models/Queue";
import Ticket from "../../models/Ticket";
import { logger } from "../../utils/logger";
import { dispatchWebhookEvent } from "../WebhookServices/DispatchWebhook";
import ShowTicketService from "../TicketServices/ShowTicketService";
import { AnthropicTool } from "./AnthropicProvider";

export const HUMAN_QUEUE_NAME = "Atendimento Humano";

/**
 * Garante uma fila de "atendimento humano" (sem agente) para a empresa, criando
 * se não existir. É a rede de segurança do transfer quando o agente não tem uma
 * fila de transferência configurada. Nunca lança — devolve null em último caso.
 */
export async function getOrCreateHumanQueue(
  companyId: number
): Promise<Queue | null> {
  try {
    const existing = await Queue.findOne({
      where: { companyId, name: HUMAN_QUEUE_NAME }
    });
    if (existing) return existing;

    const palette = [
      "#607D8B",
      "#455A64",
      "#5D4037",
      "#37474F",
      "#6D4C41",
      "#795548",
      "#9E9E9E"
    ];
    // tenta cores da paleta; cor/nome têm unique, então cai no fallback se falhar
    // eslint-disable-next-line no-restricted-syntax
    for (const color of palette) {
      try {
        // eslint-disable-next-line no-await-in-loop
        return await Queue.create({
          name: HUMAN_QUEUE_NAME,
          color,
          companyId,
          greetingMessage: ""
        } as any);
      } catch (e) {
        /* cor em uso: tenta a próxima */
      }
    }
    // fallback: nome com sufixo da empresa + cor aleatória
    for (let i = 0; i < 5; i += 1) {
      const color = `#${Math.floor(Math.random() * 16777215)
        .toString(16)
        .padStart(6, "0")}`;
      try {
        // eslint-disable-next-line no-await-in-loop
        return await Queue.create({
          name: `${HUMAN_QUEUE_NAME} ${companyId}`,
          color,
          companyId,
          greetingMessage: ""
        } as any);
      } catch (e) {
        /* tenta de novo */
      }
    }
    return null;
  } catch (err: any) {
    logger.error(
      `[Agente IA] falha ao obter/criar fila de atendimento humano: ${err?.message}`
    );
    return null;
  }
}

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

/**
 * A Anthropic exige nome de ferramenta no padrão ^[a-zA-Z0-9_-]{1,128}$.
 * Sanitizamos (remove acentos/espaços/símbolos) para nunca dar 400 — e usamos
 * a MESMA função ao enviar e ao localizar a ferramenta, mantendo o casamento.
 */
export function sanitizeToolName(name: string): string {
  const base = (name || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[_-]+|[_-]+$/g, "")
    .slice(0, 128);
  return base || "ferramenta";
}

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

/** Definição da ferramenta nativa de transferência (formato Anthropic). */
function transferToolDef(description?: string): AnthropicTool {
  return {
    name: TRANSFER_TOOL_NAME,
    description:
      description ||
      "Transfere o atendimento para um atendente humano. CHAME esta ferramenta (não apenas prometa que vai transferir) quando: o cliente AGENDAR/confirmar uma visita ou test drive (passe para um vendedor confirmar); pedir para falar com uma pessoa; entrar em negociação de preço/desconto/financiamento/avaliação de troca; quiser fechar/reservar/pagar; for pós-venda/oficina/garantia/reclamação; ou quando você não conseguir resolver ou a ferramenta de consulta falhar. Importante: se você disser ao cliente que vai transferir, você DEVE chamar esta ferramenta na mesma resposta. Ao usar, o atendimento SAI da sua fila e você para de responder.",
    input_schema: {
      type: "object",
      properties: {
        motivo: {
          type: "string",
          description:
            "Motivo da transferência e um resumo do que já coletou (nome, interesse, melhor horário)."
        },
        fila: {
          type: "string",
          description:
            "Nome da fila de destino (opcional). Se vazio, usa a fila de atendimento humano padrão do agente."
        }
      },
      required: ["motivo"]
    }
  };
}

/**
 * Monta a lista de tools (formato Anthropic) para uma config de agente.
 * A ferramenta de transferência é SEMPRE incluída (mesmo que o admin não a
 * tenha adicionado), para o agente sempre conseguir passar para um humano.
 */
export function buildAnthropicTools(tools: any[]): AnthropicTool[] {
  const result: AnthropicTool[] = [];
  let hasTransfer = false;
  (tools || []).forEach(t => {
    if (!t) return;
    if (t.kind === "transfer") {
      result.push(transferToolDef(t.description));
      hasTransfer = true;
      return;
    }
    if (!t.name) return;
    result.push({
      name: sanitizeToolName(t.name),
      description: t.description || "",
      input_schema: buildInputSchema(t.parameters)
    });
  });
  if (!hasTransfer) {
    result.push(transferToolDef());
  }
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
  transferQueueId?: number | null;
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
  logger.info(
    `[Agente IA] ticket=${ctx.ticketId} chamando ferramenta '${toolName}' input=${JSON.stringify(
      input || {}
    ).slice(0, 500)}`
  );

  // Transferência (nativa)
  if (toolName === TRANSFER_TOOL_NAME) {
    return executeTransfer(input, ctx);
  }

  // Casa pelo nome sanitizado (o modelo devolve o nome já sanitizado).
  const def = (agentTools || []).find(
    t => t?.name && sanitizeToolName(t.name) === toolName
  );
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

      const startedAt = Date.now();
      const resp = await axios.request({
        url,
        method: method as any,
        headers,
        data,
        timeout: 15000,
        validateStatus: () => true, // não lança em 4xx/5xx; devolve ao modelo
        maxContentLength: 1_000_000
      });
      const ms = Date.now() - startedAt;

      const contentType = String(
        resp.headers?.["content-type"] || resp.headers?.["Content-Type"] || ""
      );
      logger.info(
        `[Agente IA] ferramenta '${toolName}' HTTP ${method} ${url} -> ${resp.status} (${ms}ms, ${contentType || "?"})`
      );

      const payload =
        typeof resp.data === "string"
          ? resp.data
          : JSON.stringify(resp.data);

      // Dica ao modelo quando a URL devolve página HTML (site) em vez de API JSON.
      if (contentType.includes("text/html")) {
        return {
          content: truncate(
            `A URL retornou uma página HTML (não uma API). Informe que não foi possível consultar automaticamente e peça para transferir ou tente outra ferramenta. Status HTTP ${resp.status}.`
          ),
          isError: true
        };
      }

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

/**
 * Transfere o atendimento: move o ticket para a fila de atendimento humano
 * (SEMPRE sai da fila do agente) e desliga o agente nesse ticket.
 * Ordem do destino: fila citada pelo modelo -> fila de transferência do agente
 * -> fila padrão "Atendimento Humano" (criada se não existir).
 */
async function executeTransfer(
  input: any,
  ctx: AgentToolContext
): Promise<ToolExecutionResult> {
  const ticket = await Ticket.findByPk(ctx.ticketId);
  if (!ticket) {
    return { content: "Ticket não encontrado para transferir.", isError: true };
  }

  let targetQueueId: number | null = null;

  const filaNome = input?.fila ? String(input.fila).trim() : "";
  if (filaNome) {
    const queue = await Queue.findOne({
      where: { name: filaNome, companyId: ctx.companyId }
    });
    if (queue) targetQueueId = queue.id;
  }

  if (!targetQueueId && ctx.transferQueueId) {
    targetQueueId = ctx.transferQueueId;
  }

  if (!targetQueueId) {
    const humanQueue = await getOrCreateHumanQueue(ctx.companyId);
    if (humanQueue) targetQueueId = humanQueue.id;
  }

  // useAgent=false garante que o agente para mesmo se, no pior caso, não houver
  // fila de destino (aí o ticket só fica pendente na fila atual).
  await ticket.update({
    useAgent: false,
    chatbot: false,
    status: "pending",
    userId: null,
    queueId: targetQueueId || ticket.queueId
  });

  try {
    const io = getIO();
    const fullTicket = await ShowTicketService(ctx.ticketId, ctx.companyId);
    io.to(ctx.ticketId.toString())
      .to(`company-${ctx.companyId}-pending`)
      .to(`company-${ctx.companyId}-notification`)
      .to(`queue-${targetQueueId}-pending`)
      .emit(`company-${ctx.companyId}-ticket`, {
        action: "update",
        ticket: fullTicket
      });
  } catch (e) {
    // socket é best-effort
  }

  logger.info(
    `[Agente IA] TRANSFERIDO ticket=${ctx.ticketId} -> fila=${
      targetQueueId || ticket.queueId
    } (agente desligado). Motivo: ${input?.motivo || "-"}`
  );

  return {
    content:
      "Atendimento transferido para um atendente humano. Você saiu desta conversa — dê uma despedida curta e educada e não responda mais.",
    isError: false,
    transferred: true
  };
}
