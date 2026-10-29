/**
 * Blueprint das jornadas padrão. Usado para criar as jornadas/passos de uma
 * empresa na primeira vez (idempotente). Os templateName são SUGESTÕES — o Ryan
 * aprova na Meta e revincula pela tela/endpoint. Passos sem templateName são
 * pulados no envio (logado), então nada dispara até estarem vinculados.
 *
 * tipo do evento -> key da jornada:
 *   os_encerrada     -> pos_vendas
 *   venda_entregue   -> vendas
 *   visita_sem_fechar-> visita
 */

const H = 60; // 1 hora em minutos
const D = 1440; // 1 dia em minutos

export const EVENT_TO_JOURNEY: Record<string, string> = {
  os_encerrada: "pos_vendas",
  venda_entregue: "vendas",
  visita_sem_fechar: "visita"
};

export interface BlueprintStep {
  key: string;
  order: number;
  name: string;
  triggerType: "event" | "on_survey";
  offsetMinutes: number;
  kind: "message" | "survey";
  templateName: string;
  templateParams: string[];
  surveyConfig?: any;
}

export interface BlueprintJourney {
  key: string;
  name: string;
  steps: BlueprintStep[];
}

// Config padrão de pesquisa por bandas (botões -> banda -> ação).
//  - onBand["5"].steps: passos on_survey a agendar (cada um usa seu próprio
//    offsetMinutes a partir da resposta: cem=imediato, agradecimento=7d).
//  - onBand["1-4"].quality: avisa o responsável de qualidade (sem CEM).
const SURVEY_PSI = {
  buttons: [
    { text: "Ótimo", band: "5" },
    { text: "Pode melhorar", band: "1-4" }
  ],
  onBand: {
    "5": { steps: ["cem", "agradecimento"] },
    "1-4": { quality: true }
  }
};

export const BLUEPRINT: BlueprintJourney[] = [
  {
    key: "pos_vendas",
    name: "Pós-Vendas (O.S.)",
    steps: [
      { key: "psi", order: 1, name: "PSI (24h)", triggerType: "event", offsetMinutes: 1 * D, kind: "survey", templateName: "psi_posvendas", templateParams: ["{nome}"], surveyConfig: SURVEY_PSI },
      { key: "cem", order: 2, name: "CEM / ROUTE (nota 5)", triggerType: "on_survey", offsetMinutes: 0, kind: "message", templateName: "cem_route_info", templateParams: ["{nome}"] },
      { key: "agradecimento", order: 3, name: "Agradecimento (7d após nota 5)", triggerType: "on_survey", offsetMinutes: 7 * D, kind: "message", templateName: "agradecimento_psi", templateParams: ["{nome}"] },
      { key: "smd", order: 4, name: "SMD (20d)", triggerType: "event", offsetMinutes: 20 * D, kind: "message", templateName: "smd_posvendas", templateParams: ["{nome}"] },
      { key: "csi", order: 5, name: "CSI (30d)", triggerType: "event", offsetMinutes: 30 * D, kind: "message", templateName: "csi_posvendas", templateParams: ["{nome}"] }
    ]
  },
  {
    key: "vendas",
    name: "Vendas (Entrega)",
    steps: [
      { key: "psi", order: 1, name: "PSI entrega (24h)", triggerType: "event", offsetMinutes: 1 * D, kind: "survey", templateName: "psi_entrega", templateParams: ["{nome}"], surveyConfig: SURVEY_PSI },
      { key: "cem", order: 2, name: "CEM / ROUTE (nota 5)", triggerType: "on_survey", offsetMinutes: 0, kind: "message", templateName: "cem_route_info", templateParams: ["{nome}"] },
      { key: "agradecimento", order: 3, name: "Agradecimento (7d após nota 5)", triggerType: "on_survey", offsetMinutes: 7 * D, kind: "message", templateName: "agradecimento_psi", templateParams: ["{nome}"] },
      { key: "parabens", order: 4, name: "Parabéns + tudo certo? (7d)", triggerType: "event", offsetMinutes: 7 * D, kind: "message", templateName: "parabens_compra", templateParams: ["{nome}"] },
      { key: "smd", order: 5, name: "SMD - Como anda seu VW (20d)", triggerType: "event", offsetMinutes: 20 * D, kind: "message", templateName: "smd_vendas", templateParams: ["{nome}"] },
      { key: "csi", order: 6, name: "CSI (30d)", triggerType: "event", offsetMinutes: 30 * D, kind: "message", templateName: "csi_vendas", templateParams: ["{nome}"] },
      { key: "aniversario", order: 7, name: "Aniversário de compra (365d)", triggerType: "event", offsetMinutes: 365 * D, kind: "message", templateName: "aniversario_compra", templateParams: ["{nome}", "{modelo}"] }
    ]
  },
  {
    key: "visita",
    name: "Visita sem fechamento",
    steps: [
      { key: "reengajar", order: 1, name: "Reengajar (1h)", triggerType: "event", offsetMinutes: 1 * H, kind: "message", templateName: "visita_sem_fechar", templateParams: ["{nome}"] }
    ]
  }
];
