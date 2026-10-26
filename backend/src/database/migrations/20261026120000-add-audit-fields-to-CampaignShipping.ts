import { QueryInterface, DataTypes } from "sequelize";

/**
 * Campos de AUDITORIA do disparo de campanha (comprovação):
 *  - wamid: id da mensagem na Meta (casa com os eventos de status);
 *  - sentBody: texto EXATO enviado ao destinatário (template renderizado);
 *  - ackStatus + ackDeliveredAt/ackReadAt/ackFailedAt: status real da Meta;
 *  - failReason: motivo da falha (quando houver).
 * Tudo idempotente (ADD COLUMN só se não existir).
 */
module.exports = {
  up: async (queryInterface: QueryInterface) => {
    const table = await queryInterface.describeTable("CampaignShipping");
    const addCol = async (name: string, spec: any) => {
      if (!table[name]) {
        await queryInterface.addColumn("CampaignShipping", name, spec);
      }
    };
    await addCol("wamid", { type: DataTypes.STRING, allowNull: true });
    await addCol("sentBody", { type: DataTypes.TEXT, allowNull: true });
    await addCol("ackStatus", { type: DataTypes.STRING, allowNull: true });
    await addCol("ackDeliveredAt", { type: DataTypes.DATE, allowNull: true });
    await addCol("ackReadAt", { type: DataTypes.DATE, allowNull: true });
    await addCol("ackFailedAt", { type: DataTypes.DATE, allowNull: true });
    await addCol("failReason", { type: DataTypes.TEXT, allowNull: true });
  },

  down: async (queryInterface: QueryInterface) => {
    const table = await queryInterface.describeTable("CampaignShipping");
    const dropCol = async (name: string) => {
      if (table[name]) {
        await queryInterface.removeColumn("CampaignShipping", name);
      }
    };
    await dropCol("wamid");
    await dropCol("sentBody");
    await dropCol("ackStatus");
    await dropCol("ackDeliveredAt");
    await dropCol("ackReadAt");
    await dropCol("ackFailedAt");
    await dropCol("failReason");
  }
};
