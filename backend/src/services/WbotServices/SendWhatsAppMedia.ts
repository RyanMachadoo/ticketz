import {
  WAMessage,
  AnyMediaMessageContent,
  AnyMessageContent
} from "libzapitu-rf";
import fs from "fs";
import { exec } from "child_process";
import path from "path";
import ffmpegPath from "@ffmpeg-installer/ffmpeg";
import mime from "mime-types";
import iconv from "iconv-lite";
import { Readable } from "stream";
import AppError from "../../errors/AppError";
import GetTicketWbot from "../../helpers/GetTicketWbot";
import Ticket from "../../models/Ticket";
import { verifyMediaMessage, verifyMessage } from "./wbotMessageListener";
import CheckSettings from "../../helpers/CheckSettings";
import saveMediaToFile from "../../helpers/saveMediaFile";
import { getJidOf } from "./getJidOf";
import { logger } from "../../utils/logger";
import { URLCharEncoder } from "../../helpers/URLCharEncoder";
import Whatsapp from "../../models/Whatsapp";
import * as EvoHubProvider from "../EvoHubServices/EvoHubProvider";
import CreateMessageService from "../MessageServices/CreateMessageService";

interface Request {
  media: Express.Multer.File;
  ticket: Ticket;
  caption?: string;
  ptt?: boolean;
}

export type MediaInfo = {
  mediaUrl: string;
  mimetype: string;
  filename: string;
};

const publicFolder = __dirname.endsWith("/dist")
  ? path.resolve(__dirname, "..", "public")
  : path.resolve(__dirname, "..", "..", "..", "public");

const supportedImages = ["image/png", "image/jpg", "image/jpeg", "image/webp"];

const processRecordedAudio = async (audio: string): Promise<Readable> => {
  const outputAudio = `${publicFolder}/${new Date().getTime()}.ogg`;
  return new Promise((resolve, reject) => {
    exec(
      `${ffmpegPath.path} -i "${audio}" -vn -ar 16000 -ac 1 -c:a libopus -b:a 0 ${outputAudio}`,
      (error, _stdout, _stderr) => {
        if (error) reject(error);
        resolve(fs.createReadStream(outputAudio));
      }
    );
  });
};

export const getMessageFileOptions = async (
  fileName: string,
  pathMedia: string,
  mimetype?: string,
  ptt?: boolean
): Promise<AnyMediaMessageContent> => {
  mimetype = mimetype || mime.lookup(pathMedia) || "application/octet-stream";

  const url = pathMedia.match(/^https?:\/\//) && {
    url: pathMedia
  };

  try {
    let options: AnyMediaMessageContent;

    if (mimetype.startsWith("video/")) {
      options = {
        fileName,
        video: url || { stream: fs.createReadStream(pathMedia) }
      };
    } else if (mimetype === "audio/ogg") {
      options = {
        fileName,
        audio: url || { stream: fs.createReadStream(pathMedia) },
        mimetype: "audio/ogg; codecs=opus",
        ptt: true
      };
    } else if (mimetype.startsWith("audio/")) {
      const needConvert = fileName.includes("audio-record-site");
      options = {
        fileName,
        audio: url || {
          stream: needConvert
            ? await processRecordedAudio(pathMedia)
            : fs.createReadStream(pathMedia)
        },
        mimetype: !url && needConvert ? "audio/ogg; codecs=opus" : mimetype,
        ptt: (!url && needConvert) || !!ptt
      };
    } else if (supportedImages.includes(mimetype)) {
      options = {
        fileName,
        image: url || { stream: fs.createReadStream(pathMedia) }
      };
    } else {
      options = {
        fileName,
        document: url || { stream: fs.createReadStream(pathMedia) },
        mimetype
      };
    }

    return options;
  } catch (error) {
    logger.error(
      { message: error.message },
      "Error getting message file options"
    );
    return null;
  }
};

export const sendWhatsappFile = async (
  ticket: Ticket,
  mediaInfo: MediaInfo,
  options: AnyMediaMessageContent
): Promise<WAMessage> => {
  try {
    const wbot = await GetTicketWbot(ticket);

    const sentMessage = await wbot.sendMessage(getJidOf(ticket), options);

    await verifyMediaMessage(sentMessage, ticket, ticket.contact, {
      mediaInfo
    });

    return sentMessage;
  } catch (error) {
    logger.error({ message: error.message }, "Error sending WhatsApp message");
    throw new AppError("ERR_SENDING_WAPP_MSG");
  }
};

export const SendWhatsAppMessage = async (
  ticket: Ticket,
  options: AnyMessageContent
): Promise<WAMessage> => {
  try {
    const wbot = await GetTicketWbot(ticket);

    const sentMessage = await wbot.sendMessage(getJidOf(ticket), options);

    wbot.cacheMessage(sentMessage);

    await verifyMessage(sentMessage, ticket, ticket.contact);

    return sentMessage;
  } catch (error) {
    logger.error({ message: error.message }, "Error sending WhatsApp message");
    throw new AppError("ERR_SENDING_WAPP_MSG");
  }
};

// ===================== Canal WhatsApp OFICIAL (EvoHub) =====================

/** Mapeia o mimetype pro tipo de mídia aceito pela Cloud API. */
function evoHubMediaKind(
  mimetype: string
): "image" | "video" | "audio" | "document" {
  if (mimetype === "image/jpeg" || mimetype === "image/png") return "image";
  if (mimetype.startsWith("video/")) return "video";
  if (mimetype.startsWith("audio/")) return "audio";
  // webp, pdf, docx, xlsx etc. vão como documento.
  return "document";
}

/** Persiste a mensagem enviada (não há echo do Baileys nesse canal). */
async function persistOutgoingEvoHub(
  ticket: Ticket,
  wamid: string,
  body: string,
  mediaType: string,
  mediaUrl?: string
): Promise<void> {
  await CreateMessageService({
    messageData: {
      id: wamid,
      ticketId: ticket.id,
      contactId: ticket.contactId,
      body,
      fromMe: true,
      read: true,
      mediaType,
      mediaUrl,
      ack: 1,
      channel: "whatsapp_oficial"
    },
    companyId: ticket.companyId
  });
  await ticket.update({ lastMessage: body || `[${mediaType}]` });
}

async function sendMediaViaEvoHub(
  connection: Whatsapp,
  ticket: Ticket,
  info: {
    pathMedia: string;
    mimetype: string;
    fileName: string;
    caption?: string;
    savedPath: string;
    size: number;
    fileLimit: number;
  }
): Promise<WAMessage> {
  const { pathMedia, mimetype, fileName, caption, savedPath, size, fileLimit } =
    info;
  const to = ticket.contact.number;

  // Arquivo acima do limite: manda link por texto (mesmo comportamento do Baileys).
  if (size > fileLimit * 1024 * 1024) {
    const fileUrl = savedPath.startsWith("http")
      ? savedPath
      : `${process.env.BACKEND_URL}/public/${savedPath}`;
    const { wamid } = await EvoHubProvider.sendText(
      connection,
      to,
      `📎 *${fileName}*\n\n🔗 ${URLCharEncoder(fileUrl)}`
    );
    await persistOutgoingEvoHub(ticket, wamid, `📎 ${fileName}`, "chat", savedPath);
    return { key: { id: wamid } } as unknown as WAMessage;
  }

  // Fluxo normal da Cloud API: 2 passos (upload -> envia referenciando o media_id).
  const kind = evoHubMediaKind(mimetype);
  const mediaId = await EvoHubProvider.uploadMedia(connection, pathMedia, mimetype);
  const { wamid } = await EvoHubProvider.sendMediaById(
    connection,
    to,
    mediaId,
    kind,
    caption,
    kind === "document" ? fileName : undefined
  );
  await persistOutgoingEvoHub(ticket, wamid, caption || "", kind, savedPath);
  return { key: { id: wamid } } as unknown as WAMessage;
}

// ===========================================================================

export const SendWhatsAppMedia = async ({
  media,
  ticket,
  caption,
  ptt
}: Request): Promise<WAMessage> => {
  try {
    const pathMedia = media.path;

    let fileName = "";
    try {
      fileName = iconv.decode(
        Buffer.from(media.originalname, "binary"),
        "utf8"
      );
    } catch (error) {
      logger.error(
        { message: error.message },
        "Error converting filename to UTF-8:"
      );
    }

    const fileLimit = parseInt(await CheckSettings("uploadLimit", "15"), 10);

    // convert multer file to Readable
    const readableFile = fs.createReadStream(pathMedia);
    const savedPath = await saveMediaToFile(
      {
        data: readableFile,
        mimetype: media.mimetype,
        filename: fileName || media.originalname
      },
      { destination: ticket }
    );
    readableFile.destroy();

    const mediaInfo = {
      mediaUrl: savedPath,
      mimetype: media.mimetype,
      filename: fileName || media.originalname
    };

    // ===== Canal WhatsApp OFICIAL (EvoHub) =====
    const connection = await Whatsapp.findByPk(ticket.whatsappId);
    if (connection && connection.channel === "whatsapp_oficial") {
      return sendMediaViaEvoHub(connection, ticket, {
        pathMedia,
        mimetype: media.mimetype,
        fileName: fileName || media.originalname,
        caption,
        savedPath,
        size: media.size,
        fileLimit
      });
    }

    // ===== Canal Baileys (fluxo original) =====
    if (media.size > fileLimit * 1024 * 1024) {
      const fileUrl = savedPath.startsWith("http")
        ? savedPath
        : `${process.env.BACKEND_URL}/public/${savedPath}`;
      return SendWhatsAppMessage(ticket, {
        text: `📎 *${fileName}*\n\n🔗 ${URLCharEncoder(fileUrl)}`
      });
    }

    const options = await getMessageFileOptions(
      fileName,
      pathMedia,
      media.mimetype,
      ptt
    );
    return sendWhatsappFile(ticket, mediaInfo, {
      caption: caption || undefined,
      fileName,
      ...options
    } as AnyMediaMessageContent);
  } catch (error) {
    logger.error({ message: error.message }, "Error sending WhatsApp media");
    throw new AppError("ERR_SENDING_WAPP_MSG");
  }
};

export default SendWhatsAppMedia;