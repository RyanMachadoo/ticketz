import { QueryInterface, DataTypes } from "sequelize";

/**
 * Guardrails determinísticos do agente (verificações em código ANTES de
 * executar ferramentas). Config em JSON. Ver AgentGuardrails.ts:
 *  {
 *    "maxToolCallsPerTurn": 6,
 *    "allowedDomains": ["api.meusistema.com"],
 *    "blockedDomains": [],
 *    "blockedKeywords": ["senha", "cartão"],
 *    "maskPii": true
 *  }
 */
module.exports = {
  up: async (queryInterface: QueryInterface) => {
    const table = await queryInterface.describeTable("AIAgents");
    if (!table.guardrails) {
      await queryInterface.addColumn("AIAgents", "guardrails", {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {}
      });
    }
  },

  down: async (queryInterface: QueryInterface) => {
    const table = await queryInterface.describeTable("AIAgents");
    if (table.guardrails) {
      await queryInterface.removeColumn("AIAgents", "guardrails");
    }
  }
};
