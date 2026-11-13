import { QueryInterface, DataTypes } from "sequelize";

/**
 * Última entrega de cada webhook (para conferir na tela de Integrações se
 * está chegando no destino): quando, qual evento e o resultado.
 */
module.exports = {
  up: async (queryInterface: QueryInterface) => {
    const table = await queryInterface.describeTable("Webhooks");
    if (!table.lastDeliveryAt) {
      await queryInterface.addColumn("Webhooks", "lastDeliveryAt", {
        type: DataTypes.DATE,
        allowNull: true
      });
    }
    if (!table.lastDeliveryEvent) {
      await queryInterface.addColumn("Webhooks", "lastDeliveryEvent", {
        type: DataTypes.TEXT,
        allowNull: true
      });
    }
    if (!table.lastDeliveryStatus) {
      await queryInterface.addColumn("Webhooks", "lastDeliveryStatus", {
        type: DataTypes.TEXT,
        allowNull: true
      });
    }
    if (!table.lastDeliveryOk) {
      await queryInterface.addColumn("Webhooks", "lastDeliveryOk", {
        type: DataTypes.BOOLEAN,
        allowNull: true
      });
    }
  },

  down: async (queryInterface: QueryInterface) => {
    const table = await queryInterface.describeTable("Webhooks");
    for (const col of [
      "lastDeliveryAt",
      "lastDeliveryEvent",
      "lastDeliveryStatus",
      "lastDeliveryOk"
    ]) {
      if (table[col]) {
        // eslint-disable-next-line no-await-in-loop
        await queryInterface.removeColumn("Webhooks", col);
      }
    }
  }
};
