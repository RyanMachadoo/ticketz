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
  DataType
} from "sequelize-typescript";
import Company from "./Company";
import Contact from "./Contact";
import Ticket from "./Ticket";

/**
 * Memória do agente de IA (estilo ADK: estado de sessão + memória de longo prazo).
 *
 *  - scope = "session": fato válido para ESTA conversa (vinculado ao ticket).
 *      Ex.: interesse atual, modelo cotado, melhor horário combinado.
 *  - scope = "contact": fato de LONGO PRAZO sobre o cliente (vinculado ao contato),
 *      que persiste entre conversas. Ex.: já é cliente, carro que possui, preferência.
 *
 * A chave (key) identifica o fato; gravar a mesma chave sobrescreve o valor
 * (upsert no serviço). Assim o agente "lembra" sem acumular lixo infinito.
 */
@Table({ tableName: "AgentMemories" })
class AgentMemory extends Model<AgentMemory> {
  @PrimaryKey
  @AutoIncrement
  @Column
  id: number;

  @ForeignKey(() => Company)
  @Column
  companyId: number;

  @BelongsTo(() => Company)
  company: Company;

  // "session" | "contact"
  @Column(DataType.STRING)
  scope: string;

  @ForeignKey(() => Contact)
  @Column
  contactId: number;

  @BelongsTo(() => Contact)
  contact: Contact;

  @ForeignKey(() => Ticket)
  @Column
  ticketId: number;

  @BelongsTo(() => Ticket)
  ticket: Ticket;

  @Column(DataType.STRING)
  key: string;

  @Column(DataType.TEXT)
  value: string;

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;
}

export default AgentMemory;
