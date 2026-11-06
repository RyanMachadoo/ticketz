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
  ForeignKey
} from "sequelize-typescript";
import Company from "./Company";
import AIAgent from "./AIAgent";
import AgentKnowledgeDoc from "./AgentKnowledgeDoc";

/**
 * Trecho (chunk) de um documento da base de conhecimento. A busca usa a coluna
 * gerada `tsv` (tsvector português, criada na migration) — NÃO mapeada aqui,
 * pois é preenchida pelo Postgres automaticamente a partir de `content`.
 */
@Table({ tableName: "AgentKnowledgeChunks" })
class AgentKnowledgeChunk extends Model<AgentKnowledgeChunk> {
  @PrimaryKey
  @AutoIncrement
  @Column
  id: number;

  @ForeignKey(() => Company)
  @Column
  companyId: number;

  @ForeignKey(() => AIAgent)
  @Column
  agentId: number;

  @ForeignKey(() => AgentKnowledgeDoc)
  @Column
  docId: number;

  @Default(0)
  @Column
  ord: number;

  @Column(DataType.TEXT)
  content: string;

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;
}

export default AgentKnowledgeChunk;
