import {
  Table,
  Column,
  DataType,
  CreatedAt,
  UpdatedAt,
  Model,
  BeforeCreate,
  BeforeUpdate,
  PrimaryKey,
  AutoIncrement,
  ForeignKey,
  BelongsTo
} from "sequelize-typescript";
import Campaign from "./Campaign";
import ContactListItem from "./ContactListItem";
import normalizePhone from "./NormalizePhone";

@Table({ tableName: "CampaignShipping" })
class CampaignShipping extends Model<CampaignShipping> {
  @PrimaryKey
  @AutoIncrement
  @Column
  id: number;

  @Column
  jobId: string;

  @Column
  number: string;

  @Column
  message: string;

  @Column
  confirmationMessage: string;

  @Column
  confirmation: boolean;

  @ForeignKey(() => ContactListItem)
  @Column
  contactId: number;

  @ForeignKey(() => Campaign)
  @Column
  campaignId: number;

  @Column
  confirmationRequestedAt: Date;

  @Column
  confirmedAt: Date;

  @Column
  deliveredAt: Date;

  // ===== Auditoria do disparo (comprovação) =====
  // Identificador da mensagem na Meta (wamid) — casa com os eventos de status.
  @Column
  wamid: string;

  // Texto EXATO enviado a este destinatário (template já renderizado com as
  // variáveis do contato). É a comprovação de "como a mensagem chegou".
  @Column(DataType.TEXT)
  sentBody: string;

  // Último status da Meta: "sent" | "delivered" | "read" | "failed".
  @Column
  ackStatus: string;

  @Column
  ackDeliveredAt: Date;

  @Column
  ackReadAt: Date;

  @Column
  ackFailedAt: Date;

  // Motivo da falha (mensagem de erro da Meta), quando status = failed.
  @Column(DataType.TEXT)
  failReason: string;

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;

  @BelongsTo(() => ContactListItem)
  contact: ContactListItem;

  @BelongsTo(() => Campaign)
  campaign: Campaign;

  @BeforeUpdate
  @BeforeCreate
  static normalizeNumber(instance: CampaignShipping): void {
    if (!instance.number) {
      return;
    }

    if (instance.number.endsWith("@lid")) {
      return;
    }

    instance.number = normalizePhone(instance.number).phone;
  }
}

export default CampaignShipping;
