import { QueryInterface, DataTypes } from "sequelize";

/**
 * Botões da campanha que vão DIRETO para o rodízio de vendedores.
 * null = campanha sem configuração própria (usa a configuração geral
 * "campaignSellerButtons"); [] = nenhum botão vai ao rodízio (IA/fila atende).
 */
module.exports = {
  up: async (queryInterface: QueryInterface) => {
    const table = await queryInterface.describeTable("Campaigns");
    if (!table.sellerButtons) {
      await queryInterface.addColumn("Campaigns", "sellerButtons", {
        type: DataTypes.JSONB,
        allowNull: true,
        defaultValue: null
      });
    }
  },

  down: async (queryInterface: QueryInterface) => {
    const table = await queryInterface.describeTable("Campaigns");
    if (table.sellerButtons) {
      await queryInterface.removeColumn("Campaigns", "sellerButtons");
    }
  }
};
