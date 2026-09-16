import Queue from "bull";
import moment from "moment";
import { QueryTypes } from "sequelize";
import { isEmpty, isNil, isArray } from "lodash";
import path from "path";
import { AnyMessageContent } from "libzapitu-rf";
import Campaign from "../models/Campaign";
import ContactList from "../models/ContactList";
import ContactListItem from "../models/ContactListItem";
import CampaignSetting from "../models/CampaignSetting";
import CampaignShipping from "../models/CampaignShipping";
import Whatsapp from "../models/Whatsapp";
import { getMessageFileOptions } from "../services/WbotServices/SendWhatsAppMedia";
import { getIO } from "../libs/socket";
import ShowService from "../services/CampaignService/ShowService";
import sequelize from "../database";
import { logger } from "../utils/logger";
import { randomValue } from "../helpers/randomValue";
import { parseToMilliseconds } from "../helpers/parseToMilliseconds";
import normalizePhone from "../helpers/NormalizePhone";
import GetWhatsappWbot from "../helpers/GetWhatsappWbot";
import OutOfTicketMessage from "../models/OutOfTicketMessages";
import { Session } from "../libs/wbot";
import { getJidOf } from "../services/WbotServices/getJidOf";
import { clearRepeatableJobsFromQueues } from "./repeatableJobs";
import * as EvoHubProvider from "../services/EvoHubServices/EvoHubProvider";

const connection = process.env.REDIS_URI || "";
export const campaignQueue = new Queue("CampaignQueue", connection);

interface ProcessCampaignData {
  id: number;
  delay: number;
}

interface DispatchCampaignData {
  campaignId: number;
  campaignShippingId: number;
  contactListItemId: number;
}

async function handleVerifyCampaigns() {
  /**
   * @todo
   * Implementar filtro de campanhas
   */
  const campaigns: { id: number; scheduledAt: string }[] =
    await sequelize.query(
      `select id, "scheduledAt" from "Campaigns" c
    where "scheduledAt" between now() and now() + '1 hour'::interval and status = 'PROGRAMADA'`,
      { type: QueryTypes.SELECT }
    );

  if (campaigns.length) {
    logger.info(`Campanhas encontradas: ${campaigns.length}`);
  }
  campaigns.forEach(campaign => {
    try {
      const now = moment();
      const scheduledAt = moment(campaign.scheduledAt);
      const delay = scheduledAt.diff(now, "milliseconds");
      logger.info(
        `Campanha enviada para a fila de processamento: Campanha=${campaign.id}, Delay Inicial=${delay}`
      );
      campaignQueue.add(
        "ProcessCampaign",
        {
          id: campaign.id,
          delay
        },
        {
          removeOnComplete: true,
          removeOnFail: 100
        }
      );
    } catch (err) {
      logger.error({ message: err?.message }, "Error verifying campaigns");
    }
  });
}

async function getCampaign(id: number) {
  return Campaign.findByPk(id, {
    include: [
      {
        model: ContactList,
        as: "contactList",
        attributes: ["id", "name"],
        include: [
          {
            model: ContactListItem,
            as: "contacts",
            attributes: ["id", "name", "number", "email", "isWhatsappValid"],
            // Carrega TODOS os contatos (LEFT JOIN). O filtro por número válido é
            // feito em memória e só se aplica ao canal Baileys — no canal oficial
            // (EvoHub) não há pré-validação, então envia para todos.
            required: false
          }
        ]
      },
      {
        model: Whatsapp,
        as: "whatsapp",
        attributes: ["id", "name", "channel"]
      },
      {
        model: CampaignShipping,
        as: "shipping",
        include: [{ model: ContactListItem, as: "contact" }]
      }
    ]
  });
}

async function getSettings(campaign) {
  const settings = await CampaignSetting.findAll({
    where: { companyId: campaign.companyId },
    attributes: ["key", "value"]
  });

  let messageInterval = 20;
  let longerIntervalAfter = 20;
  let greaterInterval = 60;
  let variables: any[] = [];

  settings.forEach(setting => {
    if (setting.key === "messageInterval") {
      messageInterval = JSON.parse(setting.value);
    }
    if (setting.key === "longerIntervalAfter") {
      longerIntervalAfter = JSON.parse(setting.value);
    }
    if (setting.key === "greaterInterval") {
      greaterInterval = JSON.parse(setting.value);
    }
    if (setting.key === "variables") {
      variables = JSON.parse(setting.value);
    }
  });

  return {
    messageInterval,
    longerIntervalAfter,
    greaterInterval,
    variables
  };
}

function getCampaignValidMessages(campaign) {
  const messages = [];

  if (!isEmpty(campaign.message1) && !isNil(campaign.message1)) {
    messages.push(campaign.message1);
  }

  if (!isEmpty(campaign.message2) && !isNil(campaign.message2)) {
    messages.push(campaign.message2);
  }

  if (!isEmpty(campaign.message3) && !isNil(campaign.message3)) {
    messages.push(campaign.message3);
  }

  if (!isEmpty(campaign.message4) && !isNil(campaign.message4)) {
    messages.push(campaign.message4);
  }

  if (!isEmpty(campaign.message5) && !isNil(campaign.message5)) {
    messages.push(campaign.message5);
  }

  return messages;
}

function getCampaignValidConfirmationMessages(campaign) {
  const messages = [];

  if (
    !isEmpty(campaign.confirmationMessage1) &&
    !isNil(campaign.confirmationMessage1)
  ) {
    messages.push(campaign.confirmationMessage1);
  }

  if (
    !isEmpty(campaign.confirmationMessage2) &&
    !isNil(campaign.confirmationMessage2)
  ) {
    messages.push(campaign.confirmationMessage2);
  }

  if (
    !isEmpty(campaign.confirmationMessage3) &&
    !isNil(campaign.confirmationMessage3)
  ) {
    messages.push(campaign.confirmationMessage3);
  }

  if (
    !isEmpty(campaign.confirmationMessage4) &&
    !isNil(campaign.confirmationMessage4)
  ) {
    messages.push(campaign.confirmationMessage4);
  }

  if (
    !isEmpty(campaign.confirmationMessage5) &&
    !isNil(campaign.confirmationMessage5)
  ) {
    messages.push(campaign.confirmationMessage5);
  }

  return messages;
}

function getProcessedMessage(msg: string, variables: any[], contact: any) {
  let finalMessage = msg;

  if (finalMessage.includes("{nome}")) {
    finalMessage = finalMessage.replace(/{nome}/g, contact.name);
  }

  if (finalMessage.includes("{email}")) {
    finalMessage = finalMessage.replace(/{email}/g, contact.email);
  }

  if (finalMessage.includes("{numero}")) {
    finalMessage = finalMessage.replace(/{numero}/g, contact.number);
  }

  variables.forEach(variable => {
    if (finalMessage.includes(`{${variable.key}}`)) {
      const regex = new RegExp(`{${variable.key}}`, "g");
      finalMessage = finalMessage.replace(regex, variable.value);
    }
  });

  return finalMessage;
}

async function verifyAndFinalizeCampaign(campaign: Campaign) {
  const data = await ShowService(campaign.id);

  if (data.valids === data.delivered) {
    await campaign.update({ status: "FINALIZADA", completedAt: moment() });
  }

  const io = getIO();
  io.emit(`company-${campaign.companyId}-campaign`, data);
}

async function prepareContact(
  campaign: Campaign,
  variables: any[],
  contact: ContactListItem,
  delay: number,
  messages: string | any[],
  confirmationMessages: string | any[]
) {
  const campaignShipping: any = {};
  campaignShipping.number = contact.number.endsWith("@lid")
    ? contact.number
    : normalizePhone(contact.number).phone;
  campaignShipping.contactId = contact.id;
  campaignShipping.campaignId = campaign.id;

  if (messages.length) {
    const radomIndex = randomValue(0, messages.length);
    const message = getProcessedMessage(
      messages[radomIndex],
      variables,
      contact
    );
    campaignShipping.message = `${message}`;
  }

  if (campaign.confirmation) {
    if (confirmationMessages.length) {
      const radomIndex = randomValue(0, confirmationMessages.length);
      const message = getProcessedMessage(
        confirmationMessages[radomIndex],
        variables,
        contact
      );
      campaignShipping.confirmationMessage = `${message}`;
    }
  }

  const [record, created] = await CampaignShipping.findOrCreate({
    where: {
      campaignId: campaignShipping.campaignId,
      contactId: campaignShipping.contactId
    },
    defaults: campaignShipping
  });

  if (
    !created &&
    record.deliveredAt === null &&
    record.confirmationRequestedAt === null
  ) {
    record.set(campaignShipping);
    await record.save();
  }

  if (record.deliveredAt === null && record.confirmationRequestedAt === null) {
    const nextJob = await campaignQueue.add(
      "DispatchCampaign",
      {
        campaignId: campaign.id,
        campaignShippingId: record.id,
        contactListItemId: contact.id
      },
      {
        delay,
        removeOnComplete: true,
        removeOnFail: 100
      }
    );

    await record.update({ jobId: `${nextJob.id}` });
  }
}

async function handleProcessCampaign(job) {
  try {
    const { id }: ProcessCampaignData = job.data;
    let { delay }: ProcessCampaignData = job.data;
    logger.info(`[Campanha] ProcessCampaign recebido: id=${id}`);
    const campaign = await getCampaign(id);
    const settings = await getSettings(campaign);
    if (campaign) {
      logger.info(
        `[Campanha] processando id=${campaign.id} status=${
          campaign.status
        } canal=${campaign.whatsapp?.channel} contactList=${!!campaign.contactList} contatos=${
          campaign.contactList?.contacts?.length ?? 0
        }`
      );
      if (!campaign.contactList) {
        logger.error(
          `Campanha ${campaign.id} sem lista de contatos; nada a disparar.`
        );
        await campaign.update({ status: "FINALIZADA", completedAt: moment() });
        return;
      }

      const isOfficial = campaign.whatsapp?.channel === "whatsapp_oficial";
      const allContacts = campaign.contactList.contacts || [];
      // Canal oficial (EvoHub) não tem pré-validação de número: envia para todos.
      // Canal Baileys mantém o filtro de números válidos no WhatsApp.
      const contacts = isOfficial
        ? allContacts
        : allContacts.filter(c => c.isWhatsappValid);

      if (!contacts.length) {
        logger.warn(
          `Campanha ${campaign.id} sem contatos elegíveis (validos=${
            allContacts.length
          }, oficial=${isOfficial}).`
        );
      }

      const messages = getCampaignValidMessages(campaign);
      const confirmationMessages = campaign.confirmation
        ? getCampaignValidConfirmationMessages(campaign)
        : null;
      if (isArray(contacts)) {
        let index = 0;
        contacts.forEach(contact => {
          prepareContact(
            campaign,
            settings.variables,
            contact,
            delay,
            messages,
            confirmationMessages
          ).then(() => {
            logger.info(
              `Registro enviado pra fila de disparo: Campanha=${campaign.id};Contato=${contact.name};Delay=${delay}`
            );
          });

          index += 1;
          if (index % settings.longerIntervalAfter === 0) {
            // intervalo maior após intervalo configurado de mensagens
            delay += parseToMilliseconds(settings.greaterInterval);
          } else {
            delay += parseToMilliseconds(
              randomValue(0, settings.messageInterval)
            );
          }
        });
        await campaign.update({ status: "EM_ANDAMENTO" });
      }
    }
  } catch (err) {
    logger.error({ message: err?.message }, "Error processing campaign");
  }
}

async function sendCampaignMessage(
  whatsappId: number,
  wbot: Session,
  jid: string,
  content: AnyMessageContent
) {
  try {
    const message = await wbot.sendMessage(jid, content);
    wbot.cacheMessage(message);
    OutOfTicketMessage.create({
      id: message.key.id,
      dataJson: JSON.stringify(message),
      whatsappId
    });
    return message;
  } catch (err) {
    logger.error({ message: err?.message }, "Error sending campaign message");
    return null;
  }
}

/**
 * Disparo de campanha para conexão OFICIAL (EvoHub / Cloud API).
 * Envia um template aprovado da Meta:
 *  - HEADER de imagem: usa a imagem anexada à campanha (link público). Necessário
 *    quando o template aprovado tem cabeçalho de imagem (senão a Meta rejeita).
 *  - BODY: preenche as variáveis {{1}}, {{2}}... com os valores da campanha, que
 *    podem conter {nome}, {numero}, etc. (processados por contato).
 * Não usa Baileys/wbot.
 */
async function dispatchOfficialCampaign(
  campaign: Campaign,
  campaignShipping: CampaignShipping
) {
  const settings = await getSettings(campaign);
  const contact = campaignShipping.contact;

  // Garante DDI 55 quando o número vem sem código do país (padrão BR).
  let to = String(campaignShipping.number).replace(/\D/g, "");
  if (to && !to.startsWith("55") && to.length <= 11) {
    to = `55${to}`;
  }

  const rawParams = isArray(campaign.templateParams)
    ? campaign.templateParams
    : [];
  const params = rawParams.map(p =>
    getProcessedMessage(String(p ?? ""), settings.variables, contact)
  );

  const components: any[] = [];

  // Header de imagem (quando o template exige), a partir da mídia da campanha.
  if (campaign.mediaPath) {
    const base = process.env.BACKEND_URL || "";
    const imageUrl = campaign.mediaPath.startsWith("http")
      ? campaign.mediaPath
      : `${base}/public/${campaign.mediaPath}`;
    components.push({
      type: "header",
      parameters: [{ type: "image", image: { link: imageUrl } }]
    });
  }

  if (params.length) {
    components.push({
      type: "body",
      parameters: params.map(text => ({ type: "text", text }))
    });
  }

  const language = campaign.templateLanguage || "pt_BR";

  try {
    await EvoHubProvider.sendTemplate(
      campaign.whatsapp,
      to,
      campaign.templateName,
      language,
      components.length ? components : undefined
    );
  } catch (err: any) {
    // Loga o motivo real vindo da Meta/EvoHub (ex.: header de imagem ausente,
    // template não aprovado, número inválido) para facilitar o diagnóstico.
    const detail =
      err?.response?.data?.error?.message || err?.message || "erro desconhecido";
    logger.error(
      `[Campanha oficial] falha ao enviar template '${campaign.templateName}' para ${to}: ${detail}`
    );
    throw err;
  }

  await campaignShipping.update({ deliveredAt: moment() });
}

async function handleDispatchCampaign(job) {
  try {
    const { data } = job;
    const { campaignShippingId, campaignId }: DispatchCampaignData = data;
    const campaign = await Campaign.findByPk(campaignId, {
      include: ["contactList", { model: Whatsapp, as: "whatsapp" }]
    });

    if (!campaign) {
      logger.error({ data }, "Campaign not found");
      return;
    }

    logger.info(
      `Disparo de campanha solicitado: Campanha=${campaignId};Registro=${campaignShippingId}`
    );

    const campaignShipping = await CampaignShipping.findByPk(
      campaignShippingId,
      {
        include: [{ model: ContactListItem, as: "contact" }]
      }
    );

    // ===== Canal WhatsApp OFICIAL (EvoHub): dispara via template aprovado =====
    if (campaign.whatsapp?.channel === "whatsapp_oficial") {
      await dispatchOfficialCampaign(campaign, campaignShipping);
      await verifyAndFinalizeCampaign(campaign);
      const ioOfficial = getIO();
      ioOfficial.emit(`company-${campaign.companyId}-campaign`, {
        action: "update",
        record: campaign
      });
      logger.info(
        `Campanha (oficial) enviada para: Campanha=${campaignId};Contato=${campaignShipping.contact.name}`
      );
      return;
    }

    // ===== Canal Baileys (fluxo original) =====
    const wbot = await GetWhatsappWbot(campaign.whatsapp);

    const shippingNumber = String(campaignShipping.number);
    const chatId = shippingNumber.endsWith("@lid")
      ? shippingNumber
      : getJidOf(shippingNumber.replace(/\D/g, ""));

    if (campaign.confirmation && campaignShipping.confirmation === null) {
      await sendCampaignMessage(campaign.whatsappId, wbot, chatId, {
        text: campaignShipping.confirmationMessage
      });
      await campaignShipping.update({ confirmationRequestedAt: moment() });
    } else {
      await sendCampaignMessage(campaign.whatsappId, wbot, chatId, {
        text: campaignShipping.message
      });
      if (campaign.mediaPath) {
        const filePath = path.resolve("public", campaign.mediaPath);
        const content = await getMessageFileOptions(
          campaign.mediaName,
          filePath
        );
        if (Object.keys(content).length) {
          await sendCampaignMessage(campaign.whatsappId, wbot, chatId, content);
        }
      }
      await campaignShipping.update({ deliveredAt: moment() });
    }

    await verifyAndFinalizeCampaign(campaign);

    const io = getIO();
    io.emit(`company-${campaign.companyId}-campaign`, {
      action: "update",
      record: campaign
    });

    logger.info(
      `Campanha enviada para: Campanha=${campaignId};Contato=${campaignShipping.contact.name}`
    );
  } catch (err: unknown) {
    logger.error((err as Error).message);
  }
}

export async function startCampaignQueues() {
  await clearRepeatableJobsFromQueues([
    { name: "CampaignQueue", queue: campaignQueue }
  ]);

  campaignQueue.process("VerifyCampaignsDatabase", handleVerifyCampaigns);
  campaignQueue.process("ProcessCampaign", handleProcessCampaign);
  campaignQueue.process("DispatchCampaign", handleDispatchCampaign);
  campaignQueue.process("DispatchConfirmedCampaign", handleDispatchCampaign);

  // Marcador de versão para confirmar que o build novo está rodando.
  logger.info(
    "[Campanha] build EvoHub v3 ativo (template + header de imagem + disparo agora)"
  );

  campaignQueue.add(
    "VerifyCampaignsDatabase",
    {},
    {
      repeat: { cron: "*/20 * * * * *" },
      removeOnComplete: true,
      removeOnFail: 100
    }
  );
}
