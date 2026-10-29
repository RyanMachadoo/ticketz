import { QueryInterface, DataTypes } from "sequelize";

/**
 * Tabelas do motor de automações de relacionamento (pós-vendas e vendas):
 * jornadas, passos, inscrições (idempotentes) e tarefas agendadas (duráveis).
 */
module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.createTable("AutomationJourneys", {
      id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true, allowNull: false },
      companyId: {
        type: DataTypes.INTEGER,
        references: { model: "Companies", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
        allowNull: false
      },
      key: { type: DataTypes.STRING, allowNull: false },
      name: { type: DataTypes.STRING, allowNull: false },
      isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      whatsappId: { type: DataTypes.INTEGER, allowNull: true },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false }
    });
    await queryInterface.addIndex("AutomationJourneys", ["companyId", "key"], {
      unique: true,
      name: "automation_journeys_company_key"
    });

    await queryInterface.createTable("AutomationSteps", {
      id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true, allowNull: false },
      companyId: {
        type: DataTypes.INTEGER,
        references: { model: "Companies", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
        allowNull: false
      },
      journeyId: {
        type: DataTypes.INTEGER,
        references: { model: "AutomationJourneys", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
        allowNull: false
      },
      key: { type: DataTypes.STRING, allowNull: false },
      order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      name: { type: DataTypes.STRING, allowNull: false },
      triggerType: { type: DataTypes.STRING, allowNull: false, defaultValue: "event" },
      offsetMinutes: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      kind: { type: DataTypes.STRING, allowNull: false, defaultValue: "message" },
      templateName: { type: DataTypes.STRING, allowNull: true },
      templateLanguage: { type: DataTypes.STRING, allowNull: false, defaultValue: "pt_BR" },
      templateParams: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      surveyConfig: { type: DataTypes.JSONB, allowNull: true },
      isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false }
    });
    await queryInterface.addIndex("AutomationSteps", ["journeyId", "key"], {
      unique: true,
      name: "automation_steps_journey_key"
    });

    await queryInterface.createTable("AutomationEnrollments", {
      id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true, allowNull: false },
      companyId: {
        type: DataTypes.INTEGER,
        references: { model: "Companies", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
        allowNull: false
      },
      journeyId: {
        type: DataTypes.INTEGER,
        references: { model: "AutomationJourneys", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
        allowNull: false
      },
      contactNumber: { type: DataTypes.STRING, allowNull: false },
      contactName: { type: DataTypes.STRING, allowNull: true },
      eventAt: { type: DataTypes.DATE, allowNull: false },
      externalRef: { type: DataTypes.STRING, allowNull: true },
      dedupeKey: { type: DataTypes.STRING, allowNull: false },
      status: { type: DataTypes.STRING, allowNull: false, defaultValue: "active" },
      data: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false }
    });
    await queryInterface.addIndex("AutomationEnrollments", ["companyId", "dedupeKey"], {
      unique: true,
      name: "automation_enrollments_company_dedupe"
    });

    await queryInterface.createTable("AutomationTasks", {
      id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true, allowNull: false },
      companyId: {
        type: DataTypes.INTEGER,
        references: { model: "Companies", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
        allowNull: false
      },
      enrollmentId: {
        type: DataTypes.INTEGER,
        references: { model: "AutomationEnrollments", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
        allowNull: false
      },
      stepId: {
        type: DataTypes.INTEGER,
        references: { model: "AutomationSteps", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
        allowNull: false
      },
      runAt: { type: DataTypes.DATE, allowNull: false },
      status: { type: DataTypes.STRING, allowNull: false, defaultValue: "pending" },
      attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      lastError: { type: DataTypes.TEXT, allowNull: true },
      wamid: { type: DataTypes.STRING, allowNull: true },
      sentAt: { type: DataTypes.DATE, allowNull: true },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false }
    });
    await queryInterface.addIndex("AutomationTasks", ["status", "runAt"], {
      name: "automation_tasks_status_runat"
    });
    await queryInterface.addIndex("AutomationTasks", ["enrollmentId", "stepId"], {
      unique: true,
      name: "automation_tasks_enrollment_step"
    });
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.dropTable("AutomationTasks");
    await queryInterface.dropTable("AutomationEnrollments");
    await queryInterface.dropTable("AutomationSteps");
    await queryInterface.dropTable("AutomationJourneys");
  }
};
