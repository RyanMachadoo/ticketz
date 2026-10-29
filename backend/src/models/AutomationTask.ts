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
import AutomationEnrollment from "./AutomationEnrollment";
import AutomationStep from "./AutomationStep";

/**
 * Agendamento de UM passo para UMA inscrição. É a unidade de disparo durável:
 * o worker lê as tarefas vencidas (runAt <= agora, status "pending") e envia.
 * "sending" é uma trava atômica para não enviar duas vezes.
 */
@Table({ tableName: "AutomationTasks" })
class AutomationTask extends Model<AutomationTask> {
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

  @Column
  runAt: Date;

  // "pending" | "sending" | "sent" | "failed" | "skipped" | "canceled".
  @Default("pending")
  @Column
  status: string;

  @Default(0)
  @Column
  attempts: number;

  @Column(DataType.TEXT)
  lastError: string;

  // Identificador da mensagem na Meta (para auditoria/status).
  @Column
  wamid: string;

  @Column
  sentAt: Date;

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;

  @BelongsTo(() => AutomationEnrollment)
  enrollment: AutomationEnrollment;

  @BelongsTo(() => AutomationStep)
  step: AutomationStep;
}

export default AutomationTask;
