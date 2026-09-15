import Bull from "bull";
import { logger } from "../utils/logger";
import Whatsapp from "../models/Whatsapp";
import Message from "../models/Message";
import CreateOrUpdateContactService from "../services/ContactServices/CreateOrUpdateContactService";
import FindOrCreateTicketService from "../services/TicketServices/FindOrCreateTicketService";
import CreateMessageService from "../services/MessageServices/CreateMessageService";

/**
 * Processa em background os eventos recebidos do EvoHub (Cloud API oficial).
 * Reaproveita os MESMOS serviços que o fluxo Baileys usa pra persistir:
 *   CreateOrUpdateContactService -> FindOrCreateTicketService -> CreateMessageService
 * Assim contato, ticket, fila, socket e UI funcionam igual ao WhatsApp normal.
 */

export const EVOHUB_CHANNEL = "whatsapp_oficial";

const redisConnection = process.env.REDIS_URI || process.env.IO_REDIS_SERVER || "";

export const evoHubInboundQueue = new Bull("EvoHubInbound", redisConnection, {
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: "fixed", delay: 5000 },
    removeOnComplete: 1000,
    removeOnFail: 5000
  }
});

export interface EvoHubInboundJob {
  whatsappId: number;
  payload: any; // envelope padrão da Meta: { entry: [{ changes: [{ value }] }] }
}

export async function addEvoHubInboundJob(data: EvoHubInboundJob): Promise<void> {
  await evoHubInboundQueue.add(data);
}

// status oficial da Meta -> ack numérico do ticketz (0..3)
const ACK_MAP: Record<string, number> = {
  sent: 1,
  delivered: 2,
  read: 3,
  failed: 0
};

/**
 * Extrai corpo + tipo de mídia de uma mensagem recebida.
 * OBS: em mídia, guardamos o media_id da Meta em mediaUrl. O download real
 * (getMediaUrl -> baixar -> salvar no /public) é um passo separado (ver TODO).
 */
function extractContent(msg: any): {
  body: string;
  mediaType: string;
  mediaUrl?: string;
} {
  switch (msg.type) {
    case "text":
      return { body: msg.text?.body || "", mediaType: "chat" };
    case "image":
      return { body: msg.image?.caption || "", mediaType: "image", mediaUrl: msg.image?.id };
    case "video":
      return { body: msg.video?.caption || "", mediaType: "video", mediaUrl: msg.video?.id };
    case "audio":
      return { body: "", mediaType: "audio", mediaUrl: msg.audio?.id };
    case "document":
      return {
        body: msg.document?.caption || msg.document?.filename || "",
        mediaType: "document",
        mediaUrl: msg.document?.id
      };
    case "sticker":
      return { body: "", mediaType: "sticker", mediaUrl: msg.sticker?.id };
    case "location":
      return {
        body: `location: ${msg.location?.latitude},${msg.location?.longitude}`,
        mediaType: "chat"
      };
    case "button":
      return { body: msg.button?.text || "", mediaType: "chat" };
    case "interactive":
      return {
        body:
          msg.interactive?.button_reply?.title ||
          msg.interactive?.list_reply?.title ||
          "",
        mediaType: "chat"
      };
    default:
      return { body: `[tipo '${msg.type}' ainda nao tratado]`, mediaType: "chat" };
  }
}

evoHubInboundQueue.process(async job => {
  const { whatsappId, payload } = job.data as EvoHubInboundJob;

  const whatsapp = await Whatsapp.findByPk(whatsappId);
  if (!whatsapp) {
    logger.warn(`[EvoHub] conexao ${whatsappId} nao encontrada; ignorando evento`);
    return;
  }
  const { companyId } = whatsapp;

  const changes =
    payload?.entry?.flatMap((e: any) => e.changes || []) ?? [];

  for (const change of changes) {
    const value = change?.value || {};

    // 1) Mensagens RECEBIDAS
    for (const msg of value.messages || []) {
      const waId: string = msg.from; // ex.: "5516999999999"
      const profileName =
        value.contacts?.find((c: any) => c.wa_id === waId)?.profile?.name || waId;

      const contact = await CreateOrUpdateContactService({
        name: profileName,
        number: waId,
        isGroup: false,
        companyId,
        channel: EVOHUB_CHANNEL
      });

      const { ticket } = await FindOrCreateTicketService(
        contact,
        whatsapp.id,
        companyId,
        { incrementUnread: true }
      );

      const { body, mediaType, mediaUrl } = extractContent(msg);

      await CreateMessageService({
        messageData: {
          id: msg.id, // wamid oficial
          ticketId: ticket.id,
          contactId: contact.id,
          body,
          fromMe: false,
          read: false,
          mediaType,
          mediaUrl,
          ack: 0,
          channel: EVOHUB_CHANNEL
        },
        companyId
      });
    }

    // 2) STATUS de mensagens enviadas (sent/delivered/read/failed) -> ack
    for (const st of value.statuses || []) {
      const ack = ACK_MAP[st.status] ?? 0;
      await Message.update({ ack }, { where: { id: st.id } });
    }
  }
});

logger.info("[EvoHub] fila de entrada registrada");
