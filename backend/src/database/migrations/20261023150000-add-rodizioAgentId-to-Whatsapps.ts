import { QueryInterface, DataTypes } from "sequelize";

/**
 * Rodízio de vendedores por CONEXÃO: aponta para um agente de IA cuja config
 * de rodízio (vendedores + conexão de aviso) será usada no handoff desta
 * conexão (ex.: lead de campanha por botão), independente de fila com IA.
 * Sem FK (igual ao sellerNotifyWhatsappId) para evitar travas de ordem de
 * exclusão; a resolução trata id inválido como "sem agente".
 */
module.exports = {
  up: async (queryInterface: QueryInterface) => {
    const table = await queryInterface.describeTable("Whatsapps");
    if (!table.rodizioAgentId) {
      await queryInterface.addColumn("Whatsapps", "rodizioAgentId", {
        type: DataTypes.INTEGER,
        allowNull: true,
        defaultValue: null
      });
    }
  },

  down: async (queryInterface: QueryInterface) => {
    const table = await queryInterface.describeTable("Whatsapps");
    if (table.rodizioAgentId) {
      await queryInterface.removeColumn("Whatsapps", "rodizioAgentId");
    }
  }
};
