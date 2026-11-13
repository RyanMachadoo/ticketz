import Message from "../../models/Message";
import Ticket from "../../models/Ticket";
import Contact from "../../models/Contact";
import { logger } from "../../utils/logger";
import { dispatchWebhookEvent } from "./DispatchWebhook";

export type MessageStatus = "delivered" | "read" | "failed";

/**
 * Webhook de STATUS de mensagem enviada (entregue / lida / falhou), vindo do
 * Baileys (ack) ou da Cloud API/EvoHub (statuses). Aceita a instância já
 * carregada ou o id (wamid) da mensagem. Fire-and-forget: nunca lança.
 */
export async function dispatchMessageStatus(
  companyId: number,
  messageOrId: Message | string,
  status: MessageStatus,
  extra?: { whatsappId?: number | null; error?: any }
): Promise<void> {
  try {
    let message: Message | null =
      typeof messageOrId === "string" ? null : messageOrId;
    if (!message && typeof messageOrId === "string") {
      message = await Message.findByPk(messageOrId, {
        include: [
          { model: Contact, as: "contact" },
          {
            model: Ticket,
            as: "ticket",
            include: [{ model: Contact, as: "contact" }]
          }
        ]
      });
    }
    if (!message) return;

    const plain: any =
      typeof (message as any).toJSON === "function"
        ? (message as any).toJSON()
        : message;

    await dispatchWebhookEvent(
      companyId,
      `message.${status}`,
      {
        ...plain,
        status,
        error: extra?.error || plain.error || null
      },
      { whatsappId: extra?.whatsappId ?? plain?.ticket?.whatsappId ?? null }
    );
  } catch (err: any) {
    logger.warn(
      `[Webhook] falha ao preparar 'message.${status}': ${err?.message}`
    );
  }
}

export default dispatchMessageStatus;
