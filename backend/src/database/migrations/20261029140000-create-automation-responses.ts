import { QueryInterface, DataTypes } from "sequelize";

/** Respostas das pesquisas (PSI) das automações. */
module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.createTable("AutomationResponses", {
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
      taskId: {
        type: DataTypes.INTEGER,
        references: { model: "AutomationTasks", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
        allowNull: true
      },
      band: { type: DataTypes.STRING, allowNull: true },
      buttonText: { type: DataTypes.STRING, allowNull: true },
      respondedAt: { type: DataTypes.DATE, allowNull: true },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false }
    });
    await queryInterface.addIndex("AutomationResponses", ["taskId"], {
      unique: true,
      name: "automation_responses_task"
    });
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.dropTable("AutomationResponses");
  }
};
