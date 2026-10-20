import { QueryInterface, DataTypes } from "sequelize";

/**
 * Template (HSM) para avisar o vendedor no canal OFICIAL (EvoHub) fora da
 * janela de 24h. Opcional: se vazio, tenta texto livre. Ver AgentSellerService.
 */
module.exports = {
  up: async (queryInterface: QueryInterface) => {
    const table = await queryInterface.describeTable("AIAgents");
    if (!table.sellerTemplateName) {
      await queryInterface.addColumn("AIAgents", "sellerTemplateName", {
        type: DataTypes.STRING,
        allowNull: true
      });
    }
    if (!table.sellerTemplateLang) {
      await queryInterface.addColumn("AIAgents", "sellerTemplateLang", {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: "pt_BR"
      });
    }
  },

  down: async (queryInterface: QueryInterface) => {
    const table = await queryInterface.describeTable("AIAgents");
    if (table.sellerTemplateName) {
      await queryInterface.removeColumn("AIAgents", "sellerTemplateName");
    }
    if (table.sellerTemplateLang) {
      await queryInterface.removeColumn("AIAgents", "sellerTemplateLang");
    }
  }
};
