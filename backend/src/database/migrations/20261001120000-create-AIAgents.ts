import { QueryInterface, DataTypes } from "sequelize";

/**
 * Agentes de IA (compatíveis com a API da Anthropic / Claude).
 * Cada agente tem sua própria chave, modelo, instruções e ferramentas (tools)
 * que pode acionar (HTTP, webhook, transferência). Vinculado às filas via
 * Queues.aiAgentId.
 */
module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.createTable("AIAgents", {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false
      },
      companyId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "Companies", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE"
      },
      name: {
        type: DataTypes.STRING,
        allowNull: false
      },
      // Chave da API da Anthropic (segredo — nunca logar).
      apiKey: {
        type: DataTypes.TEXT,
        allowNull: true
      },
      model: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: "claude-3-5-sonnet-latest"
      },
      maxTokens: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 1024
      },
      temperature: {
        type: DataTypes.DECIMAL(4, 2),
        allowNull: false,
        defaultValue: 0.7
      },
      systemPrompt: {
        type: DataTypes.TEXT,
        allowNull: false,
        defaultValue: ""
      },
      // Lista de ferramentas configuradas (JSON). Ver AgentToolRunner.
      tools: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: []
      },
      // Máximo de passos de tool_use por resposta (trava anti-loop).
      maxToolSteps: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 5
      },
      isActive: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true
      },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false
      },
      updatedAt: {
        type: DataTypes.DATE,
        allowNull: false
      }
    });
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.dropTable("AIAgents");
  }
};
