import {
  Table,
  Column,
  Model,
  PrimaryKey,
  AutoIncrement,
  CreatedAt,
  UpdatedAt,
  Default,
  ForeignKey
} from "sequelize-typescript";
import Company from "./Company";
import AIAgent from "./AIAgent";

/**
 * Documento da base de conhecimento de um agente (um arquivo .txt/.md enviado).
 * O texto é quebrado em trechos (AgentKnowledgeChunk) para a busca.
 */
@Table({ tableName: "AgentKnowledgeDocs" })
class AgentKnowledgeDoc extends Model<AgentKnowledgeDoc> {
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

  @Column
  title: string;

  @Column
  filename: string;

  @Default("upload")
  @Column
  source: string;

  @Default(0)
  @Column
  charCount: number;

  @Default(0)
  @Column
  chunkCount: number;

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;
}

export default AgentKnowledgeDoc;
