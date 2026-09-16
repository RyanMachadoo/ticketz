import moment from "moment";
import AppError from "../../errors/AppError";
import Campaign from "../../models/Campaign";
import ContactList from "../../models/ContactList";
import Whatsapp from "../../models/Whatsapp";
import { campaignQueue } from "../../queues/campaign";
import { logger } from "../../utils/logger";

/**
 * Dispara a campanha IMEDIATAMENTE (sem agendamento). Coloca a campanha em
 * andamento e enfileira o processamento com delay 0, em vez de esperar o cron
 * de campanhas programadas.
 */
export async function StartService(id: number): Promise<Campaign> {
  const campaign = await Campaign.findByPk(id);

  if (!campaign) {
    throw new AppError("ERR_NO_CAMPAIGN_FOUND", 404);
  }

  if (!campaign.contactListId) {
    throw new AppError("ERR_CAMPAIGN_NO_CONTACT_LIST", 400);
  }

  if (["EM_ANDAMENTO", "FINALIZADA"].includes(campaign.status)) {
    throw new AppError("ERR_CAMPAIGN_ALREADY_RUNNING", 400);
  }

  await campaign.update({
    status: "EM_ANDAMENTO",
    scheduledAt: moment().toDate()
  });

  logger.info(
    `[Campanha] Disparar agora: id=${campaign.id} whatsappId=${campaign.whatsappId} contactListId=${campaign.contactListId} -> enfileirando ProcessCampaign`
  );

  await campaignQueue.add(
    "ProcessCampaign",
    {
      id: campaign.id,
      delay: 0
    },
    {
      removeOnComplete: true,
      removeOnFail: 100
    }
  );

  await campaign.reload({
    include: [
      { model: ContactList },
      { model: Whatsapp, attributes: ["id", "name"] }
    ]
  });

  return campaign;
}

export default StartService;
