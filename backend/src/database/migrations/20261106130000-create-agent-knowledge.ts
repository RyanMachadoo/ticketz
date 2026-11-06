import { QueryInterface, DataTypes } from "sequelize";

/**
 * Base de conhecimento (RAG) por agente: documentos + trechos (chunks). A busca
 * usa full-text do Postgres (coluna gerada `tsv`, dicionário 'portuguese', com
 * índice GIN). Sem dependência externa.
 */
module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.createTable("AgentKnowledgeDocs", {
      id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true, allowNull: false },
      companyId: {
        type: DataTypes.INTEGER,
        references: { model: "Companies", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
        allowNull: false
      },
      agentId: {
        type: DataTypes.INTEGER,
        references: { model: "AIAgents", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
        allowNull: false
      },
      title: { type: DataTypes.STRING, allowNull: true },
      filename: { type: DataTypes.STRING, allowNull: true },
      source: { type: DataTypes.STRING, allowNull: false, defaultValue: "upload" },
      charCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      chunkCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false }
    });

    await queryInterface.createTable("AgentKnowledgeChunks", {
      id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true, allowNull: false },
      companyId: {
        type: DataTypes.INTEGER,
        references: { model: "Companies", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
        allowNull: false
      },
      agentId: {
        type: DataTypes.INTEGER,
        references: { model: "AIAgents", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
        allowNull: false
      },
      docId: {
        type: DataTypes.INTEGER,
        references: { model: "AgentKnowledgeDocs", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
        allowNull: false
      },
      ord: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      content: { type: DataTypes.TEXT, allowNull: false },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false }
    });

    // Coluna gerada tsvector (português) + índice GIN para a busca full-text.
    await queryInterface.sequelize.query(
      `ALTER TABLE "AgentKnowledgeChunks"
         ADD COLUMN "tsv" tsvector
         GENERATED ALWAYS AS (to_tsvector('portuguese', coalesce("content", ''))) STORED;`
    );
    await queryInterface.sequelize.query(
      `CREATE INDEX "agent_knowledge_chunks_tsv" ON "AgentKnowledgeChunks" USING GIN ("tsv");`
    );
    await queryInterface.addIndex("AgentKnowledgeChunks", ["agentId"], {
      name: "agent_knowledge_chunks_agent"
    });
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.dropTable("AgentKnowledgeChunks");
    await queryInterface.dropTable("AgentKnowledgeDocs");
  }
};
