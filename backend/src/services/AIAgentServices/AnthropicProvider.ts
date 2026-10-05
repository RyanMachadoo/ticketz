import axios from "axios";
import { logger } from "../../utils/logger";

/**
 * Cliente da API da Anthropic (Claude) — Messages API.
 * https://docs.anthropic.com/en/api/messages
 *
 * Mantém o loop de uso de ferramentas (tool use): envia as mensagens + tools;
 * se o modelo pedir ferramenta (stop_reason = "tool_use"), o chamador executa
 * e devolve o resultado; repetimos até o modelo responder (end_turn) ou bater
 * o limite de passos.
 */

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

export interface AnthropicTool {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, any>;
    required?: string[];
  };
}

export interface AnthropicMessage {
  role: "user" | "assistant";
  content: any; // string | content blocks[]
}

export interface AnthropicCallParams {
  apiKey: string;
  model: string;
  maxTokens: number;
  temperature: number;
  system: string;
  messages: AnthropicMessage[];
  tools?: AnthropicTool[];
}

export interface AnthropicResponse {
  stopReason: string;
  content: any[]; // blocks de resposta (text / tool_use)
  raw: any;
}

/** Faz UMA chamada à Messages API e devolve o conteúdo bruto + stop_reason. */
export async function callMessages(
  params: AnthropicCallParams
): Promise<AnthropicResponse> {
  const { apiKey, model, maxTokens, temperature, system, messages, tools } =
    params;

  if (!apiKey) {
    throw new Error("[Agente IA] chave da API da Anthropic ausente");
  }

  const body: any = {
    model,
    max_tokens: maxTokens || 1024,
    temperature: temperature === undefined ? 0.7 : Number(temperature),
    messages
  };
  if (system) body.system = system;
  if (tools && tools.length) body.tools = tools;

  const { data } = await axios.post(ANTHROPIC_URL, body, {
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
      "content-type": "application/json"
    },
    timeout: 60000
  });

  return {
    stopReason: data?.stop_reason,
    content: data?.content || [],
    raw: data
  };
}

/** Extrai o texto final (concatena todos os blocos de texto da resposta). */
export function extractText(content: any[]): string {
  if (!Array.isArray(content)) return "";
  return content
    .filter(b => b?.type === "text" && b.text)
    .map(b => b.text)
    .join("\n")
    .trim();
}

/** Extrai os pedidos de ferramenta (blocos tool_use) da resposta. */
export function extractToolUses(
  content: any[]
): Array<{ id: string; name: string; input: any }> {
  if (!Array.isArray(content)) return [];
  return content
    .filter(b => b?.type === "tool_use")
    .map(b => ({ id: b.id, name: b.name, input: b.input || {} }));
}

/** Normaliza erros da API num texto curto e seguro (sem vazar a chave). */
export function describeAnthropicError(err: any): string {
  const apiMsg =
    err?.response?.data?.error?.message ||
    err?.response?.data?.message ||
    err?.message;
  const status = err?.response?.status;
  logger.error(
    `[Agente IA] erro Anthropic status=${status || "?"}: ${apiMsg || "desconhecido"}`
  );
  return apiMsg || "erro ao chamar a API da Anthropic";
}
