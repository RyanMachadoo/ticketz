import { Request, Response } from "express";
import * as Yup from "yup";
import AppError from "../errors/AppError";
import Webhook from "../models/Webhook";
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
}

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
    active: data.active !== undefined ? data.active : webhook.active
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

  await dispatchWebhookEvent(companyId, event as any, {
    test: true,
    message: "Webhook de teste do ticketz",
    webhookId: webhook.id
  });

  return res.status(200).json({ message: "Test event dispatched" });
};
