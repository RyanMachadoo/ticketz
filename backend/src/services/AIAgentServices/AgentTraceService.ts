import { Op } from "sequelize";
import AgentTrace from "../../models/AgentTrace";
import Ticket from "../../models/Ticket";
import Contact from "../../models/Contact";
import AIAgent from "../../models/AIAgent";
import { logger } from "../../utils/logger";
import { estimateCostUsd } from "./AnthropicPricing";

/**
 * Observabilidade do agente: grava e consulta o "raio-x" de cada turno
 * (tokens, custo, latência, trajetória de ferramentas, guardrails).
 */

export interface TraceToolCall {
  name: string;
  status?: string; // ex.: "ok", "error", "blocked", "transfer"
  ms?: number;
  isError?: boolean;
  blocked?: boolean;
  reason?: string;
}

export interface RecordTraceInput {
  companyId: number;
  ticketId: number;
  agentId: number;
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  steps: number;
  toolCalls: TraceToolCall[];
  guardrailEvents: any[];
  stopReason?: string;
  status?: string;
  finalText?: string;
  error?: string;
}

const FINAL_TEXT_MAX = 4000;

/** Grava um trace de turno. Best-effort — nunca quebra o atendimento. */
export async function recordTrace(
  data: RecordTraceInput
): Promise<AgentTrace | null> {
  try {
    const costUsd = estimateCostUsd(
      data.model,
      data.inputTokens,
      data.outputTokens
    );
    const trace = await AgentTrace.create({
      companyId: data.companyId,
      ticketId: data.ticketId,
      agentId: data.agentId,
      model: data.model,
      inputTokens: data.inputTokens || 0,
      outputTokens: data.outputTokens || 0,
      costUsd,
      latencyMs: data.latencyMs || 0,
      steps: data.steps || 0,
      toolCalls: data.toolCalls || [],
      guardrailEvents: data.guardrailEvents || [],
      stopReason: data.stopReason || null,
      status: data.status || "ok",
      finalText: (data.finalText || "").slice(0, FINAL_TEXT_MAX),
      error: data.error ? String(data.error).slice(0, FINAL_TEXT_MAX) : null
    } as any);

    logger.info(
      `[Agente IA][trace] ticket=${data.ticketId} tokens(in/out)=${data.inputTokens}/${data.outputTokens} custo=US$${costUsd} latência=${data.latencyMs}ms passos=${data.steps} status=${data.status}`
    );
    return trace;
  } catch (err: any) {
    logger.error(`[Agente IA][trace] falha ao gravar: ${err?.message}`);
    return null;
  }
}

/** Lista traces recentes da empresa (com filtro opcional por ticket). */
export async function listTraces(params: {
  companyId: number;
  ticketId?: number;
  limit?: number;
  offset?: number;
}): Promise<{ records: any[]; count: number }> {
  const limit = Math.min(Math.max(Number(params.limit) || 50, 1), 200);
  const offset = Math.max(Number(params.offset) || 0, 0);

  const where: any = { companyId: params.companyId };
  if (params.ticketId) where.ticketId = Number(params.ticketId);

  const { rows, count } = await AgentTrace.findAndCountAll({
    where,
    include: [
      {
        model: Ticket,
        attributes: ["id", "uuid"],
        include: [{ model: Contact, attributes: ["id", "name", "number"] }]
      },
      { model: AIAgent, attributes: ["id", "name"] }
    ],
    order: [["createdAt", "DESC"]],
    limit,
    offset
  });

  return { records: rows.map(r => r.toJSON()), count };
}

/** Agregados de custo/uso por período (para um painel resumido). */
export async function summarizeTraces(params: {
  companyId: number;
  since?: Date;
}): Promise<any> {
  const where: any = { companyId: params.companyId };
  if (params.since) where.createdAt = { [Op.gte]: params.since };

  const rows = await AgentTrace.findAll({ where });
  let inputTokens = 0;
  let outputTokens = 0;
  let costUsd = 0;
  let latencySum = 0;
  let errors = 0;
  let transfers = 0;
  let toolCallCount = 0;

  rows.forEach(r => {
    inputTokens += r.inputTokens || 0;
    outputTokens += r.outputTokens || 0;
    costUsd += Number(r.costUsd || 0);
    latencySum += r.latencyMs || 0;
    if (r.status === "error") errors += 1;
    if (r.status === "transferred") transfers += 1;
    toolCallCount += Array.isArray(r.toolCalls) ? r.toolCalls.length : 0;
  });

  const turns = rows.length;
  return {
    turns,
    inputTokens,
    outputTokens,
    costUsd: Math.round(costUsd * 1_000_000) / 1_000_000,
    avgLatencyMs: turns ? Math.round(latencySum / turns) : 0,
    errors,
    transfers,
    toolCalls: toolCallCount
  };
}
