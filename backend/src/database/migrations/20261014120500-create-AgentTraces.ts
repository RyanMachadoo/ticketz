import { QueryInterface, DataTypes } from "sequelize";

/**
 * Trace (raio-x) por turno do agente de IA — observabilidade estilo ADK.
 * Um registro por resposta do agente: modelo, tokens, custo, latência, passos,
 * trajetória de ferramentas e eventos de guardrail.
 */
module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.createTable("AgentTraces", {
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
      ticketId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "Tickets", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL"
      },
      agentId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "AIAgents", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL"
      },
      model: {
        type: DataTypes.STRING,
        allowNull: true
      },
      inputTokens: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0
      },
      outputTokens: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0
      },
      costUsd: {
        type: DataTypes.DECIMAL(12, 6),
        allowNull: false,
        defaultValue: 0
      },
      latencyMs: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0
      },
      steps: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0
      },
      toolCalls: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: []
      },
      guardrailEvents: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: []
      },
      stopReason: {
        type: DataTypes.STRING,
        allowNull: true
      },
      status: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: "ok"
      },
      finalText: {
        type: DataTypes.TEXT,
        allowNull: true
      },
      error: {
        type: DataTypes.TEXT,
        allowNull: true
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

    await queryInterface.addIndex("AgentTraces", ["companyId", "ticketId"], {
      name: "agent_traces_company_ticket_idx"
    });
    await queryInterface.addIndex("AgentTraces", ["companyId", "createdAt"], {
      name: "agent_traces_company_created_idx"
    });
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.dropTable("AgentTraces");
  }
};
