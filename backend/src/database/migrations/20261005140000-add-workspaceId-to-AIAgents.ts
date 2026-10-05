import { QueryInterface, DataTypes } from "sequelize";

/**
 * Workspace ID da Anthropic (opcional). Necessário quando a API key é da
 * ORGANIZAÇÃO (não escopada a um workspace): a Anthropic exige o header
 * anthropic-workspace-id. Com uma key já escopada a um workspace, deixe vazio.
 */
module.exports = {
  up: async (queryInterface: QueryInterface) => {
    const table = await queryInterface.describeTable("AIAgents");
    if (!table.anthropicWorkspaceId) {
      await queryInterface.addColumn("AIAgents", "anthropicWorkspaceId", {
        type: DataTypes.STRING,
        allowNull: true,
        defaultValue: null
      });
    }
  },

  down: async (queryInterface: QueryInterface) => {
    const table = await queryInterface.describeTable("AIAgents");
    if (table.anthropicWorkspaceId) {
      await queryInterface.removeColumn("AIAgents", "anthropicWorkspaceId");
    }
  }
};
