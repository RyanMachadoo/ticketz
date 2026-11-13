import { Request, Response } from "express";
import * as Yup from "yup";
import AppError from "../errors/AppError";
import Webhook from "../models/Webhook";
import Whatsapp from "../models/Whatsapp";
import {
  dispatchWebhookEvent,
  WEBHOOK_EVENTS
} from "../services/WebhookServices/DispatchWebhook";

/**
 * CRUD dos webhooks de saída (integração, ex.: n8n). Restrito a admin.
 */

const ensureAdmin = (req: Request): void => {
  if (req.user.profile !== "admin") {
    throw new AppError("ERR_NO_PERMISSION", 403);
  }
};

interface WebhookData {
  name?: string;
  url?: string;
  events?: string[];
  secret?: string;
  active?: boolean;
  whatsappIds?: number[] | null;
}

/**
 * Conexões vinculadas: só ids de conexões da própria empresa.
 * Lista vazia/ausente = null (webhook vale para todas as conexões).
 */
const sanitizeWhatsappIds = async (
  ids: any,
  companyId: number
): Promise<number[] | null> => {
  if (!Array.isArray(ids)) return null;
  const wanted = Array.from(
    new Set(ids.map(Number).filter(n => Number.isInteger(n) && n > 0))
  );
  if (!wanted.length) return null;
  const found = await Whatsapp.findAll({
    where: { id: wanted, companyId },
    attributes: ["id"]
  });
  const valid = found.map(w => w.id);
  return valid.length ? valid : null;
};

const sanitizeEvents = (events?: string[]): string[] => {
  if (!Array.isArray(events)) return [];
  return events.filter(e => WEBHOOK_EVENTS.includes(e as any));
};

export const index = async (req: Request, res: Response): Promise<Response> => {
  const { companyId } = req.user;
  const webhooks = await Webhook.findAll({
    where: { companyId },
    order: [["name", "ASC"]]
  });
  return res.status(200).json(webhooks);
};

export const store = async (req: Request, res: Response): Promise<Response> => {
  ensureAdmin(req);
  const { companyId } = req.user;
  const data = req.body as WebhookData;

  const schema = Yup.object().shape({
    name: Yup.string().required().min(2),
    url: Yup.string().required().url()
  });

  try {
    await schema.validate({ name: data.name, url: data.url });
  } catch (err: any) {
    throw new AppError(err.message);
  }

  const webhook = await Webhook.create({
    name: data.name,
    url: data.url,
    events: sanitizeEvents(data.events),
    secret: data.secret || null,
    active: data.active !== undefined ? data.active : true,
    whatsappIds: await sanitizeWhatsappIds(data.whatsappIds, companyId),
    companyId
  });

  return res.status(200).json(webhook);
};

export const show = async (req: Request, res: Response): Promise<Response> => {
  const { id } = req.params;
  const { companyId } = req.user;

  const webhook = await Webhook.findByPk(id);
  if (!webhook || webhook.companyId !== companyId) {
    throw new AppError("ERR_NO_WEBHOOK_FOUND", 404);
  }

  return res.status(200).json(webhook);
};

export const update = async (req: Request, res: Response): Promise<Response> => {
  ensureAdmin(req);
  const { id } = req.params;
  const { companyId } = req.user;
  const data = req.body as WebhookData;

  const webhook = await Webhook.findByPk(id);
  if (!webhook || webhook.companyId !== companyId) {
    throw new AppError("ERR_NO_WEBHOOK_FOUND", 404);
  }

  const schema = Yup.object().shape({
    name: Yup.string().min(2),
    url: Yup.string().url()
  });

  try {
    await schema.validate({ name: data.name, url: data.url });
  } catch (err: any) {
    throw new AppError(err.message);
  }

  await webhook.update({
    name: data.name ?? webhook.name,
    url: data.url ?? webhook.url,
    events:
      data.events !== undefined ? sanitizeEvents(data.events) : webhook.events,
    secret: data.secret !== undefined ? data.secret || null : webhook.secret,
    active: data.active !== undefined ? data.active : webhook.active,
    whatsappIds:
      data.whatsappIds !== undefined
        ? await sanitizeWhatsappIds(data.whatsappIds, companyId)
        : webhook.whatsappIds
  });

  return res.status(200).json(webhook);
};

export const remove = async (req: Request, res: Response): Promise<Response> => {
  ensureAdmin(req);
  const { id } = req.params;
  const { companyId } = req.user;

  const webhook = await Webhook.findByPk(id);
  if (!webhook || webhook.companyId !== companyId) {
    throw new AppError("ERR_NO_WEBHOOK_FOUND", 404);
  }

  await webhook.destroy();

  return res.status(200).json({ message: "Webhook deleted" });
};

/**
 * Dispara um evento de teste para o webhook, para validar a integração no n8n.
 */
export const test = async (req: Request, res: Response): Promise<Response> => {
  ensureAdmin(req);
  const { id } = req.params;
  const { companyId } = req.user;

  const webhook = await Webhook.findByPk(id);
  if (!webhook || webhook.companyId !== companyId) {
    throw new AppError("ERR_NO_WEBHOOK_FOUND", 404);
  }

  const event = (webhook.events && webhook.events[0]) || "message.received";

  // Teste vai SÓ para este webhook (antes ia para todos que assinavam o evento).
  const bound = Array.isArray(webhook.whatsappIds) ? webhook.whatsappIds : [];
  const delivered = await dispatchWebhookEvent(
    companyId,
    event,
    {
      test: true,
      message: "Webhook de teste do ticketz",
      webhookId: webhook.id
    },
    { onlyWebhookId: webhook.id, whatsappId: bound[0] || null }
  );

  if (!delivered) {
    throw new AppError(
      "Falha no teste: a URL do webhook não respondeu com sucesso. Confira a URL (no n8n use a Production URL com o workflow ativo) e veja o log [Webhook] do backend.",
      400
    );
  }

  return res.status(200).json({ message: "Test event dispatched", delivered });
};
