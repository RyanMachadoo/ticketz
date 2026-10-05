import { QueryInterface, DataTypes } from "sequelize";

/**
 * Atribuição de leads Click-to-WhatsApp (CTWA).
 * Quando alguém clica num anúncio CTWA e manda mensagem, a Cloud API envia um
 * objeto `referral` na 1ª mensagem. Guardamos aqui 1 registro por ticket (o
 * anúncio que originou a conversa), para relatório de leads por anúncio.
 */
module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.createTable("CtwaReferrals", {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false
      },
      companyId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "Companies", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE"
      },
      ticketId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "Tickets", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE"
      },
      contactId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "Contacts", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL"
      },
      whatsappId: {
        type: DataTypes.INTEGER,
        allowNull: true
      },
      sourceId: { type: DataTypes.STRING, allowNull: true }, // ID do anúncio
      sourceType: { type: DataTypes.STRING, allowNull: true }, // ad | post
      sourceUrl: { type: DataTypes.TEXT, allowNull: true },
      headline: { type: DataTypes.TEXT, allowNull: true }, // título do anúncio
      body: { type: DataTypes.TEXT, allowNull: true },
      mediaType: { type: DataTypes.STRING, allowNull: true },
      ctwaClid: { type: DataTypes.TEXT, allowNull: true }, // id do clique (CAPI)
      ref: { type: DataTypes.TEXT, allowNull: true },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false }
    });

    await queryInterface.addIndex("CtwaReferrals", {
      fields: ["ticketId"],
      unique: true,
      name: "ctwa_referrals_ticket_unique"
    });
    await queryInterface.addIndex("CtwaReferrals", {
      fields: ["companyId", "sourceId"],
      name: "ctwa_referrals_company_source"
    });
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.dropTable("CtwaReferrals");
  }
};
