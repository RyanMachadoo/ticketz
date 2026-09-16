import { Request, Response } from "express";
import AppError from "../errors/AppError";
import Whatsapp from "../models/Whatsapp";
import * as EvoHubProvider from "../services/EvoHubServices/EvoHubProvider";

/**
 * Módulo "WA API": expõe os recursos da API oficial (via EvoHub) para o front.
 * Por enquanto, a listagem de templates aprovados na WABA, usada tanto na tela
 * WA API quanto na criação de campanhas para conexões oficiais.
 */

/** Conta quantas variáveis {{n}} existem no corpo do template. */
function countBodyVariables(components: any[]): number {
  const body = (components || []).find(
    (c: any) => (c?.type || "").toUpperCase() === "BODY"
  );
  const text: string = body?.text || "";
  const matches = text.match(/{{\s*\d+\s*}}/g);
  return matches ? matches.length : 0;
}

/** Extrai o texto do corpo do template (para preview no front). */
function getBodyText(components: any[]): string {
  const body = (components || []).find(
    (c: any) => (c?.type || "").toUpperCase() === "BODY"
  );
  return body?.text || "";
}

/**
 * GET /wa-api/:whatsappId/templates
 * Lista os templates da WABA vinculada à conexão oficial informada.
 * Query opcional: ?onlyApproved=1 devolve só os APPROVED.
 */
export const templates = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { whatsappId } = req.params;
  const { onlyApproved } = req.query;
  const { companyId } = req.user;

  const whatsapp = await Whatsapp.findByPk(whatsappId);

  if (!whatsapp) {
    throw new AppError("ERR_NO_WAPP_FOUND", 404);
  }

  if (whatsapp.companyId !== companyId) {
    throw new AppError("ERR_FORBIDDEN", 403);
  }

  if (whatsapp.channel !== "whatsapp_oficial") {
    throw new AppError("ERR_WAAPI_NOT_OFFICIAL_CHANNEL", 400);
  }

  if (!whatsapp.evohubWabaId || !whatsapp.evohubToken) {
    throw new AppError("ERR_WAAPI_MISSING_EVOHUB_CONFIG", 400);
  }

  let raw: any[] = [];
  try {
    raw = await EvoHubProvider.getTemplates(whatsapp);
  } catch (err: any) {
    // Erro vindo da Graph/EvoHub (token inválido, WABA errada, etc.)
    const detail =
      err?.response?.data?.error?.message || err?.message || "erro desconhecido";
    throw new AppError(`ERR_WAAPI_TEMPLATES_FETCH: ${detail}`, 400);
  }

  let list = raw.map((t: any) => ({
    name: t.name,
    status: t.status,
    category: t.category,
    language: t.language,
    bodyText: getBodyText(t.components),
    variablesCount: countBodyVariables(t.components),
    components: t.components
  }));

  if (onlyApproved === "1" || onlyApproved === "true") {
    list = list.filter(t => (t.status || "").toUpperCase() === "APPROVED");
  }

  return res.status(200).json(list);
};
