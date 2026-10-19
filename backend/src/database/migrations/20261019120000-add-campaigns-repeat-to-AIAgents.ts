import { QueryInterface, DataTypes } from "sequelize";

/**
 * Campanhas/condições vigentes (editáveis fora do prompt) e limiar de handoff
 * por repetição (loop do agente ou cliente insistindo em desconto). Ver
 * HandleAgentReply.
 */
module.exports = {
  up: async (queryInterface: QueryInterface) => {
    const table = await queryInterface.describeTable("AIAgents");
    if (!table.campaigns) {
      await queryInterface.addColumn("AIAgents", "campaigns", {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: []
      });
    }
    if (!table.repeatTransferThreshold) {
      await queryInterface.addColumn("AIAgents", "repeatTransferThreshold", {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 3
      });
    }
  },

  down: async (queryInterface: QueryInterface) => {
    const table = await queryInterface.describeTable("AIAgents");
    if (table.campaigns) {
      await queryInterface.removeColumn("AIAgents", "campaigns");
    }
    if (table.repeatTransferThreshold) {
      await queryInterface.removeColumn("AIAgents", "repeatTransferThreshold");
    }
  }
};
