import Campaign from "../../models/Campaign";
import CampaignShipping from "../../models/CampaignShipping";
import ContactListItem from "../../models/ContactListItem";
import Whatsapp from "../../models/Whatsapp";
import AppError from "../../errors/AppError";
import {
  getCampaignMessagePreview,
  getCampaignTemplateDef,
  getCampaignTemplateStructured,
  renderForRecipient,
  TemplateStructured
} from "./renderTemplate";

export interface ShippingRow {
  id: number;
  name: string;
  number: string;
  deliveredAt: Date | null; // quando enviamos à Meta
  ackStatus: string | null; // sent | delivered | read | failed
  ackDeliveredAt: Date | null; // entregue no aparelho (Meta)
  ackReadAt: Date | null; // lido (Meta)
  ackFailedAt: Date | null;
  failReason: string | null;
  wamid: string | null;
  message: string; // texto exato enviado a este destinatário
  messageExact: boolean; // true = capturado no envio; false = reconstruído
  confirmationRequestedAt: Date | null;
  confirmedAt: Date | null;
}

export interface ShippingsResult {
  campaignId: number;
  campaignName: string;
  channel: string;
  messagePreview: string;
  template: TemplateStructured; // imagem + corpo + rodapé + botões (preview "conversa")
  total: number;
  sent: number;
  delivered: number;
  read: number;
  failed: number;
  rows: ShippingRow[];
}

/**
 * Relatório/auditoria de disparos de uma campanha:
 *  - a mensagem EXATA enviada a cada destinatário (capturada no envio em
 *    sentBody; para campanhas antigas, reconstruída de forma determinística a
 *    partir do template + dados do contato);
 *  - o status real da Meta (enviado/entregue/lido/falhou) com data/hora.
 * Escopo por empresa.
 */
const ShippingsService = async (
  id: string | number,
  companyId: number
): Promise<ShippingsResult> => {
  const campaign = await Campaign.findByPk(id, {
    include: [{ model: Whatsapp, attributes: ["id", "name", "channel"] }]
  });

  if (!campaign || campaign.companyId !== companyId) {
    throw new AppError("ERR_NO_CAMPAIGN_FOUND", 404);
  }

  const messagePreview = await getCampaignMessagePreview(campaign);
  // Estrutura para o preview "conversa" (imagem + corpo + rodapé + botões).
  const backendUrl = process.env.BACKEND_URL || "";
  const template = await getCampaignTemplateStructured(campaign, backendUrl);
  // Definição do template (uma vez) para reconstruir disparos antigos.
  const tplDef = await getCampaignTemplateDef(campaign);

  const shippings = await CampaignShipping.findAll({
    where: { campaignId: campaign.id },
    include: [{ model: ContactListItem, as: "contact" }],
    order: [
      ["deliveredAt", "ASC"],
      ["id", "ASC"]
    ]
  });

  let sent = 0;
  let delivered = 0;
  let read = 0;
  let failed = 0;

  const rows: ShippingRow[] = shippings.map((s: any) => {
    const contact = s.contact;

    // Mensagem exata: 1) capturada no envio (sentBody); 2) reconstruída.
    let message = String(s.sentBody || "").trim();
    const messageExact = !!message;
    if (!message) {
      message =
        renderForRecipient(tplDef, campaign, contact) ||
        String(s.message || campaign.message1 || "").trim();
    }

    const ackStatus = s.ackStatus || (s.deliveredAt ? "sent" : null);
    // Contagem CUMULATIVA (funil): enviados ≥ entregues ≥ lidos.
    if (s.deliveredAt || ackStatus) sent += 1;
    if (
      s.ackDeliveredAt ||
      s.ackReadAt ||
      ackStatus === "delivered" ||
      ackStatus === "read"
    )
      delivered += 1;
    if (s.ackReadAt || ackStatus === "read") read += 1;
    if (s.ackFailedAt || ackStatus === "failed") failed += 1;

    return {
      id: s.id,
      name: contact?.name || s.number || "",
      number: s.number || contact?.number || "",
      deliveredAt: s.deliveredAt || null,
      ackStatus,
      ackDeliveredAt: s.ackDeliveredAt || null,
      ackReadAt: s.ackReadAt || null,
      ackFailedAt: s.ackFailedAt || null,
      failReason: s.failReason || null,
      wamid: s.wamid || null,
      message,
      messageExact,
      confirmationRequestedAt: s.confirmationRequestedAt || null,
      confirmedAt: s.confirmedAt || null
    };
  });

  return {
    campaignId: campaign.id,
    campaignName: campaign.name,
    channel: campaign.whatsapp?.channel || "whatsapp",
    messagePreview,
    template,
    total: rows.length,
    sent,
    delivered,
    read,
    failed,
    rows
  };
};

export default ShippingsService;
