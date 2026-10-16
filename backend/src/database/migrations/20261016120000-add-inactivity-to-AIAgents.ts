import { QueryInterface, DataTypes } from "sequelize";

/**
 * Minutos sem resposta do cliente para o agente repassar o atendimento a um
 * vendedor humano (0 = desligado). Ver AgentInactivityQueue.
 */
module.exports = {
  up: async (queryInterface: QueryInterface) => {
    const table = await queryInterface.describeTable("AIAgents");
    if (!table.inactivityTimeoutMinutes) {
      await queryInterface.addColumn("AIAgents", "inactivityTimeoutMinutes", {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0
      });
    }
  },

  down: async (queryInterface: QueryInterface) => {
    const table = await queryInterface.describeTable("AIAgents");
    if (table.inactivityTimeoutMinutes) {
      await queryInterface.removeColumn("AIAgents", "inactivityTimeoutMinutes");
    }
  }
};
