import AppError from "../../errors/AppError";
import Whatsapp from "../../models/Whatsapp";

/**
 * Regra: campanha em conexão OFICIAL (EvoHub / Cloud API) só pode ser criada ou
 * atualizada se tiver um template aprovado da Meta selecionado. Conexões Baileys
 * (channel "whatsapp") não são afetadas.
 */
const validateOfficialTemplate = async (
  whatsappId?: number,
  templateName?: string
): Promise<void> => {
  if (!whatsappId) return;

  const connection = await Whatsapp.findByPk(whatsappId);

  if (connection && connection.channel === "whatsapp_oficial") {
    if (!templateName) {
      throw new AppError("ERR_CAMPAIGN_OFICIAL_REQUIRES_TEMPLATE");
    }
  }
};

export default validateOfficialTemplate;
