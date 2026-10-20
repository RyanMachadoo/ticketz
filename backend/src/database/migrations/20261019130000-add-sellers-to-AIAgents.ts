import { QueryInterface, DataTypes } from "sequelize";

/**
 * Vendedores para o rodízio de leads (handoff via WhatsApp do próprio vendedor)
 * e o ponteiro do round-robin. Ver AgentSellerService.
 */
module.exports = {
  up: async (queryInterface: QueryInterface) => {
    const table = await queryInterface.describeTable("AIAgents");
    if (!table.sellers) {
      await queryInterface.addColumn("AIAgents", "sellers", {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: []
      });
    }
    if (!table.sellerRotationIndex) {
      await queryInterface.addColumn("AIAgents", "sellerRotationIndex", {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0
      });
    }
  },

  down: async (queryInterface: QueryInterface) => {
    const table = await queryInterface.describeTable("AIAgents");
    if (table.sellers) {
      await queryInterface.removeColumn("AIAgents", "sellers");
    }
    if (table.sellerRotationIndex) {
      await queryInterface.removeColumn("AIAgents", "sellerRotationIndex");
    }
  }
};
