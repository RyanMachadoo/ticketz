import {
  Table,
  Column,
  CreatedAt,
  UpdatedAt,
  Model,
  PrimaryKey,
  AutoIncrement,
  Default,
  ForeignKey,
  BelongsTo,
  DataType
} from "sequelize-typescript";
import Whatsapp from "./Whatsapp";
import Company from "./Company";

/**
 * Contador de uso do canal oficial (EvoHub / Cloud API), por número, mês e
 * categoria. Uma linha por (whatsappId, period, category), com o total de
 * mensagens enviadas naquele mês. Usado para contabilizar mensagens e custo.
 */
@Table({ tableName: "MessageUsages" })
class MessageUsage extends Model<MessageUsage> {
  @PrimaryKey
  @AutoIncrement
  @Column
  id: number;

  @ForeignKey(() => Whatsapp)
  @Column
  whatsappId: number;

  @BelongsTo(() => Whatsapp)
  whatsapp: Whatsapp;

  @ForeignKey(() => Company)
  @Column
  companyId: number;

  @BelongsTo(() => Company)
  company: Company;

  // "YYYY-MM"
  @Column(DataType.STRING)
  period: string;

  // "service" | "marketing" | "utility" | "authentication"
  @Default("service")
  @Column(DataType.STRING)
  category: string;

  @Default(0)
  @Column
  count: number;

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;
}

export default MessageUsage;
