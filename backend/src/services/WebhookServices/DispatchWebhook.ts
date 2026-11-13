import axios from "axios";
import crypto from "crypto";
import Webhook from "../../models/Webhook";
import { logger } from "../../utils/logger";

export type WebhookEvent =
  | "message.received"
  | "message.sent"
  | "ticket.created"
  | "ticket.updated"
  | "ctwa.lead";

export const WEBHOOK_EVENTS: WebhookEvent[] = [
  "message.received",
  "message.sent",
  "ticket.created",
  "ticket.updated",
  "ctwa.lead"
];

export interface DispatchOptions {
  // Conexão de origem do evento. Se omitida, é lida do próprio dado
  // (data.whatsappId ou data.ticket.whatsappId).
  whatsappId?: number | null;
  // Envia SOMENTE para este webhook, ignorando eventos/conexões/ativo (teste).
  onlyWebhookId?: number;
}

const resolveWhatsappId = (data: any, opts?: DispatchOptions): number | null => {
  const raw = opts?.whatsappId ?? data?.whatsappId ?? data?.ticket?.whatsappId;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
};

const boundConnections = (webhook: Webhook): number[] =>
  (Array.isArray(webhook.whatsappIds) ? webhook.whatsappIds : [])
    .map(Number)
    .filter(n => Number.isFinite(n) && n > 0);

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
 *
 * Vínculo por CONEXÃO: um webhook com `whatsappIds` preenchido só recebe
 * eventos originados nessas conexões; sem vínculo, recebe de todas.
 */
export const dispatchWebhookEvent = async (
  companyId: number,
  event: WebhookEvent,
  data: any,
  opts?: DispatchOptions
): Promise<void> => {
  try {
    if (!companyId) return;

    const whatsappId = resolveWhatsappId(data, opts);

    const webhooks = await Webhook.findAll({
      where: opts?.onlyWebhookId
        ? { companyId, id: opts.onlyWebhookId }
        : { companyId, active: true }
    });

    const targets = opts?.onlyWebhookId
      ? webhooks
      : webhooks.filter(w => {
          if (!Array.isArray(w.events) || !w.events.includes(event)) {
            return false;
          }
          const bound = boundConnections(w);
          if (!bound.length) return true; // sem vínculo = todas as conexões
          return whatsappId !== null && bound.includes(whatsappId);
        });

    if (!targets.length) return;

    const payload = {
      event,
      timestamp: new Date().toISOString(),
      companyId,
      whatsappId,
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
