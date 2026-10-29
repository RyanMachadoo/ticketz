import {
  Table,
  Column,
  Model,
  PrimaryKey,
  AutoIncrement,
  CreatedAt,
  UpdatedAt,
  Default,
  DataType,
  ForeignKey,
  BelongsTo
} from "sequelize-typescript";
import Company from "./Company";
import AutomationJourney from "./AutomationJourney";

/**
 * Inscrição de um cliente numa jornada (uma por evento). O dedupeKey garante
 * idempotência: o mesmo evento (tipo + externalRef) nunca cria duas jornadas.
 */
@Table({ tableName: "AutomationEnrollments" })
class AutomationEnrollment extends Model<AutomationEnrollment> {
  @PrimaryKey
  @AutoIncrement
  @Column
  id: number;

  @ForeignKey(() => Company)
  @Column
  companyId: number;

  @ForeignKey(() => AutomationJourney)
  @Column
  journeyId: number;

  @Column
  contactNumber: string;

  @Column
  contactName: string;

  // Momento do evento (base para os prazos de cada passo).
  @Column
  eventAt: Date;

  // Referência externa (ID da O.S. ou da venda no sistema do Ryan).
  @Column
  externalRef: string;

  // Chave única de deduplicação: `${tipo}:${externalRef}`.
  @Column
  dedupeKey: string;

  // "active" | "done" | "canceled".
  @Default("active")
  @Column
  status: string;

  // Dados extras do evento (loja, modelo, placa, etc.) para as variáveis.
  @Default({})
  @Column(DataType.JSONB)
  data: any;

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;

  @BelongsTo(() => AutomationJourney)
  journey: AutomationJourney;
}

export default AutomationEnrollment;
