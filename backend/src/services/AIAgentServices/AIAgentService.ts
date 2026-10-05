import AppError from "../../errors/AppError";
import AIAgent from "../../models/AIAgent";
import Queue from "../../models/Queue";

/**
 * CRUD dos agentes de IA + vínculo com filas (Queue.aiAgentId).
 * A chave da API nunca é devolvida ao frontend; expomos apenas `hasApiKey`.
 */

export interface AIAgentData {
  name?: string;
  apiKey?: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
  tools?: any[];
  maxToolSteps?: number;
  isActive?: boolean;
  queueIds?: number[];
}

/** Serializa o agente para a UI: sem a chave, com hasApiKey e queueIds. */
export async function serializeAgent(agent: AIAgent): Promise<any> {
  const queues = await Queue.findAll({
    where: { aiAgentId: agent.id },
    attributes: ["id", "name", "color"]
  });
  const plain = agent.toJSON() as any;
  delete plain.apiKey;
  return {
    ...plain,
    hasApiKey: !!agent.apiKey,
    queueIds: queues.map(q => q.id),
    queues
  };
}

async function syncQueues(
  agent: AIAgent,
  queueIds: number[] | undefined,
  companyId: number
): Promise<void> {
  if (!Array.isArray(queueIds)) return;

  // Limpa filas que apontavam para este agente e saíram da seleção.
  const current = await Queue.findAll({
    where: { aiAgentId: agent.id, companyId },
    attributes: ["id"]
  });
  const toClear = current
    .map(q => q.id)
    .filter(id => !queueIds.includes(id));
  if (toClear.length) {
    await Queue.update(
      { aiAgentId: null },
      { where: { id: toClear, companyId } }
    );
  }

  // Vincula as filas selecionadas a este agente.
  if (queueIds.length) {
    await Queue.update(
      { aiAgentId: agent.id },
      { where: { id: queueIds, companyId } }
    );
  }
}

export async function listAgents(companyId: number): Promise<any[]> {
  const agents = await AIAgent.findAll({
    where: { companyId },
    order: [["name", "ASC"]]
  });
  return Promise.all(agents.map(a => serializeAgent(a)));
}

export async function showAgent(
  id: number | string,
  companyId: number
): Promise<any> {
  const agent = await AIAgent.findByPk(id);
  if (!agent || agent.companyId !== companyId) {
    throw new AppError("ERR_NO_AGENT_FOUND", 404);
  }
  return serializeAgent(agent);
}

/** Usado internamente (inclui a chave) — não expor via HTTP. */
export async function getAgentRaw(
  id: number,
  companyId: number
): Promise<AIAgent | null> {
  const agent = await AIAgent.findByPk(id);
  if (!agent || agent.companyId !== companyId) return null;
  return agent;
}

const clampTemp = (v: any, fallback: number): number => {
  if (v === undefined || v === null || v === "") return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(1, Math.max(0, n));
};

export async function createAgent(
  data: AIAgentData,
  companyId: number
): Promise<any> {
  if (!data.name || data.name.trim().length < 2) {
    throw new AppError("ERR_AGENT_INVALID_NAME");
  }

  const agent = await AIAgent.create({
    companyId,
    name: data.name.trim(),
    apiKey: data.apiKey || null,
    model: data.model || "claude-3-5-sonnet-latest",
    maxTokens: data.maxTokens ? Number(data.maxTokens) : 1024,
    temperature: clampTemp(data.temperature, 0.7),
    systemPrompt: data.systemPrompt || "",
    tools: Array.isArray(data.tools) ? data.tools : [],
    maxToolSteps: data.maxToolSteps ? Number(data.maxToolSteps) : 5,
    isActive: data.isActive !== undefined ? !!data.isActive : true
  } as any);

  await syncQueues(agent, data.queueIds, companyId);
  return serializeAgent(agent);
}

export async function updateAgent(
  id: number | string,
  data: AIAgentData,
  companyId: number
): Promise<any> {
  const agent = await AIAgent.findByPk(id);
  if (!agent || agent.companyId !== companyId) {
    throw new AppError("ERR_NO_AGENT_FOUND", 404);
  }

  const patch: any = {
    name: data.name !== undefined ? data.name.trim() : agent.name,
    model: data.model !== undefined ? data.model : agent.model,
    maxTokens:
      data.maxTokens !== undefined ? Number(data.maxTokens) : agent.maxTokens,
    temperature:
      data.temperature !== undefined
        ? clampTemp(data.temperature, Number(agent.temperature))
        : agent.temperature,
    systemPrompt:
      data.systemPrompt !== undefined ? data.systemPrompt : agent.systemPrompt,
    tools: Array.isArray(data.tools) ? data.tools : agent.tools,
    maxToolSteps:
      data.maxToolSteps !== undefined
        ? Number(data.maxToolSteps)
        : agent.maxToolSteps,
    isActive: data.isActive !== undefined ? !!data.isActive : agent.isActive
  };

  // Só troca a chave quando vier uma nova não vazia (mantém a atual caso contrário).
  if (data.apiKey !== undefined && data.apiKey !== "") {
    patch.apiKey = data.apiKey;
  }

  await agent.update(patch);
  await syncQueues(agent, data.queueIds, companyId);
  return serializeAgent(agent);
}

export async function deleteAgent(
  id: number | string,
  companyId: number
): Promise<void> {
  const agent = await AIAgent.findByPk(id);
  if (!agent || agent.companyId !== companyId) {
    throw new AppError("ERR_NO_AGENT_FOUND", 404);
  }
  // Desvincula as filas antes de remover (FK é SET NULL, mas garantimos).
  await Queue.update(
    { aiAgentId: null },
    { where: { aiAgentId: agent.id, companyId } }
  );
  await agent.destroy();
}
