import { Op } from "sequelize";
import Campaign from "../../models/Campaign";
import AppError from "../../errors/AppError";
import CampaignShipping from "../../models/CampaignShipping";
import ContactList from "../../models/ContactList";
import ContactListItem from "../../models/ContactListItem";
import Whatsapp from "../../models/Whatsapp";

const ShowService = async (
  id: string | number
): Promise<{
  campaign: Campaign;
  valids: number;
  delivered: number;
  confirmationRequested: number;
  confirmed: number;
}> => {
  const campaign = await Campaign.findByPk(id, {
    include: [
      { model: ContactList },
      { model: Whatsapp, attributes: ["id", "name", "channel"] }
    ]
  });

  if (!campaign) {
    throw new AppError("ERR_NO_TICKETNOTE_FOUND", 404);
  }

  // No canal oficial (EvoHub) não há pré-validação de número, então todos os
  // contatos da lista contam como "válidos" no relatório e na finalização.
  const isOfficial = campaign.whatsapp?.channel === "whatsapp_oficial";
  const valids = await ContactListItem.count({
    where: {
      contactListId: campaign.contactListId,
      ...(isOfficial ? {} : { isWhatsappValid: true })
    }
  });

  const delivered = await CampaignShipping.count({
    where: {
      campaignId: campaign.id,
      deliveredAt: {
        [Op.ne]: null
      }
    }
  });

  const confirmationRequested = await CampaignShipping.count({
    where: {
      campaignId: campaign.id,
      confirmationRequestedAt: {
        [Op.ne]: null
      }
    }
  });

  const confirmed = await CampaignShipping.count({
    where: {
      campaignId: campaign.id,
      confirmedAt: {
        [Op.ne]: null
      }
    }
  });

  return { campaign, valids, delivered, confirmationRequested, confirmed };
};

export default ShowService;
