import { QueryInterface, DataTypes } from "sequelize";

/**
 * Contadores de uso do canal oficial, por conexão (número), por mês e categoria.
 * Uma linha por (whatsappId, period, category). O "count" é incrementado a cada
 * envio bem-sucedido. Base para contabilizar mensagens e estimar custo.
 *   period   -> "YYYY-MM"
 *   category -> "service" | "marketing" | "utility" | "authentication"
 */
module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.createTable("MessageUsages", {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false
      },
      whatsappId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "Whatsapps", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE"
      },
      companyId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "Companies", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE"
      },
      period: {
        type: DataTypes.STRING,
        allowNull: false
      },
      category: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: "service"
      },
      count: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0
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

    await queryInterface.addIndex("MessageUsages", {
      fields: ["whatsappId", "period", "category"],
      unique: true,
      name: "message_usages_whatsapp_period_category"
    });
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.dropTable("MessageUsages");
  }
};
