import { Request, Response } from "express";
import { getReport, listLeads } from "../services/CtwaServices/CtwaService";

/**
 * Relatório de leads Click-to-WhatsApp (atribuição por anúncio).
 */

interface ReportQuery {
  startDate?: string;
  endDate?: string;
  sourceId?: string;
}

export const report = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { companyId } = req.user;
  const { startDate, endDate } = req.query as ReportQuery;
  const records = await getReport(companyId, startDate, endDate);
  return res.status(200).json({ records });
};

export const leads = async (req: Request, res: Response): Promise<Response> => {
  const { companyId } = req.user;
  const { startDate, endDate, sourceId } = req.query as ReportQuery;
  const records = await listLeads(companyId, startDate, endDate, sourceId);
  return res.status(200).json({ records });
};
