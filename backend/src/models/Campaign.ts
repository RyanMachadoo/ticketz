import {
  Table,
  Column,
  CreatedAt,
  UpdatedAt,
  Model,
  DataType,
  PrimaryKey,
  AutoIncrement,
  ForeignKey,
  BelongsTo,
  HasMany
} from "sequelize-typescript";
import CampaignShipping from "./CampaignShipping";
import Company from "./Company";
import ContactList from "./ContactList";
import Whatsapp from "./Whatsapp";

@Table({ tableName: "Campaigns" })
class Campaign extends Model<Campaign> {
  @PrimaryKey
  @AutoIncrement
  @Column
  id: number;

  @Column
  name: string;

  @Column({ defaultValue: "" })
  message1: string;

  @Column({ defaultValue: "" })
  message2: string;

  @Column({ defaultValue: "" })
  message3: string;

  @Column({ defaultValue: "" })
  message4: string;

  @Column({ defaultValue: "" })
  message5: string;

  @Column({ defaultValue: "" })
  confirmationMessage1: string;

  @Column({ defaultValue: "" })
  confirmationMessage2: string;

  @Column({ defaultValue: "" })
  confirmationMessage3: string;

  @Column({ defaultValue: "" })
  confirmationMessage4: string;

  @Column({ defaultValue: "" })
  confirmationMessage5: string;

  @Column({ defaultValue: "INATIVA" })
  status: string; // INATIVA, PROGRAMADA, EM_ANDAMENTO, CANCELADA, FINALIZADA

  // ===== Template da Meta (só p/ conexão oficial / EvoHub) =====
  // Quando a conexão da campanha é "whatsapp_oficial", o disparo é feito com um
  // template aprovado em vez das mensagens de texto livre (message1..5).
  @Column(DataType.TEXT)
  templateName: string;

  @Column(DataType.TEXT)
  templateLanguage: string;

  // Valores das variáveis do corpo do template ({{1}}, {{2}}...), na ordem.
  // Cada item pode conter variáveis de campanha ({nome}, {numero}, etc.).
  @Column(DataType.JSON)
  templateParams: string[];

  @Column
  confirmation: boolean;

  @Column
  mediaPath: string;

  @Column
  mediaName: string;

  @Column
  scheduledAt: Date;

  @Column
  completedAt: Date;

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;

  @ForeignKey(() => Company)
  @Column
  companyId: number;

  @BelongsTo(() => Company)
  company: Company;

  @ForeignKey(() => ContactList)
  @Column
  contactListId: number;

  @BelongsTo(() => ContactList)
  contactList: ContactList;

  @ForeignKey(() => Whatsapp)
  @Column
  whatsappId: number;

  @BelongsTo(() => Whatsapp)
  whatsapp: Whatsapp;

  @HasMany(() => CampaignShipping)
  shipping: CampaignShipping[];
}

export default Campaign;
