import { QueryInterface, DataTypes } from "sequelize";

/**
 * Campos de template da Meta para campanhas enviadas por conexão oficial (EvoHub).
 * - templateName / templateLanguage: identificam o template aprovado na WABA.
 * - templateParams: JSON com os valores das variáveis do corpo ({{1}}, {{2}}...),
 *   cada um podendo conter variáveis de campanha ({nome}, {numero}, etc.), que são
 *   processadas por contato no momento do disparo.
 *
 * Só se aplica ao canal "whatsapp_oficial"; conexões Baileys continuam usando
 * as mensagens de texto livres (message1..5) e ignoram estes campos.
 */
module.exports = {
  up: (queryInterface: QueryInterface) =>
    Promise.all([
      queryInterface.addColumn("Campaigns", "templateName", {
        type: DataTypes.TEXT,
        allowNull: true
      }),
      queryInterface.addColumn("Campaigns", "templateLanguage", {
        type: DataTypes.TEXT,
        allowNull: true
      }),
      queryInterface.addColumn("Campaigns", "templateParams", {
        type: DataTypes.JSON,
        allowNull: true
      })
    ]),

  down: (queryInterface: QueryInterface) =>
    Promise.all([
      queryInterface.removeColumn("Campaigns", "templateName"),
      queryInterface.removeColumn("Campaigns", "templateLanguage"),
      queryInterface.removeColumn("Campaigns", "templateParams")
    ])
};
