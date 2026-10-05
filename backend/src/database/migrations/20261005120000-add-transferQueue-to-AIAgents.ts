import { QueryInterface, DataTypes } from "sequelize";

/**
 * Fila para onde o agente transfere o atendimento ao "passar para o humano".
 * Deve ser uma fila SEM agente — ao mover o ticket pra ela, o agente para de
 * atuar automaticamente.
 */
module.exports = {
  up: async (queryInterface: QueryInterface) => {
    const table = await queryInterface.describeTable("AIAgents");
    if (!table.transferQueueId) {
      await queryInterface.addColumn("AIAgents", "transferQueueId", {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "Queues", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL"
      });
    }
  },

  down: async (queryInterface: QueryInterface) => {
    const table = await queryInterface.describeTable("AIAgents");
    if (table.transferQueueId) {
      await queryInterface.removeColumn("AIAgents", "transferQueueId");
    }
  }
};
