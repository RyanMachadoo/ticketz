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
 * Passo de uma jornada. Um passo "event" é agendado por offsetMinutes a partir
 * do evento; um passo "on_survey" é disparado pela resposta de uma pesquisa
 * (ramificação — tratado na Fase 2).
 */
@Table({ tableName: "AutomationSteps" })
class AutomationStep extends Model<AutomationStep> {
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

  // Chave estável do passo dentro da jornada (ex.: "psi", "smd", "cem").
  @Column
  key: string;

  @Default(0)
  @Column
  order: number;

  @Column
  name: string;

  // "event" (agendado por offset) | "on_survey" (disparado por resposta).
  @Default("event")
  @Column
  triggerType: string;

  // Minutos após o evento (para triggerType = "event").
  @Default(0)
  @Column
  offsetMinutes: number;

  // "message" | "survey".
  @Default("message")
  @Column
  kind: string;

  // Template da Meta vinculado a este passo (Ryan aprova e vincula).
  @Column
  templateName: string;

  @Default("pt_BR")
  @Column
  templateLanguage: string;

  // Parâmetros posicionais do corpo do template, com tokens ({nome}, {modelo}...).
  @Default([])
  @Column(DataType.JSONB)
  templateParams: string[];

  // Config da pesquisa (botões -> banda -> ação). Usado na Fase 2.
  @Column(DataType.JSONB)
  surveyConfig: any;

  @Default(true)
  @Column
  isActive: boolean;

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;

  @BelongsTo(() => AutomationJourney)
  journey: AutomationJourney;
}

export default AutomationStep;
