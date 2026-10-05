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
  AllowNull,
  HasMany,
  Unique,
  BelongsToMany,
  ForeignKey,
  BelongsTo,
  HasOne
} from "sequelize-typescript";
import Queue from "./Queue";
import Ticket from "./Ticket";
import WhatsappQueue from "./WhatsappQueue";
import Company from "./Company";
import Wavoip from "./Wavoip";

@Table
class Whatsapp extends Model<Whatsapp> {
  @PrimaryKey
  @AutoIncrement
  @Column
  id: number;

  @AllowNull
  @Unique
  @Column(DataType.TEXT)
  name: string;

  @Column(DataType.TEXT)
  session: string;

  @Column(DataType.TEXT)
  qrcode: string;

  @Column
  status: string;

  @Column
  battery: string;

  @Column
  plugged: boolean;

  @Column
  retries: number;

  @Default("")
  @Column(DataType.TEXT)
  greetingMessage: string;

  @Default("")
  @Column(DataType.TEXT)
  farewellMessage: string;

  @Default("")
  @Column(DataType.TEXT)
  complationMessage: string;

  @Default("")
  @Column(DataType.TEXT)
  outOfHoursMessage: string;

  @Default("")
  @Column(DataType.TEXT)
  ratingMessage: string;

  @Default("")
  @Column(DataType.TEXT)
  transferMessage: string;

  @Column({ defaultValue: "stable" })
  provider: string;

  @Default(false)
  @AllowNull
  @Column
  isDefault: boolean;

  @Column
  language: string;

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;

  @HasMany(() => Ticket)
  tickets: Ticket[];

  @BelongsToMany(() => Queue, () => WhatsappQueue)
  queues: Array<Queue & { WhatsappQueue: WhatsappQueue }>;

  @HasMany(() => WhatsappQueue)
  whatsappQueues: WhatsappQueue[];

  @ForeignKey(() => Company)
  @Column
  companyId: number;

  @BelongsTo(() => Company)
  company: Company;

  @Column
  token: string;

  @Column(DataType.TEXT)
  facebookUserId: string;

  @Column(DataType.TEXT)
  facebookUserToken: string;

  @Column(DataType.TEXT)
  facebookPageUserId: string;

  @Column(DataType.TEXT)
  tokenMeta: string;

  @HasOne(() => Wavoip)
  wavoip: Wavoip;

  @Column(DataType.TEXT)
  channel: string;

  // ===== EvoHub (canal WhatsApp oficial) =====
  // Preenchidos quando channel === "whatsapp_oficial".
  // O token é segredo — nunca logar.
  @Column(DataType.TEXT)
  evohubBaseUrl: string;

  @Column(DataType.TEXT)
  evohubToken: string;

  @Column(DataType.TEXT)
  evohubPhoneNumberId: string;

  @Column(DataType.TEXT)
  evohubWabaId: string;

  // ===== Controle de custo/uso do canal oficial =====
  // Limite mensal de mensagens de SERVIÇO (atendimento). null = sem limite.
  @Column
  serviceMonthlyLimit: number;

  // Franquia grátis mensal de mensagens de serviço (Meta: 1.000/mês por número).
  @Default(1000)
  @Column
  serviceFreeTier: number;

  // Preços por categoria (R$ por mensagem), para estimar custo.
  @Default(0)
  @Column(DataType.DECIMAL(10, 4))
  priceService: number;

  @Default(0)
  @Column(DataType.DECIMAL(10, 4))
  priceMarketing: number;

  @Default(0)
  @Column(DataType.DECIMAL(10, 4))
  priceUtility: number;

  @Default(0)
  @Column(DataType.DECIMAL(10, 4))
  priceAuthentication: number;

  // Bloqueio manual do envio (ligado/desligado pelo admin).
  @Default(false)
  @Column
  usageManualBlock: boolean;

  // Período (YYYY-MM) em que o admin liberou o envio mesmo acima do limite.
  @Column(DataType.STRING)
  usageOverridePeriod: string;
}

export default Whatsapp;