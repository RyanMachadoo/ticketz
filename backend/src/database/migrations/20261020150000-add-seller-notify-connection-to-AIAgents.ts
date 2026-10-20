import { QueryInterface, DataTypes } from "sequelize";

/**
 * Conexão usada para avisar os vendedores (rodízio). Ideal: um número Baileys
 * secundário, dedicado a avisos internos — sem janela de 24h nem template.
 * Vazio = usa a conexão do ticket. Ver AgentSellerService.
 */
module.exports = {
  up: async (queryInterface: QueryInterface) => {
    const table = await queryInterface.describeTable("AIAgents");
    if (!table.sellerNotifyWhatsappId) {
      await queryInterface.addColumn("AIAgents", "sellerNotifyWhatsappId", {
        type: DataTypes.INTEGER,
        allowNull: true
      });
    }
  },

  down: async (queryInterface: QueryInterface) => {
    const table = await queryInterface.describeTable("AIAgents");
    if (table.sellerNotifyWhatsappId) {
      await queryInterface.removeColumn("AIAgents", "sellerNotifyWhatsappId");
    }
  }
};
