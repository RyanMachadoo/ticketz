import * as Yup from "yup";
import AppError from "../../errors/AppError";
import ContactListItem from "../../models/ContactListItem";
import { logger } from "../../utils/logger";
import CheckContactNumber from "../WbotServices/CheckNumber";
import GetValidationWhatsapp from "../../helpers/GetValidationWhatsapp";

interface Data {
  name: string;
  number: string;
  contactListId: number;
  companyId: number;
  email?: string;
}

const CreateService = async (data: Data): Promise<ContactListItem> => {
  const { name } = data;

  const contactListItemSchema = Yup.object().shape({
    name: Yup.string()
      .min(3, "ERR_CONTACTLISTITEM_INVALID_NAME")
      .required("ERR_CONTACTLISTITEM_REQUIRED")
  });

  try {
    await contactListItemSchema.validate({ name });
  } catch (err: any) {
    throw new AppError(err.message);
  }

  const [record] = await ContactListItem.findOrCreate({
    where: {
      number: data.number,
      companyId: data.companyId,
      contactListId: data.contactListId
    },
    defaults: data
  });

  const digits = `${record.number}`.replace(/\D/g, "");
  const validator = await GetValidationWhatsapp(record.companyId);

  if (!validator) {
    // Sem sessão Baileys conectada (ex.: empresa só com canal oficial/EvoHub):
    // não é possível pré-validar o número no WhatsApp. Assume válido para não
    // travar a campanha (o filtro de disparo usa isWhatsappValid: true).
    record.isWhatsappValid = true;
    record.number = digits;
    await record.save();
  } else {
    try {
      const response = await CheckContactNumber(
        record.number,
        record.companyId,
        validator
      );
      record.isWhatsappValid = response.exists;
      record.number = response.jid.replace(/\D/g, "");
      await record.save();
    } catch (e) {
      record.isWhatsappValid = false;
      record.number = digits;
      await record.save();
      logger.error(`Número de contato inválido: ${digits}`);
    }
  }

  return record;
};

export default CreateService;
