import axios from "axios";
import crypto from "crypto";
import Webhook from "../../models/Webhook";
import { logger } from "../../utils/logger";

export type WebhookEvent =
  | "message.received"
  | "message.sent"
  | "ticket.created"
  | "ticket.updated";

export const WEBHOOK_EVENTS: WebhookEvent[] = [
  "message.received",
  "message.sent",
  "ticket.created",
  "ticket.updated"
];

const toPlain = (entity: any): any => {
  try {
    if (entity && typeof entity.toJSON === "function") {
      return entity.toJSON();
    }
    return JSON.parse(JSON.stringify(entity));
  } catch (err) {
    return entity;
  }
};

/**
 * Dispara um evento para todos os webhooks ativos da empresa que assinaram esse
 * evento. É "fire-and-forget": NUNCA lança exceção nem bloqueia o fluxo principal
 * — qualquer erro (URL fora do ar, timeout) é apenas logado. Chame sem await.
 */
export const dispatchWebhookEvent = async (
  companyId: number,
  event: WebhookEvent,
  data: any
): Promise<void> => {
  try {
    if (!companyId) return;

    const webhooks = await Webhook.findAll({
      where: { companyId, active: true }
    });

    const targets = webhooks.filter(
      w => Array.isArray(w.events) && w.events.includes(event)
    );

    if (!targets.length) return;

    const payload = {
      event,
      timestamp: new Date().toISOString(),
      companyId,
      data: toPlain(data)
    };
    const body = JSON.stringify(payload);

    await Promise.all(
      targets.map(async webhook => {
        try {
          const headers: Record<string, string> = {
            "Content-Type": "application/json",
            "X-Ticketz-Event": event
          };
          if (webhook.secret) {
            headers["X-Ticketz-Signature"] = `sha256=${crypto
              .createHmac("sha256", webhook.secret)
              .update(body)
              .digest("hex")}`;
          }
          await axios.post(webhook.url, body, { headers, timeout: 15000 });
        } catch (err: any) {
          logger.warn(
            `[Webhook] falha ao enviar '${event}' para ${webhook.url}: ${err?.message}`
          );
        }
      })
    );
  } catch (err: any) {
    logger.error(`[Webhook] erro no dispatch de '${event}': ${err?.message}`);
  }
};

export default dispatchWebhookEvent;
