import { QueryInterface, DataTypes } from "sequelize";

/**
 * Memória do agente de IA.
 *  - scope="session": estado da conversa (vinculado ao ticket).
 *  - scope="contact": memória de longo prazo do cliente (vinculada ao contato).
 * A mesma chave é sobrescrita (upsert no serviço). Índices ajudam a carregar
 * rápido a memória de um ticket/contato.
 */
module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.createTable("AgentMemories", {
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
      scope: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: "session"
      },
      contactId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "Contacts", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE"
      },
      ticketId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "Tickets", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE"
      },
      key: {
        type: DataTypes.STRING,
        allowNull: false
      },
      value: {
        type: DataTypes.TEXT,
        allowNull: true
      },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false
      },
      updatedAt: {
        type: DataTypes.DATE,
        allowNull: false
      }
    });

    await queryInterface.addIndex("AgentMemories", ["companyId", "contactId"], {
      name: "agent_memories_company_contact_idx"
    });
    await queryInterface.addIndex("AgentMemories", ["companyId", "ticketId"], {
      name: "agent_memories_company_ticket_idx"
    });
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.dropTable("AgentMemories");
  }
};
