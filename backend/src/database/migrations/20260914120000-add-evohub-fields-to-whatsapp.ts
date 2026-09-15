import { QueryInterface, DataTypes } from "sequelize";

/**
 * Config da conexão do canal oficial via EvoHub.
 * O token é segredo — em produção, avaliar criptografar em repouso.
 */
module.exports = {
  up: (queryInterface: QueryInterface) =>
    Promise.all([
      queryInterface.addColumn("Whatsapps", "evohubBaseUrl", {
        type: DataTypes.TEXT,
        allowNull: true,
        defaultValue: "https://api.evohub.ai/meta"
      }),
      queryInterface.addColumn("Whatsapps", "evohubToken", {
        type: DataTypes.TEXT,
        allowNull: true
      }),
      queryInterface.addColumn("Whatsapps", "evohubPhoneNumberId", {
        type: DataTypes.TEXT,
        allowNull: true
      }),
      queryInterface.addColumn("Whatsapps", "evohubWabaId", {
        type: DataTypes.TEXT,
        allowNull: true
      })
    ]),

  down: (queryInterface: QueryInterface) =>
    Promise.all([
      queryInterface.removeColumn("Whatsapps", "evohubBaseUrl"),
      queryInterface.removeColumn("Whatsapps", "evohubToken"),
      queryInterface.removeColumn("Whatsapps", "evohubPhoneNumberId"),
      queryInterface.removeColumn("Whatsapps", "evohubWabaId")
    ])
};
