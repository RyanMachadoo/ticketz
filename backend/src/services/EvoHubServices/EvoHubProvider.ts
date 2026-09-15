import axios, { AxiosInstance } from "axios";
import FormData from "form-data";
import fs from "fs";
import Whatsapp from "../../models/Whatsapp";

/**
 * Cliente do proxy oficial EvoHub (Meta Cloud API / Graph v23).
 *
 * O EvoHub é um proxy TRANSPARENTE: tudo depois de /meta/ vai direto pra
 * Graph API da Meta. Ou seja, o corpo das requisições é o padrão da Cloud API;
 * só trocamos a base URL e usamos o "token de canal" no lugar do token da Meta.
 *
 * A config (baseUrl, token, phoneNumberId, wabaId) vem da conexão (model Whatsapp),
 * marcada com channel = "whatsapp_oficial". O token é SEGREDO — nunca logar.
 */

const DEFAULT_BASE_URL = "https://api.evohub.ai/meta";

function client(whatsapp: Whatsapp): AxiosInstance {
  const token = whatsapp.evohubToken;
  if (!token) {
    throw new Error(`[EvoHub] token de canal ausente na conexão ${whatsapp.id}`);
  }
  return axios.create({
    baseURL: whatsapp.evohubBaseUrl || DEFAULT_BASE_URL,
    headers: { Authorization: `Bearer ${token}` },
    timeout: 30000
  });
}

export interface EvoHubSendResult {
  wamid: string;
  raw: any;
}

/** Envia mensagem de texto simples (só válido dentro da janela de 24h). */
export async function sendText(
  whatsapp: Whatsapp,
  to: string,
  body: string
): Promise<EvoHubSendResult> {
  const api = client(whatsapp);
  const { data } = await api.post(`/${whatsapp.evohubPhoneNumberId}/messages`, {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body }
  });
  return { wamid: data?.messages?.[0]?.id, raw: data };
}

/**
 * Envia template aprovado (HSM). Necessário pra iniciar conversa ou
 * responder FORA da janela de 24h. Ver getTemplates() pra listar os aprovados.
 */
export async function sendTemplate(
  whatsapp: Whatsapp,
  to: string,
  templateName: string,
  language: string,
  components?: any[]
): Promise<EvoHubSendResult> {
  const api = client(whatsapp);
  const { data } = await api.post(`/${whatsapp.evohubPhoneNumberId}/messages`, {
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: {
      name: templateName,
      language: { code: language },
      ...(components ? { components } : {})
    }
  });
  return { wamid: data?.messages?.[0]?.id, raw: data };
}

/**
 * Upload de mídia (passo 1). A Cloud API exige 2 passos: sobe o arquivo,
 * pega o media_id, depois envia a mensagem referenciando o id (sendMediaById).
 */
export async function uploadMedia(
  whatsapp: Whatsapp,
  filePath: string,
  mimeType: string
): Promise<string> {
  const api = client(whatsapp);
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("type", mimeType);
  form.append("file", fs.createReadStream(filePath), { contentType: mimeType });
  const { data } = await api.post(
    `/${whatsapp.evohubPhoneNumberId}/media`,
    form,
    { headers: form.getHeaders() }
  );
  return data?.id;
}

/** Envia mídia já upada (passo 2), referenciando o media_id. */
export async function sendMediaById(
  whatsapp: Whatsapp,
  to: string,
  mediaId: string,
  kind: "image" | "video" | "audio" | "document",
  caption?: string,
  filename?: string
): Promise<EvoHubSendResult> {
  const api = client(whatsapp);
  const media: any = { id: mediaId };
  if (caption && kind !== "audio") media.caption = caption;
  if (filename && kind === "document") media.filename = filename;
  const { data } = await api.post(`/${whatsapp.evohubPhoneNumberId}/messages`, {
    messaging_product: "whatsapp",
    to,
    type: kind,
    [kind]: media
  });
  return { wamid: data?.messages?.[0]?.id, raw: data };
}

/** Resolve o media_id recebido num link temporário de download (pra baixar mídia recebida). */
export async function getMediaUrl(whatsapp: Whatsapp, mediaId: string): Promise<string> {
  const api = client(whatsapp);
  const { data } = await api.get(`/${mediaId}`);
  return data?.url;
}

/** Lista templates aprovados na WABA. */
export async function getTemplates(whatsapp: Whatsapp): Promise<any[]> {
  const api = client(whatsapp);
  const { data } = await api.get(`/${whatsapp.evohubWabaId}/message_templates`, {
    params: { fields: "name,status,category,language,components", limit: 100 }
  });
  return data?.data || [];
}
