import { QueryInterface, DataTypes } from "sequelize";

/**
 * Roteamento próprio da conexão (fonte preferida; o agente vira fallback):
 *  - sellers: pool de vendedores do rodízio desta conexão;
 *  - sellerRotationIndex: ponteiro do round-robin;
 *  - notifyWhatsappId: conexão (Baileys) que envia os avisos (vendedor/qualidade);
 *  - qualityNumber: número fixo do responsável de qualidade.
 * Idempotente.
 */
module.exports = {
  up: async (queryInterface: QueryInterface) => {
    const table = await queryInterface.describeTable("Whatsapps");
    const add = async (name: string, spec: any) => {
      if (!table[name]) await queryInterface.addColumn("Whatsapps", name, spec);
    };
    await add("sellers", { type: DataTypes.JSONB, allowNull: false, defaultValue: [] });
    await add("sellerRotationIndex", { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 });
    await add("notifyWhatsappId", { type: DataTypes.INTEGER, allowNull: true });
    await add("qualityNumber", { type: DataTypes.STRING, allowNull: true });
  },

  down: async (queryInterface: QueryInterface) => {
    const table = await queryInterface.describeTable("Whatsapps");
    const drop = async (name: string) => {
      if (table[name]) await queryInterface.removeColumn("Whatsapps", name);
    };
    await drop("sellers");
    await drop("sellerRotationIndex");
    await drop("notifyWhatsappId");
    await drop("qualityNumber");
  }
};
