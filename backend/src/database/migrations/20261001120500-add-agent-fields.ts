import { QueryInterface, DataTypes } from "sequelize";

/**
 * Vínculo do agente de IA:
 *  - Queues.aiAgentId: qual agente atende os tickets desta fila.
 *  - Tickets.useAgent: se o agente ainda está conduzindo o ticket. Quando o
 *    agente transfere para humano (ou um atendente assume), vira false e o
 *    agente para de responder. null/true = agente pode responder.
 */
module.exports = {
  up: async (queryInterface: QueryInterface) => {
    const queues = await queryInterface.describeTable("Queues");
    if (!queues.aiAgentId) {
      await queryInterface.addColumn("Queues", "aiAgentId", {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "AIAgents", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL"
      });
    }

    const tickets = await queryInterface.describeTable("Tickets");
    if (!tickets.useAgent) {
      await queryInterface.addColumn("Tickets", "useAgent", {
        type: DataTypes.BOOLEAN,
        allowNull: true,
        defaultValue: null
      });
    }
  },

  down: async (queryInterface: QueryInterface) => {
    const queues = await queryInterface.describeTable("Queues");
    if (queues.aiAgentId) {
      await queryInterface.removeColumn("Queues", "aiAgentId");
    }
    const tickets = await queryInterface.describeTable("Tickets");
    if (tickets.useAgent) {
      await queryInterface.removeColumn("Tickets", "useAgent");
    }
  }
};
