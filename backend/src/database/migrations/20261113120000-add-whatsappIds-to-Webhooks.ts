import { QueryInterface, DataTypes } from "sequelize";

/**
 * Vínculo do webhook de saída com CONEXÕES: lista de ids de Whatsapps.
 * null ou [] = todas as conexões (comportamento anterior).
 */
module.exports = {
  up: async (queryInterface: QueryInterface) => {
    const table = await queryInterface.describeTable("Webhooks");
    if (!table.whatsappIds) {
      await queryInterface.addColumn("Webhooks", "whatsappIds", {
        type: DataTypes.JSONB,
        allowNull: true,
        defaultValue: null
      });
    }
  },

  down: async (queryInterface: QueryInterface) => {
    const table = await queryInterface.describeTable("Webhooks");
    if (table.whatsappIds) {
      await queryInterface.removeColumn("Webhooks", "whatsappIds");
    }
  }
};
