import {
  Table,
  Column,
  CreatedAt,
  UpdatedAt,
  Model,
  PrimaryKey,
  AutoIncrement,
  ForeignKey,
  BelongsTo,
  DataType
} from "sequelize-typescript";
import Company from "./Company";
import Contact from "./Contact";
import Ticket from "./Ticket";

/**
 * Atribuição de lead Click-to-WhatsApp: de qual anúncio veio a conversa.
 * 1 registro por ticket (o anúncio que originou o atendimento).
 */
@Table({ tableName: "CtwaReferrals" })
class CtwaReferral extends Model<CtwaReferral> {
  @PrimaryKey
  @AutoIncrement
  @Column
  id: number;

  @ForeignKey(() => Company)
  @Column
  companyId: number;

  @BelongsTo(() => Company)
  company: Company;

  @ForeignKey(() => Ticket)
  @Column
  ticketId: number;

  @BelongsTo(() => Ticket)
  ticket: Ticket;

  @ForeignKey(() => Contact)
  @Column
  contactId: number;

  @BelongsTo(() => Contact)
  contact: Contact;

  @Column
  whatsappId: number;

  @Column(DataType.STRING)
  sourceId: string;

  @Column(DataType.STRING)
  sourceType: string;

  @Column(DataType.TEXT)
  sourceUrl: string;

  @Column(DataType.TEXT)
  headline: string;

  @Column(DataType.TEXT)
  body: string;

  @Column(DataType.STRING)
  mediaType: string;

  @Column(DataType.TEXT)
  ctwaClid: string;

  @Column(DataType.TEXT)
  ref: string;

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;
}

export default CtwaReferral;
