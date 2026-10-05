import { QueryInterface, DataTypes } from "sequelize";

/**
 * Campos de controle de custo/uso do canal oficial (EvoHub / Cloud API).
 * A partir de 01/10/2026 a Meta cobra por mensagem; aqui guardamos, por conexão
 * (= por número), o limite mensal de mensagens de SERVIÇO (atendimento), a
 * franquia grátis mensal, os preços por categoria (para estimar custo em R$) e
 * o estado de bloqueio (manual ou por override do admin no mês corrente).
 */
module.exports = {
  up: async (queryInterface: QueryInterface) => {
    const table = await queryInterface.describeTable("Whatsapps");
    const addColumn = async (name: string, spec: any) => {
      if (!table[name]) {
        await queryInterface.addColumn("Whatsapps", name, spec);
      }
    };

    // Limite mensal de mensagens de serviço (null = sem limite).
    await addColumn("serviceMonthlyLimit", {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: null
    });

    // Franquia grátis mensal de mensagens de serviço (Meta: 1.000/mês por número).
    await addColumn("serviceFreeTier", {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 1000
    });

    // Preços por categoria (R$ por mensagem), configuráveis. DECIMAL(10,4).
    await addColumn("priceService", {
      type: DataTypes.DECIMAL(10, 4),
      allowNull: false,
      defaultValue: 0
    });
    await addColumn("priceMarketing", {
      type: DataTypes.DECIMAL(10, 4),
      allowNull: false,
      defaultValue: 0
    });
    await addColumn("priceUtility", {
      type: DataTypes.DECIMAL(10, 4),
      allowNull: false,
      defaultValue: 0
    });
    await addColumn("priceAuthentication", {
      type: DataTypes.DECIMAL(10, 4),
      allowNull: false,
      defaultValue: 0
    });

    // Bloqueio manual do envio (ligado/desligado pelo admin).
    await addColumn("usageManualBlock", {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false
    });

    // Período (YYYY-MM) em que o admin liberou o envio mesmo acima do limite.
    // Vale só para o mês informado; ao virar o mês, o limite volta a valer.
    await addColumn("usageOverridePeriod", {
      type: DataTypes.STRING,
      allowNull: true,
      defaultValue: null
    });
  },

  down: async (queryInterface: QueryInterface) => {
    const table = await queryInterface.describeTable("Whatsapps");
    const dropColumn = async (name: string) => {
      if (table[name]) {
        await queryInterface.removeColumn("Whatsapps", name);
      }
    };
    await dropColumn("serviceMonthlyLimit");
    await dropColumn("serviceFreeTier");
    await dropColumn("priceService");
    await dropColumn("priceMarketing");
    await dropColumn("priceUtility");
    await dropColumn("priceAuthentication");
    await dropColumn("usageManualBlock");
    await dropColumn("usageOverridePeriod");
  }
};
