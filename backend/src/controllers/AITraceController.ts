import { Request, Response } from "express";
import {
  listTraces,
  summarizeTraces
} from "../services/AIAgentServices/AgentTraceService";

/**
 * Observabilidade do agente de IA: lista os traces (raio-x por turno) e um
 * resumo agregado (tokens, custo, latência, erros) por período.
 */

export const index = async (req: Request, res: Response): Promise<Response> => {
  const { companyId } = req.user;
  const { ticketId, limit, offset } = req.query as any;
  const data = await listTraces({
    companyId,
    ticketId: ticketId ? Number(ticketId) : undefined,
    limit: limit ? Number(limit) : undefined,
    offset: offset ? Number(offset) : undefined
  });
  return res.status(200).json(data);
};

export const summary = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { companyId } = req.user;
  const { days } = req.query as any;
  const d = Number(days) > 0 ? Number(days) : 30;
  const since = new Date(Date.now() - d * 24 * 60 * 60 * 1000);
  const data = await summarizeTraces({ companyId, since });
  return res.status(200).json({ ...data, days: d });
};
