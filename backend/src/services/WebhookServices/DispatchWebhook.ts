import axios from "axios";
import crypto from "crypto";
import Webhook from "../../models/Webhook";
import { logger } from "../../utils/logger";

export type WebhookEvent =
  | "message.received"
  | "message.sent"
  | "message.delivered"
  | "message.read"
  | "message.failed"
  | "ticket.created"
  | "ticket.updated"
  | "ticket.closed"
  | "ctwa.lead"
  | "lead.handoff"
  | "agent.custom";

/**
 * Eventos que um webhook pode assinar (independentes do agente de IA).
 * "agent.custom" = ferramenta "Webhook" do agente de IA. Como o nome do evento
 * da ferramenta é livre (ex.: "agent.custom", "agent.lead_qualificado"), quem
 * assina "agent.custom" recebe TODOS os eventos "agent.*"; o nome exato vai no
 * campo `event` do payload para o n8n diferenciar.
 */
export const WEBHOOK_EVENTS: WebhookEvent[] = [
  "message.received",
  "message.sent",
  "message.delivered",
  "message.read",
  "message.failed",
  "ticket.created",
  "ticket.updated",
  "ticket.closed",
  "ctwa.lead",
  "lead.handoff",
  "agent.custom"
];

const AGENT_CATCH_ALL = "agent.custom";

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

/** O webhook assinou este evento? ("agent.custom" cobre todos os "agent.*") */
const subscribes = (webhook: Webhook, event: string): boolean => {
  const events = Array.isArray(webhook.events) ? webhook.events : [];
  if (events.includes(event)) return true;
  return event.startsWith("agent.") && events.includes(AGENT_CATCH_ALL);
};

// Eventos de alto volume: só loga quando há destino/erro (evita poluir o log).
const isHighVolume = (event: string): boolean =>
  event.startsWith("message.") || event === "ticket.updated";

/** Grava a última entrega do webhook (best-effort, nunca quebra o envio). */
const recordDelivery = async (
  webhookId: number,
  event: string,
  ok: boolean,
  status: string
): Promise<void> => {
  try {
    await Webhook.update(
      {
        lastDeliveryAt: new Date(),
        lastDeliveryEvent: event,
        lastDeliveryOk: ok,
        lastDeliveryStatus: status.slice(0, 500)
      } as any,
      { where: { id: webhookId } }
    );
  } catch (e) {
    // best-effort
  }
};

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
 *
 * Retorna quantos webhooks receberam o evento com sucesso (HTTP 2xx).
 */
export const dispatchWebhookEvent = async (
  companyId: number,
  event: WebhookEvent | string,
  data: any,
  opts?: DispatchOptions
): Promise<number> => {
  try {
    if (!companyId) return 0;

    const whatsappId = resolveWhatsappId(data, opts);

    const webhooks = await Webhook.findAll({
      where: opts?.onlyWebhookId
        ? { companyId, id: opts.onlyWebhookId }
        : { companyId, active: true }
    });

    let targets: Webhook[];
    if (opts?.onlyWebhookId) {
      targets = webhooks;
    } else {
      const subscribed = webhooks.filter(w => subscribes(w, event));
      targets = subscribed.filter(w => {
        const bound = boundConnections(w);
        if (!bound.length) return true; // sem vínculo = todas as conexões
        return whatsappId !== null && bound.includes(whatsappId);
      });

      if (!targets.length) {
        if (subscribed.length && !isHighVolume(event)) {
          logger.info(
            `[Webhook] '${event}' (conexão ${
              whatsappId || "?"
            }): ${subscribed.length} webhook(s) assinam o evento mas estão vinculados a outra(s) conexão(ões) — nada enviado.`
          );
        } else if (!isHighVolume(event)) {
          logger.warn(
            `[Webhook] '${event}': nenhum webhook ATIVO assina este evento (Integrações). Nada enviado.`
          );
        }
        return 0;
      }
    }

    if (!targets.length) {
      logger.warn(`[Webhook] '${event}': webhook de teste não encontrado.`);
      return 0;
    }

    const payload = {
      event,
      timestamp: new Date().toISOString(),
      companyId,
      whatsappId,
      data: toPlain(data)
    };
    const body = JSON.stringify(payload);

    const results = await Promise.all(
      targets.map(async webhook => {
        try {
          const headers: Record<string, string> = {
            "Content-Type": "application/json",
            "X-Ticketz-Event": String(event)
          };
          if (webhook.secret) {
            headers["X-Ticketz-Signature"] = `sha256=${crypto
              .createHmac("sha256", webhook.secret)
              .update(body)
              .digest("hex")}`;
          }
          const res = await axios.post(webhook.url, body, {
            headers,
            timeout: 15000
          });
          logger.info(
            `[Webhook] '${event}' (conexão ${whatsappId || "?"}) -> "${
              webhook.name
            }" ${webhook.url} OK (HTTP ${res?.status}).`
          );
          await recordDelivery(webhook.id, event, true, `HTTP ${res?.status}`);
          return true;
        } catch (err: any) {
          const status = err?.response?.status;
          const detail = err?.response?.data
            ? JSON.stringify(err.response.data).slice(0, 300)
            : "";
          logger.warn(
            `[Webhook] FALHA '${event}' -> "${webhook.name}" ${webhook.url}: ${
              status ? `HTTP ${status} ` : ""
            }${err?.message}${detail ? ` | resposta: ${detail}` : ""}`
          );
          await recordDelivery(
            webhook.id,
            event,
            false,
            `${status ? `HTTP ${status} ` : ""}${err?.message || "erro"}`
          );
          return false;
        }
      })
    );
    return results.filter(Boolean).length;
  } catch (err: any) {
    logger.error(`[Webhook] erro no dispatch de '${event}': ${err?.message}`);
    return 0;
  }
};

export default dispatchWebhookEvent;
