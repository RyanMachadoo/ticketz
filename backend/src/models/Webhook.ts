import {
  Table,
  Column,
  CreatedAt,
  UpdatedAt,
  Model,
  DataType,
  PrimaryKey,
  AutoIncrement,
  Default,
  ForeignKey,
  BelongsTo
} from "sequelize-typescript";
import Company from "./Company";

/**
 * Webhook de saída (ticketz -> sistema externo, ex.: n8n).
 * Quando um evento assinado acontece, o ticketz faz um POST para `url`.
 * `events` guarda a lista de eventos assinados (ex.: ["message.received"]).
 * `secret` (opcional) assina o corpo em HMAC-SHA256 no header X-Ticketz-Signature.
 */
@Table({ tableName: "Webhooks" })
class Webhook extends Model<Webhook> {
  @PrimaryKey
  @AutoIncrement
  @Column
  id: number;

  @Column(DataType.TEXT)
  name: string;

  @Column(DataType.TEXT)
  url: string;

  @Column(DataType.JSON)
  events: string[];

  @Column(DataType.TEXT)
  secret: string;

  @Default(true)
  @Column
  active: boolean;

  @ForeignKey(() => Company)
  @Column
  companyId: number;

  @BelongsTo(() => Company)
  company: Company;

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;
}

export default Webhook;
