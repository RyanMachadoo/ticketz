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
  HasMany,
  DataType
} from "sequelize-typescript";
import Company from "./Company";
import Queue from "./Queue";

/**
 * Agente de IA (compatível com a API da Anthropic / Claude).
 * Guarda credencial, modelo, instruções e a lista de ferramentas que o agente
 * pode acionar durante o atendimento. O vínculo com as filas é feito por
 * Queue.aiAgentId (uma fila aponta para um agente).
 *
 * Formato de cada item em `tools` (JSON):
 *  {
 *    "kind": "http" | "webhook" | "transfer",
 *    "name": "consulta_os",
 *    "description": "...",
 *    "parameters": [ { "name","type","description","required" } ],
 *    // http:
 *    "method": "GET|POST|PUT|PATCH|DELETE",
 *    "url": "https://.../{{placa}}",
 *    "headers": [ { "key","value" } ],
 *    "bodyTemplate": "{...{{param}}...}",
 *    // webhook:
 *    "event": "agent.custom"
 *  }
 */
@Table({ tableName: "AIAgents" })
class AIAgent extends Model<AIAgent> {
  @PrimaryKey
  @AutoIncrement
  @Column
  id: number;

  @ForeignKey(() => Company)
  @Column
  companyId: number;

  @BelongsTo(() => Company)
  company: Company;

  @Column(DataType.STRING)
  name: string;

  // Segredo — nunca logar.
  @Column(DataType.TEXT)
  apiKey: string;

  @Default("claude-3-5-sonnet-latest")
  @Column(DataType.STRING)
  model: string;

  @Default(1024)
  @Column
  maxTokens: number;

  @Default(0.7)
  @Column(DataType.DECIMAL(4, 2))
  temperature: number;

  @Default("")
  @Column(DataType.TEXT)
  systemPrompt: string;

  @Default([])
  @Column(DataType.JSONB)
  tools: any[];

  @Default(5)
  @Column
  maxToolSteps: number;

  @Default(true)
  @Column
  isActive: boolean;

  // Fila para onde o agente transfere ao "passar para o humano" (sem agente).
  // Ao mover o ticket pra cá, o agente para de atuar.
  @Column
  transferQueueId: number;

  @HasMany(() => Queue)
  queues: Queue[];

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;
}

export default AIAgent;
