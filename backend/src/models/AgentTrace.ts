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
  Default,
  DataType
} from "sequelize-typescript";
import Company from "./Company";
import Ticket from "./Ticket";
import AIAgent from "./AIAgent";

/**
 * Trace (raio-x) de UM turno do agente de IA — estilo observabilidade ADK.
 * Cada resposta do agente gera um registro com: modelo usado, tokens de
 * entrada/saída, custo estimado (US$), latência total, nº de passos, a
 * trajetória de ferramentas (quais chamou, status, tempo) e os eventos de
 * guardrail (o que foi bloqueado/mascarado). Serve para auditar, depurar e
 * controlar custo por atendimento.
 */
@Table({ tableName: "AgentTraces" })
class AgentTrace extends Model<AgentTrace> {
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

  @ForeignKey(() => AIAgent)
  @Column
  agentId: number;

  @BelongsTo(() => AIAgent)
  agent: AIAgent;

  @Column(DataType.STRING)
  model: string;

  @Default(0)
  @Column
  inputTokens: number;

  @Default(0)
  @Column
  outputTokens: number;

  // Custo estimado em US$ do turno (6 casas — valores pequenos por turno).
  @Default(0)
  @Column(DataType.DECIMAL(12, 6))
  costUsd: number;

  @Default(0)
  @Column
  latencyMs: number;

  @Default(0)
  @Column
  steps: number;

  // Trajetória de ferramentas: [{ name, status, ms, isError, blocked?, reason? }]
  @Default([])
  @Column(DataType.JSONB)
  toolCalls: any[];

  // Eventos de guardrail: [{ tool, action: "block"|"mask", reason }]
  @Default([])
  @Column(DataType.JSONB)
  guardrailEvents: any[];

  @Column(DataType.STRING)
  stopReason: string;

  // "ok" | "error" | "transferred"
  @Default("ok")
  @Column(DataType.STRING)
  status: string;

  @Column(DataType.TEXT)
  finalText: string;

  @Column(DataType.TEXT)
  error: string;

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;
}

export default AgentTrace;
