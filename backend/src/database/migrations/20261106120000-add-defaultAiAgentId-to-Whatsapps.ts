import { QueryInterface, DataTypes } from "sequelize";

/**
 * Agente de IA padrão por CONEXÃO (além do agente por fila): atua no primeiro
 * contato / tickets sem fila com IA e sem atendente humano. null = nenhum.
 * Sem FK (igual aos outros ponteiros de agente), resolução trata id inválido.
 */
module.exports = {
  up: async (queryInterface: QueryInterface) => {
    const table = await queryInterface.describeTable("Whatsapps");
    if (!table.defaultAiAgentId) {
      await queryInterface.addColumn("Whatsapps", "defaultAiAgentId", {
        type: DataTypes.INTEGER,
        allowNull: true,
        defaultValue: null
      });
    }
  },

  down: async (queryInterface: QueryInterface) => {
    const table = await queryInterface.describeTable("Whatsapps");
    if (table.defaultAiAgentId) {
      await queryInterface.removeColumn("Whatsapps", "defaultAiAgentId");
    }
  }
};
