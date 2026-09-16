import Whatsapp from "../models/Whatsapp";
import { getWbot } from "../libs/wbot";

/**
 * Retorna uma conexão Baileys CONECTADA (com sessão wbot ativa) que pode validar
 * números no WhatsApp via onWhatsApp, ou null quando não houver nenhuma — por
 * exemplo, quando a empresa só tem o canal oficial (EvoHub / Cloud API), que não
 * expõe essa checagem. Nesse caso, quem chama deve assumir o número como válido
 * em vez de travar (ex.: criação de listas de campanha).
 */
const GetValidationWhatsapp = async (
  companyId: number
): Promise<Whatsapp | null> => {
  const whatsapp =
    (await Whatsapp.findOne({
      where: {
        companyId,
        channel: "whatsapp",
        status: "CONNECTED",
        isDefault: true
      }
    })) ||
    (await Whatsapp.findOne({
      where: {
        companyId,
        channel: "whatsapp",
        status: "CONNECTED"
      }
    }));

  if (!whatsapp) return null;

  try {
    const wbot = getWbot(whatsapp.id);
    if (!wbot) return null;
  } catch (err) {
    return null;
  }

  return whatsapp;
};

export default GetValidationWhatsapp;
