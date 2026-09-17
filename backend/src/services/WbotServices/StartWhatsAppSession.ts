import { initWASocket } from "../../libs/wbot";
import Whatsapp from "../../models/Whatsapp";
import { wbotMessageListener } from "./wbotMessageListener";
import wbotMonitor from "./wbotMonitor";
import { logger } from "../../utils/logger";
import { sendWhatsappUpdate } from "../WhatsappService/SocketSendWhatsappUpdate";

export const StartWhatsAppSession = async (
  whatsapp: Whatsapp,
  companyId: number,
  isRefresh = false
): Promise<void> => {
  // Canal oficial (EvoHub / Cloud API) não tem sessão Baileys para abrir: ele
  // opera por API + webhook. "Reconectar" apenas marca a conexão como CONNECTED
  // (as credenciais já ficam salvas). Sem este guard, o retry tentaria abrir um
  // socket Baileys e deixaria a conexão travada em OPENING ("expirada").
  if (whatsapp.channel === "whatsapp_oficial") {
    await whatsapp.update({ status: "CONNECTED", retries: 0 });
    sendWhatsappUpdate(whatsapp);
    return;
  }

  await whatsapp.update({ status: "OPENING" });

  sendWhatsappUpdate(whatsapp);

  try {
    const wbot = await initWASocket(whatsapp, null, isRefresh);
    wbotMessageListener(wbot, companyId);
    wbotMonitor(wbot, whatsapp, companyId);
  } catch (err) {
    logger.error(err);
  }
};
