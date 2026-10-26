import { isArray } from "lodash";
import Campaign from "../../models/Campaign";
import * as EvoHubProvider from "../EvoHubServices/EvoHubProvider";
import { logger } from "../../utils/logger";

/**
 * Renderização do TEXTO de um template da Meta (cabeçalho, corpo, rodapé e
 * botões) com as variáveis preenchidas — usado para mostrar, no relatório de
 * disparos, a mensagem que foi enviada aos clientes. Funções puras + uma busca
 * (cacheada) do template na Meta via EvoHub.
 */

/** Substitui {{1}}, {{2}}... pelos parâmetros (posicional). */
export function fillPlaceholders(text: string, params: string[]): string {
  return String(text || "").replace(/\{\{\s*(\d+)\s*\}\}/g, (_m, n) => {
    const i = Number(n) - 1;
    return params[i] !== undefined ? params[i] : `{{${n}}}`;
  });
}

/** Reconstrói o texto visível do template a partir dos componentes. */
export function renderTemplateText(tpl: any, params: string[]): string {
  if (!tpl || !isArray(tpl.components)) return "";
  const parts: string[] = [];
  for (const c of tpl.components) {
    const type = String(c?.type || "").toUpperCase();
    if (type === "HEADER") {
      const fmt = String(c?.format || "TEXT").toUpperCase();
      if (fmt === "TEXT" && c.text) parts.push(fillPlaceholders(c.text, params));
      else if (fmt === "IMAGE") parts.push("🖼️ [imagem]");
      else if (fmt === "VIDEO") parts.push("🎞️ [vídeo]");
      else if (fmt === "DOCUMENT") parts.push("📎 [documento]");
    } else if (type === "BODY") {
      parts.push(fillPlaceholders(c.text, params));
    } else if (type === "FOOTER") {
      if (c.text) parts.push(String(c.text));
    } else if (type === "BUTTONS") {
      const btns = (c.buttons || [])
        .map((b: any) => `[ ${b?.text || ""} ]`)
        .filter((s: string) => s !== "[  ]")
        .join("   ");
      if (btns) parts.push(btns);
    }
  }
  return parts.filter(Boolean).join("\n\n").trim();
}

// Cache simples da definição do template por campanha (TTL do processo).
const templateCache = new Map<string, any>();

/** Busca (cacheada) a definição do template da campanha na Meta. */
export async function getCampaignTemplateDef(
  campaign: Campaign
): Promise<any | null> {
  if (
    campaign.whatsapp?.channel !== "whatsapp_oficial" ||
    !campaign.templateName
  ) {
    return null;
  }
  const key = String(campaign.id);
  if (templateCache.has(key)) return templateCache.get(key);
  try {
    const all = await EvoHubProvider.getTemplates(campaign.whatsapp);
    const lang = campaign.templateLanguage || "pt_BR";
    const tpl =
      all.find(
        (t: any) => t.name === campaign.templateName && t.language === lang
      ) ||
      all.find((t: any) => t.name === campaign.templateName) ||
      null;
    templateCache.set(key, tpl);
    return tpl;
  } catch (err: any) {
    logger.warn(
      `[Campanha][relatório] não consegui buscar o template '${campaign.templateName}': ${err?.message}`
    );
    templateCache.set(key, null);
    return null;
  }
}

export interface TemplateStructured {
  headerImageUrl: string | null;
  headerText: string | null;
  body: string;
  footer: string | null;
  buttons: string[];
}

/**
 * Estrutura do template para exibir como "bolha de conversa" (imagem, corpo,
 * rodapé e botões). A imagem é a que FOI enviada na campanha (mediaPath); se
 * não houver, usa a imagem de exemplo do template. `backendUrl` monta a URL
 * pública da mídia.
 */
export async function getCampaignTemplateStructured(
  campaign: Campaign,
  backendUrl: string
): Promise<TemplateStructured> {
  const out: TemplateStructured = {
    headerImageUrl: null,
    headerText: null,
    body: "",
    footer: null,
    buttons: []
  };

  // Imagem efetivamente enviada (anexada à campanha).
  if (campaign.mediaPath) {
    out.headerImageUrl = String(campaign.mediaPath).startsWith("http")
      ? campaign.mediaPath
      : `${backendUrl || ""}/public/${campaign.mediaPath}`;
  }

  const isOfficial = campaign.whatsapp?.channel === "whatsapp_oficial";
  if (isOfficial && campaign.templateName) {
    const tpl = await getCampaignTemplateDef(campaign);
    const params = (isArray(campaign.templateParams)
      ? campaign.templateParams
      : []
    ).map(p => String(p ?? ""));
    if (tpl && isArray(tpl.components)) {
      for (const c of tpl.components) {
        const type = String(c?.type || "").toUpperCase();
        if (type === "HEADER") {
          const fmt = String(c?.format || "TEXT").toUpperCase();
          if (fmt === "TEXT" && c.text) {
            out.headerText = fillPlaceholders(c.text, params);
          } else if (fmt === "IMAGE" && !out.headerImageUrl) {
            // Imagem de exemplo do template (quando a campanha não anexou uma).
            const ex =
              c?.example?.header_handle?.[0] ||
              c?.example?.header_url?.[0] ||
              null;
            if (ex) out.headerImageUrl = ex;
          }
        } else if (type === "BODY") {
          out.body = fillPlaceholders(c.text, params);
        } else if (type === "FOOTER") {
          out.footer = c.text ? String(c.text) : null;
        } else if (type === "BUTTONS") {
          out.buttons = (c.buttons || [])
            .map((b: any) => String(b?.text || "").trim())
            .filter(Boolean);
        }
      }
    }
    if (!out.body) out.body = `[Template: ${campaign.templateName}]`;
    return out;
  }

  // Canal Baileys: corpo = 1ª mensagem configurada.
  out.body = String(campaign.message1 || "").trim();
  return out;
}

/** Substitui {nome}, {numero}, {email} pelos dados do contato (reconstrução). */
export function processTokens(text: string, contact: any): string {
  let out = String(text || "");
  if (contact?.name) out = out.replace(/\{nome\}/g, contact.name);
  if (contact?.email) out = out.replace(/\{email\}/g, contact.email);
  if (contact?.number) out = out.replace(/\{numero\}/g, contact.number);
  return out;
}

/**
 * Reconstrói o texto EXATO enviado a UM destinatário (para campanhas antigas,
 * onde não guardamos sentBody). Determinístico: template + dados do contato.
 */
export function renderForRecipient(
  tpl: any,
  campaign: Campaign,
  contact: any
): string {
  if (
    campaign.whatsapp?.channel === "whatsapp_oficial" &&
    campaign.templateName &&
    tpl
  ) {
    const params = (isArray(campaign.templateParams)
      ? campaign.templateParams
      : []
    ).map(p => processTokens(String(p ?? ""), contact));
    return renderTemplateText(tpl, params);
  }
  // Baileys: a 1ª mensagem configurada, com tokens do contato.
  return processTokens(String(campaign.message1 || ""), contact);
}

/**
 * Preview da mensagem enviada por uma campanha:
 *  - canal oficial: busca o template na Meta e renderiza com os params da
 *    campanha (tokens como {nome} aparecem literais no preview);
 *  - canal Baileys: usa message1 (primeira mensagem configurada).
 * Fallbacks garantem que sempre devolve ALGO legível.
 */
export async function getCampaignMessagePreview(
  campaign: Campaign
): Promise<string> {
  const isOfficial = campaign.whatsapp?.channel === "whatsapp_oficial";

  if (isOfficial && campaign.templateName) {
    try {
      const tpl = await getCampaignTemplateDef(campaign);
      const params = isArray(campaign.templateParams)
        ? campaign.templateParams.map(p => String(p ?? ""))
        : [];
      const rendered = renderTemplateText(tpl, params);
      if (rendered) return rendered;
    } catch (err: any) {
      logger.warn(
        `[Campanha][relatório] não consegui renderizar o template '${campaign.templateName}': ${err?.message}`
      );
    }
    // Fallback: nome do template + params.
    const params = isArray(campaign.templateParams)
      ? campaign.templateParams
      : [];
    return `[Template: ${campaign.templateName}]${
      params.length ? `\nParâmetros: ${params.join(" | ")}` : ""
    }`;
  }

  // Canal Baileys: a 1ª mensagem configurada.
  return String(campaign.message1 || "").trim();
}

export default getCampaignMessagePreview;
