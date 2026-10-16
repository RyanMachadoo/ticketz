import { QueryInterface, DataTypes } from "sequelize";

/**
 * Dias de intervalo para o agente "recomeçar o assunto" quando o cliente volta
 * após muito tempo (corta o histórico no ponto de retomada; preferências
 * continuam vindo da memória de longo prazo). 0 = nunca corta. Ver
 * HandleAgentReply (buildConversation).
 */
module.exports = {
  up: async (queryInterface: QueryInterface) => {
    const table = await queryInterface.describeTable("AIAgents");
    if (!table.conversationResetDays) {
      await queryInterface.addColumn("AIAgents", "conversationResetDays", {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 3
      });
    }
  },

  down: async (queryInterface: QueryInterface) => {
    const table = await queryInterface.describeTable("AIAgents");
    if (table.conversationResetDays) {
      await queryInterface.removeColumn("AIAgents", "conversationResetDays");
    }
  }
};
