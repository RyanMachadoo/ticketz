import { Request, Response } from "express";
import AppError from "../errors/AppError";
import { getIO } from "../libs/socket";
import {
  createAgent,
  deleteAgent,
  listAgents,
  showAgent,
  updateAgent,
  AIAgentData
} from "../services/AIAgentServices/AIAgentService";

/**
 * CRUD dos agentes de IA (Claude / Anthropic). Restrito a admin nas ações de
 * escrita. A chave da API nunca é retornada (ver serializeAgent).
 */

const ensureAdmin = (req: Request): void => {
  if (req.user.profile !== "admin") {
    throw new AppError("ERR_NO_PERMISSION", 403);
  }
};

const emit = (companyId: number, action: string, record: any): void => {
  const io = getIO();
  io.emit(`company-${companyId}-aiagent`, { action, record });
};

export const index = async (req: Request, res: Response): Promise<Response> => {
  const { companyId } = req.user;
  const records = await listAgents(companyId);
  return res.status(200).json(records);
};

export const show = async (req: Request, res: Response): Promise<Response> => {
  const { id } = req.params;
  const { companyId } = req.user;
  const record = await showAgent(id, companyId);
  return res.status(200).json(record);
};

export const store = async (req: Request, res: Response): Promise<Response> => {
  ensureAdmin(req);
  const { companyId } = req.user;
  const record = await createAgent(req.body as AIAgentData, companyId);
  emit(companyId, "update", record);
  return res.status(200).json(record);
};

export const update = async (
  req: Request,
  res: Response
): Promise<Response> => {
  ensureAdmin(req);
  const { id } = req.params;
  const { companyId } = req.user;
  const record = await updateAgent(id, req.body as AIAgentData, companyId);
  emit(companyId, "update", record);
  return res.status(200).json(record);
};

export const remove = async (
  req: Request,
  res: Response
): Promise<Response> => {
  ensureAdmin(req);
  const { id } = req.params;
  const { companyId } = req.user;
  await deleteAgent(id, companyId);
  emit(companyId, "delete", { id: Number(id) });
  return res.status(200).json({ message: "Agent deleted" });
};
