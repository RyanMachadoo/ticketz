import { Request, Response } from "express";
import AppError from "../errors/AppError";
import Whatsapp from "../models/Whatsapp";
import { getIO } from "../libs/socket";
import {
  buildUsageSummary,
  getCurrentPeriod,
  listOfficialUsage
} from "../services/UsageServices/UsageService";

/**
 * Módulo "Custos / Uso" do canal oficial (EvoHub).
 * Mostra consumo e custo por conexão e permite configurar limite/preços e
 * bloquear/desbloquear o envio. Restrito a admin.
 */

const ensureAdmin = (req: Request): void => {
  if (req.user.profile !== "admin") {
    throw new AppError("ERR_NO_PERMISSION", 403);
  }
};

const getOfficialConnection = async (
  id: string | number,
  companyId: number
): Promise<Whatsapp> => {
  const whatsapp = await Whatsapp.findByPk(id);
  if (!whatsapp || whatsapp.companyId !== companyId) {
    throw new AppError("ERR_NO_WAPP_FOUND", 404);
  }
  if (whatsapp.channel !== "whatsapp_oficial") {
    throw new AppError("ERR_WAPP_NOT_OFFICIAL", 400);
  }
  return whatsapp;
};

const emitUpdate = (companyId: number, summary: any): void => {
  const io = getIO();
  io.emit(`company-${companyId}-waUsage`, {
    action: "update",
    record: summary
  });
};

/** Lista o consumo/custo de todas as conexões oficiais da empresa (mês atual). */
export const index = async (req: Request, res: Response): Promise<Response> => {
  const { companyId } = req.user;
  const records = await listOfficialUsage(companyId);
  return res.status(200).json({ period: getCurrentPeriod(), records });
};

interface ConfigData {
  serviceMonthlyLimit?: number | null;
  serviceFreeTier?: number;
  priceService?: number;
  priceMarketing?: number;
  priceUtility?: number;
  priceAuthentication?: number;
}

const toIntOrNull = (v: any): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
};

const toPrice = (v: any, fallback: number): number => {
  if (v === null || v === undefined || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

/** Atualiza limite mensal, franquia e preços por categoria de uma conexão. */
export const updateConfig = async (
  req: Request,
  res: Response
): Promise<Response> => {
  ensureAdmin(req);
  const { whatsappId } = req.params;
  const { companyId } = req.user;
  const data = req.body as ConfigData;

  const whatsapp = await getOfficialConnection(whatsappId, companyId);

  const freeTier =
    data.serviceFreeTier === undefined
      ? whatsapp.serviceFreeTier
      : Math.max(0, toIntOrNull(data.serviceFreeTier) ?? 0);

  await whatsapp.update({
    serviceMonthlyLimit:
      data.serviceMonthlyLimit === undefined
        ? whatsapp.serviceMonthlyLimit
        : toIntOrNull(data.serviceMonthlyLimit),
    serviceFreeTier: freeTier,
    priceService: toPrice(data.priceService, whatsapp.priceService),
    priceMarketing: toPrice(data.priceMarketing, whatsapp.priceMarketing),
    priceUtility: toPrice(data.priceUtility, whatsapp.priceUtility),
    priceAuthentication: toPrice(
      data.priceAuthentication,
      whatsapp.priceAuthentication
    )
  });

  const summary = await buildUsageSummary(whatsapp);
  emitUpdate(companyId, summary);
  return res.status(200).json(summary);
};

/** Bloqueia manualmente o envio de mensagens de serviço da conexão. */
export const block = async (req: Request, res: Response): Promise<Response> => {
  ensureAdmin(req);
  const { whatsappId } = req.params;
  const { companyId } = req.user;

  const whatsapp = await getOfficialConnection(whatsappId, companyId);
  await whatsapp.update({
    usageManualBlock: true,
    usageOverridePeriod: null
  });

  const summary = await buildUsageSummary(whatsapp);
  emitUpdate(companyId, summary);
  return res.status(200).json(summary);
};

/**
 * Desbloqueia o envio: tira o bloqueio manual e, se o bloqueio veio do limite
 * mensal, libera o mês corrente (override) para que o envio volte mesmo acima
 * do limite. No mês seguinte o limite volta a valer automaticamente.
 */
export const unblock = async (
  req: Request,
  res: Response
): Promise<Response> => {
  ensureAdmin(req);
  const { whatsappId } = req.params;
  const { companyId } = req.user;

  const whatsapp = await getOfficialConnection(whatsappId, companyId);
  await whatsapp.update({
    usageManualBlock: false,
    usageOverridePeriod: getCurrentPeriod()
  });

  const summary = await buildUsageSummary(whatsapp);
  emitUpdate(companyId, summary);
  return res.status(200).json(summary);
};
