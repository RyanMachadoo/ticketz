import { fn, col, Op } from "sequelize";
import CtwaReferral from "../../models/CtwaReferral";
import Contact from "../../models/Contact";
import { logger } from "../../utils/logger";

/**
 * Atribuição de leads Click-to-WhatsApp (CTWA).
 * Salva de qual anúncio veio cada conversa e gera relatório por anúncio.
 */

export interface MetaReferral {
  source_url?: string;
  source_id?: string;
  source_type?: string;
  headline?: string;
  body?: string;
  media_type?: string;
  ctwa_clid?: string;
  ref?: string;
}

export interface SaveReferralCtx {
  companyId: number;
  ticketId: number;
  contactId?: number;
  whatsappId?: number;
}

/**
 * Salva o referral do anúncio para um ticket (1 por ticket — o que originou).
 * Devolve { record, created } ou null quando não há referral.
 */
export async function saveReferral(
  referral: MetaReferral | undefined | null,
  ctx: SaveReferralCtx
): Promise<{ record: CtwaReferral; created: boolean } | null> {
  if (!referral || (!referral.source_id && !referral.ctwa_clid)) {
    return null;
  }
  try {
    const [record, created] = await CtwaReferral.findOrCreate({
      where: { ticketId: ctx.ticketId },
      defaults: {
        companyId: ctx.companyId,
        ticketId: ctx.ticketId,
        contactId: ctx.contactId || null,
        whatsappId: ctx.whatsappId || null,
        sourceId: referral.source_id || null,
        sourceType: referral.source_type || null,
        sourceUrl: referral.source_url || null,
        headline: referral.headline || null,
        body: referral.body || null,
        mediaType: referral.media_type || null,
        ctwaClid: referral.ctwa_clid || null,
        ref: referral.ref || null
      } as any
    });
    return { record, created };
  } catch (err: any) {
    logger.error(
      `[CTWA] falha ao salvar referral do ticket ${ctx.ticketId}: ${err?.message}`
    );
    return null;
  }
}

/** Referral de um ticket (para dar contexto ao agente de IA, por exemplo). */
export async function getReferralForTicket(
  ticketId: number
): Promise<CtwaReferral | null> {
  return CtwaReferral.findOne({ where: { ticketId } });
}

const buildDateWhere = (start?: string, end?: string): any => {
  const where: any = {};
  if (start || end) {
    where.createdAt = {};
    if (start) where.createdAt[Op.gte] = new Date(`${start}T00:00:00`);
    if (end) where.createdAt[Op.lte] = new Date(`${end}T23:59:59`);
  }
  return where;
};

/**
 * Relatório: leads agrupados por anúncio (sourceId), com contagem total e de
 * contatos distintos, no período informado.
 */
export async function getReport(
  companyId: number,
  start?: string,
  end?: string
): Promise<any[]> {
  const rows = await CtwaReferral.findAll({
    where: { companyId, ...buildDateWhere(start, end) },
    attributes: [
      "sourceId",
      "sourceType",
      [fn("MAX", col("headline")), "headline"],
      [fn("MAX", col("sourceUrl")), "sourceUrl"],
      [fn("COUNT", col("id")), "leads"],
      [fn("COUNT", fn("DISTINCT", col("contactId"))), "contacts"],
      [fn("MAX", col("CtwaReferral.createdAt")), "lastAt"]
    ],
    group: ["sourceId", "sourceType"],
    order: [[fn("COUNT", col("id")), "DESC"]],
    raw: true
  });
  return rows;
}

/** Lista detalhada de leads (com contato), para a aba de detalhes. */
export async function listLeads(
  companyId: number,
  start?: string,
  end?: string,
  sourceId?: string
): Promise<CtwaReferral[]> {
  const where: any = { companyId, ...buildDateWhere(start, end) };
  if (sourceId) where.sourceId = sourceId;
  return CtwaReferral.findAll({
    where,
    include: [
      { model: Contact, as: "contact", attributes: ["id", "name", "number"] }
    ],
    order: [["createdAt", "DESC"]],
    limit: 500
  });
}
