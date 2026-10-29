import {
  Table,
  Column,
  Model,
  PrimaryKey,
  AutoIncrement,
  CreatedAt,
  UpdatedAt,
  Default,
  DataType,
  ForeignKey,
  HasMany
} from "sequelize-typescript";
import Company from "./Company";
import AutomationStep from "./AutomationStep";

/**
 * Jornada de automação (ex.: pos_vendas, vendas, visita). Cada jornada tem
 * passos (AutomationStep) e é disparada por um evento do API interno.
 */
@Table({ tableName: "AutomationJourneys" })
class AutomationJourney extends Model<AutomationJourney> {
  @PrimaryKey
  @AutoIncrement
  @Column
  id: number;

  @ForeignKey(() => Company)
  @Column
  companyId: number;

  // Chave estável da jornada: "pos_vendas" | "vendas" | "visita".
  @Column
  key: string;

  @Column
  name: string;

  @Default(true)
  @Column
  isActive: boolean;

  // Conexão oficial (EvoHub) usada para enviar os templates. null = resolve a
  // conexão oficial padrão da empresa.
  @Column(DataType.INTEGER)
  whatsappId: number;

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;

  @HasMany(() => AutomationStep)
  steps: AutomationStep[];
}

export default AutomationJourney;
