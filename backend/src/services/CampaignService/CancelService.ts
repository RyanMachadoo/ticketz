import { Op } from "sequelize";
import Campaign from "../../models/Campaign";
import CampaignShipping from "../../models/CampaignShipping";
import { campaignQueue } from "../../queues/campaign";

export async function CancelService(id: number) {
  const campaign = await Campaign.findByPk(id);
  await campaign.update({ status: "CANCELADA" });

  const recordsToCancel = await CampaignShipping.findAll({
    where: {
      campaignId: campaign.id,
      jobId: { [Op.not]: null },
      deliveredAt: null
    }
  });

  const promises = [];

  // eslint-disable-next-line no-restricted-syntax
  for (const record of recordsToCancel) {
    // eslint-disable-next-line no-await-in-loop
    const job = await campaignQueue.getJob(+record.jobId);
    // job pode ser null quando já foi processado/removido do Redis (ou o Redis
    // foi reiniciado). Sem esta checagem, job.remove() lança
    // "Cannot read properties of null (reading 'remove')" e o pausar quebra.
    if (job) {
      promises.push(
        job.remove().catch(() => {
          /* job já saindo da fila; ignora */
        })
      );
    }
  }

  await Promise.all(promises);
}
