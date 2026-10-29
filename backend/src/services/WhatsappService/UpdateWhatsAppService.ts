import * as Yup from "yup";
import { Op } from "sequelize";

import AppError from "../../errors/AppError";
import Whatsapp from "../../models/Whatsapp";
import ShowWhatsAppService from "./ShowWhatsAppService";
import AssociateWhatsappQueue from "./AssociateWhatsappQueue";

export interface WhatsappData {
  name?: string;
  status?: string;
  session?: string;
  isDefault?: boolean;
  greetingMessage?: string;
  complationMessage?: string;
  outOfHoursMessage?: string;
  ratingMessage?: string;
  transferMessage?: string;
  queueIds?: number[];
  companyId?: number;
  token?: string;
  language?: string;
  channel?: string;
  // ===== EvoHub (canal WhatsApp oficial) =====
  evohubBaseUrl?: string;
  evohubToken?: string;
  evohubPhoneNumberId?: string;
  evohubWabaId?: string;
  // Rodízio de vendedores por conexão (aponta para um agente de IA — fallback).
  rodizioAgentId?: number | null;
  // Roteamento próprio da conexão.
  sellers?: any[];
  notifyWhatsappId?: number | null;
  qualityNumber?: string;
}

const onlyDigits = (s: string): string => String(s || "").replace(/\D/g, "");

/** Normaliza o pool de vendedores salvo na conexão. */
function sanitizeSellers(list: any[]): any[] {
  return (Array.isArray(list) ? list : [])
    .map((s: any) => ({
      nome: String(s?.nome || "").trim(),
      numero: onlyDigits(s?.numero),
      aliases: Array.isArray(s?.aliases)
        ? s.aliases.map((a: any) => String(a).trim()).filter(Boolean)
        : String(s?.aliases || "")
            .split(",")
            .map((a: string) => a.trim())
            .filter(Boolean),
      ativo: s?.ativo === undefined ? true : !!s.ativo
    }))
    .filter(s => s.nome || s.numero);
}

interface Request {
  whatsappData: WhatsappData;
  whatsappId: string;
  companyId: number;
}

interface Response {
  whatsapp: Whatsapp;
  oldDefaultWhatsapp: Whatsapp | null;
}

const UpdateWhatsAppService = async ({
  whatsappData,
  whatsappId,
  companyId
}: Request): Promise<Response> => {
  const schema = Yup.object().shape({
    name: Yup.string().min(2),
    status: Yup.string(),
    isDefault: Yup.boolean()
  });

  const {
    name,
    status,
    isDefault,
    session,
    greetingMessage,
    complationMessage,
    outOfHoursMessage,
    ratingMessage,
    transferMessage,
    queueIds,
    token,
    language,
    evohubBaseUrl,
    evohubToken,
    evohubPhoneNumberId,
    evohubWabaId,
    rodizioAgentId,
    sellers,
    notifyWhatsappId,
    qualityNumber
  } = whatsappData;

  try {
    await schema.validate({ name, status, isDefault });
  } catch (err: unknown) {
    throw new AppError((err as Error).message);
  }

  if (queueIds?.length > 1 && !greetingMessage) {
    throw new AppError("ERR_WAPP_GREETING_REQUIRED");
  }

  let oldDefaultWhatsapp: Whatsapp | null = null;

  if (isDefault) {
    oldDefaultWhatsapp = await Whatsapp.findOne({
      where: {
        isDefault: true,
        id: { [Op.not]: whatsappId },
        companyId
      }
    });
    if (oldDefaultWhatsapp) {
      await oldDefaultWhatsapp.update({ isDefault: false });
    }
  }

  const whatsapp = await ShowWhatsAppService(whatsappId);

  if (!whatsapp) {
    throw new AppError("ERR_WAPP_NOT_FOUND", 404);
  }

  await whatsapp.update({
    name,
    status,
    session,
    greetingMessage,
    complationMessage,
    outOfHoursMessage,
    ratingMessage,
    isDefault,
    companyId,
    token,
    transferMessage,
    language,
    // Config do canal oficial (EvoHub). O channel em si não é alterado aqui:
    // é definido na criação da conexão.
    evohubBaseUrl,
    evohubToken,
    evohubPhoneNumberId,
    evohubWabaId,
    // Rodízio por conexão: normaliza "" / 0 para null.
    rodizioAgentId: rodizioAgentId ? Number(rodizioAgentId) : null,
    // Roteamento próprio da conexão.
    ...(sellers !== undefined ? { sellers: sanitizeSellers(sellers) } : {}),
    ...(notifyWhatsappId !== undefined
      ? { notifyWhatsappId: notifyWhatsappId ? Number(notifyWhatsappId) : null }
      : {}),
    ...(qualityNumber !== undefined
      ? { qualityNumber: qualityNumber ? onlyDigits(qualityNumber) : null }
      : {})
  });

  if (queueIds) {
    await AssociateWhatsappQueue(whatsapp, queueIds);
  }

  return { whatsapp, oldDefaultWhatsapp };
};

export default UpdateWhatsAppService;
