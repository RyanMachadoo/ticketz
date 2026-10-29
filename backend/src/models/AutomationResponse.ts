import {
  Table,
  Column,
  Model,
  PrimaryKey,
  AutoIncrement,
  CreatedAt,
  UpdatedAt,
  ForeignKey
} from "sequelize-typescript";
import Company from "./Company";
import AutomationEnrollment from "./AutomationEnrollment";
import AutomationStep from "./AutomationStep";
import AutomationTask from "./AutomationTask";

/**
 * Resposta de uma pesquisa (PSI) de automação: a banda escolhida pelo cliente
 * (ex.: "5" ou "1-4") e o texto do botão. Uma por tarefa (idempotente).
 */
@Table({ tableName: "AutomationResponses" })
class AutomationResponse extends Model<AutomationResponse> {
  @PrimaryKey
  @AutoIncrement
  @Column
  id: number;

  @ForeignKey(() => Company)
  @Column
  companyId: number;

  @ForeignKey(() => AutomationEnrollment)
  @Column
  enrollmentId: number;

  @ForeignKey(() => AutomationStep)
  @Column
  stepId: number;

  @ForeignKey(() => AutomationTask)
  @Column
  taskId: number;

  // Banda da nota: "5" | "1-4" (conforme surveyConfig do passo).
  @Column
  band: string;

  @Column
  buttonText: string;

  @Column
  respondedAt: Date;

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;
}

export default AutomationResponse;
