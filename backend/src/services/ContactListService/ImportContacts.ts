import { head } from "lodash";
import XLSX from "xlsx";
import { has } from "lodash";
import ContactListItem from "../../models/ContactListItem";
import CheckContactNumber from "../WbotServices/CheckNumber";
import GetValidationWhatsapp from "../../helpers/GetValidationWhatsapp";
import { logger } from "../../utils/logger";
// import CheckContactNumber from "../WbotServices/CheckNumber";

export async function ImportContacts(
  contactListId: number,
  companyId: number,
  file: Express.Multer.File | undefined
) {
  const workbook = XLSX.readFile(file?.path as string);
  const worksheet = head(Object.values(workbook.Sheets)) as any;
  const rows: any[] = XLSX.utils.sheet_to_json(worksheet, { header: 0 });
  const contacts = rows.map(row => {
    let name = "";
    let number = "";
    let email = "";

    if (has(row, "nome") || has(row, "Nome")) {
      name = row["nome"] || row["Nome"];
    }

    if (
      has(row, "numero") ||
      has(row, "número") ||
      has(row, "Numero") ||
      has(row, "Número")
    ) {
      number = row["numero"] || row["número"] || row["Numero"] || row["Número"];
      number = `${number}`.replace(/\D/g, "");
    }

    if (
      has(row, "email") ||
      has(row, "e-mail") ||
      has(row, "Email") ||
      has(row, "E-mail")
    ) {
      email = row["email"] || row["e-mail"] || row["Email"] || row["E-mail"];
    }

    return { name, number, email, contactListId, companyId };
  });

  const contactList: ContactListItem[] = [];

  for (const contact of contacts) {
    const [newContact, created] = await ContactListItem.findOrCreate({
      where: {
        number: `${contact.number}`,
        contactListId: contact.contactListId,
        companyId: contact.companyId
      },
      defaults: contact
    });
    if (created) {
      contactList.push(newContact);
    }
  }

  if (contactList) {
    // Busca o validador Baileys uma única vez para toda a importação.
    const validator = await GetValidationWhatsapp(companyId);

    for (let newContact of contactList) {
      const digits = `${newContact.number}`.replace(/\D/g, "");

      if (!validator) {
        // Sem sessão Baileys conectada (ex.: só canal oficial/EvoHub): assume
        // válido para não travar a campanha.
        newContact.isWhatsappValid = true;
        newContact.number = digits;
        await newContact.save();
        // eslint-disable-next-line no-continue
        continue;
      }

      try {
        const response = await CheckContactNumber(
          newContact.number,
          companyId,
          validator
        );
        newContact.isWhatsappValid = response.exists;
        newContact.number = response.jid.replace(/\D/g, "");
        await newContact.save();
      } catch (e) {
        newContact.isWhatsappValid = false;
        newContact.number = digits;
        await newContact.save();
        logger.error(`Número de contato inválido: ${digits}`);
      }
    }
  }

  return contactList;
}
