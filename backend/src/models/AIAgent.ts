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

  // Workspace ID da Anthropic (opcional). Preencha quando a key for da
  // organização; com key de workspace, deixe vazio.
  @Column(DataType.STRING)
  anthropicWorkspaceId: string;

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

  // Guardrails determinísticos (verificações em código antes das ferramentas).
  // Ver AgentGuardrails.ts. Ex.: { maxToolCallsPerTurn, allowedDomains,
  // blockedDomains, blockedKeywords, maskPii }.
  @Default({})
  @Column(DataType.JSONB)
  guardrails: any;

  // Minutos sem resposta do cliente para transferir ao humano (0 = desligado).
  // O agente responde, aguarda; se o cliente ficar em silêncio por este tempo,
  // o lead é repassado a um vendedor. Ver AgentInactivityQueue.
  @Default(0)
  @Column
  inactivityTimeoutMinutes: number;

  // Dias de intervalo para "recomeçar o assunto": se o cliente volta após este
  // tempo, o histórico é cortado no ponto de retomada e o agente inicia um novo
  // atendimento (preferências continuam vindo da memória). 0 = nunca corta.
  @Default(3)
  @Column
  conversationResetDays: number;

  // Campanhas/condições vigentes, editáveis FORA do prompt principal. Só as
  // ativas são injetadas no contexto do agente a cada resposta. Formato:
  // [{ titulo, descricao, validade?, ativo }]. Ver HandleAgentReply.
  @Default([])
  @Column(DataType.JSONB)
  campaigns: any[];

  // Discernimento de handoff: após este nº de repetições (agente em loop OU
  // cliente insistindo em desconto), transfere para um humano. 0 = desligado.
  @Default(3)
  @Column
  repeatTransferThreshold: number;

  // Vendedores para o rodízio de leads. Ao transferir, o agente avisa um
  // vendedor no WhatsApp DELE (número próprio) com o contexto do lead, em vez
  // de o vendedor pegar o ticket na plataforma. Formato:
  // [{ nome, numero, aliases?: string[], ativo }]. Ver AgentSellerService.
  @Default([])
  @Column(DataType.JSONB)
  sellers: any[];

  // Ponteiro do rodízio (round-robin) entre os vendedores ativos.
  @Default(0)
  @Column
  sellerRotationIndex: number;

  // Conexão usada para AVISAR os vendedores. O ideal é um número secundário
  // conectado via BAILEYS (dedicado a avisos internos): sem janela de 24h, sem
  // template, sem custo Meta. Se vazio, usa a conexão do ticket (ex.: EvoHub).
  @Column
  sellerNotifyWhatsappId: number;

  // Aviso ao vendedor no canal OFICIAL (EvoHub): fora da janela de 24h, a Meta
  // exige template aprovado (HSM). Só é usado quando o aviso sai por uma
  // conexão oficial. Com Baileys, isto é ignorado (manda texto livre direto).
  @Column(DataType.STRING)
  sellerTemplateName: string;

  @Default("pt_BR")
  @Column(DataType.STRING)
  sellerTemplateLang: string;

  @HasMany(() => Queue)
  queues: Queue[];

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;
}

export default AIAgent;
