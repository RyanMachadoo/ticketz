import axios from "axios";
import { getIO } from "../../libs/socket";
import Queue from "../../models/Queue";
import Ticket from "../../models/Ticket";
import { logger } from "../../utils/logger";
import { dispatchWebhookEvent } from "../WebhookServices/DispatchWebhook";
import ShowTicketService from "../TicketServices/ShowTicketService";
import { AnthropicTool } from "./AnthropicProvider";
import {
  saveMemory,
  MEMORY_SCOPE_CONTACT,
  MEMORY_SCOPE_SESSION
} from "./AgentMemoryService";
import {
  consultarEstoque,
  EstoqueFiltro,
  EstoqueVeiculo
} from "../EstoqueServices/EstoqueService";
import AIAgent from "../../models/AIAgent";
import { handoffToSeller, HandoffResult } from "./AgentSellerService";

export const HUMAN_QUEUE_NAME = "Atendimento Humano";

/**
 * Garante uma fila de "atendimento humano" (sem agente) para a empresa, criando
 * se não existir. É a rede de segurança do transfer quando o agente não tem uma
 * fila de transferência configurada. Nunca lança — devolve null em último caso.
 */
export async function getOrCreateHumanQueue(
  companyId: number
): Promise<Queue | null> {
  try {
    const existing = await Queue.findOne({
      where: { companyId, name: HUMAN_QUEUE_NAME }
    });
    if (existing) return existing;

    const palette = [
      "#607D8B",
      "#455A64",
      "#5D4037",
      "#37474F",
      "#6D4C41",
      "#795548",
      "#9E9E9E"
    ];
    // tenta cores da paleta; cor/nome têm unique, então cai no fallback se falhar
    // eslint-disable-next-line no-restricted-syntax
    for (const color of palette) {
      try {
        // eslint-disable-next-line no-await-in-loop
        return await Queue.create({
          name: HUMAN_QUEUE_NAME,
          color,
          companyId,
          greetingMessage: ""
        } as any);
      } catch (e) {
        /* cor em uso: tenta a próxima */
      }
    }
    // fallback: nome com sufixo da empresa + cor aleatória
    for (let i = 0; i < 5; i += 1) {
      const color = `#${Math.floor(Math.random() * 16777215)
        .toString(16)
        .padStart(6, "0")}`;
      try {
        // eslint-disable-next-line no-await-in-loop
        return await Queue.create({
          name: `${HUMAN_QUEUE_NAME} ${companyId}`,
          color,
          companyId,
          greetingMessage: ""
        } as any);
      } catch (e) {
        /* tenta de novo */
      }
    }
    return null;
  } catch (err: any) {
    logger.error(
      `[Agente IA] falha ao obter/criar fila de atendimento humano: ${err?.message}`
    );
    return null;
  }
}

/**
 * Converte a config de ferramentas do agente (JSON) no formato de tools da
 * Anthropic e executa as chamadas quando o modelo pede.
 *
 * Tipos (kind):
 *  - "http":     chama uma API HTTP externa (método/URL/headers/body com {{param}})
 *  - "webhook":  dispara um webhook de integração (n8n) com os dados coletados
 *  - "transfer": transfere o atendimento para uma fila/humano (nativo)
 *
 * SEGURANÇA: as URLs/headers das ferramentas HTTP são configuradas pelo admin
 * (conteúdo confiável). Mesmo assim, limitamos tempo e tamanho da resposta.
 */

const TRANSFER_TOOL_NAME = "transferir_atendimento";
export const MEMORY_TOOL_NAME = "anotar_memoria";
export const ESTOQUE_TOOL_NAME = "consultar_estoque";

/**
 * A Anthropic exige nome de ferramenta no padrão ^[a-zA-Z0-9_-]{1,128}$.
 * Sanitizamos (remove acentos/espaços/símbolos) para nunca dar 400 — e usamos
 * a MESMA função ao enviar e ao localizar a ferramenta, mantendo o casamento.
 */
export function sanitizeToolName(name: string): string {
  const base = (name || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[_-]+|[_-]+$/g, "")
    .slice(0, 128);
  return base || "ferramenta";
}

const jsonTypeOf = (t?: string): string => {
  const v = (t || "string").toLowerCase();
  if (["number", "integer", "boolean"].includes(v)) return v;
  return "string";
};

/** input_schema da Anthropic a partir da lista de parâmetros configurada. */
function buildInputSchema(parameters: any[]): AnthropicTool["input_schema"] {
  const properties: Record<string, any> = {};
  const required: string[] = [];
  (parameters || []).forEach(p => {
    if (!p?.name) return;
    properties[p.name] = {
      type: jsonTypeOf(p.type),
      description: p.description || ""
    };
    if (p.required) required.push(p.name);
  });
  return { type: "object", properties, required };
}

/** Definição da ferramenta nativa de transferência (formato Anthropic). */
function transferToolDef(description?: string): AnthropicTool {
  return {
    name: TRANSFER_TOOL_NAME,
    description:
      description ||
      "Transfere o atendimento para um vendedor. CHAME esta ferramenta (não apenas prometa que vai transferir) quando: o cliente AGENDAR/confirmar uma visita ou test drive; pedir para falar com uma pessoa; entrar em negociação de preço/desconto/financiamento/avaliação de troca; quiser fechar/reservar/pagar; for pós-venda/oficina/garantia/reclamação; ou quando você não conseguir resolver. ANTES de transferir, pergunte ao cliente se ele já tem um vendedor de preferência na Francauto e, se tiver, passe o nome em 'vendedor_preferencia'. Se você disser que vai transferir, DEVE chamar esta ferramenta na mesma resposta. Ao usar, o atendimento sai com você e um vendedor assume.",
    input_schema: {
      type: "object",
      properties: {
        motivo: {
          type: "string",
          description:
            "Resumo do lead para o vendedor: nome, interesse (modelo/0km ou usado), faixa de preço, carro na troca, melhor horário e o que ficou combinado."
        },
        vendedor_preferencia: {
          type: "string",
          description:
            "Nome do vendedor que o cliente pediu, se ele indicou algum. Deixe vazio se o cliente não tem preferência (aí entra o rodízio)."
        },
        fila: {
          type: "string",
          description:
            "Nome da fila de destino (opcional). Se vazio, usa a fila de atendimento humano padrão do agente."
        }
      },
      required: ["motivo"]
    }
  };
}

/** Definição da ferramenta nativa de memória (estilo ADK). */
function memoryToolDef(): AnthropicTool {
  return {
    name: MEMORY_TOOL_NAME,
    description:
      "Anota um fato importante na memória para lembrar depois e NÃO repetir perguntas. Use quando o cliente informar algo que vale guardar: nome, modelo/carro de interesse, forma de pagamento, melhor horário, se já é cliente, placa/veículo que possui, etc. Escolha o escopo: 'contato' para fatos duradouros do cliente (valem em conversas futuras) e 'conversa' para o estado deste atendimento. Anote de forma curta e objetiva (uma informação por chamada). Não anote dados sensíveis (senha, cartão, documentos).",
    input_schema: {
      type: "object",
      properties: {
        escopo: {
          type: "string",
          description:
            "'contato' (fato duradouro do cliente) ou 'conversa' (estado deste atendimento). Padrão: conversa."
        },
        chave: {
          type: "string",
          description:
            "Rótulo curto do fato, ex.: 'modelo_interesse', 'melhor_horario', 'forma_pagamento'."
        },
        valor: {
          type: "string",
          description: "O valor do fato, ex.: 'T-Cross Highline', 'sábado de manhã'."
        }
      },
      required: ["chave", "valor"]
    }
  };
}

/** Definição da ferramenta nativa de consulta de estoque (formato Anthropic). */
function estoqueToolDef(description?: string): AnthropicTool {
  return {
    name: ESTOQUE_TOOL_NAME,
    description:
      description ||
      "Consulta o estoque de veículos em tempo real. Use SEMPRE que o cliente perguntar se tem um modelo, pedir opções, faixa de preço, ou quiser ver carros — nunca invente modelos, anos, km ou preços. Importante: 0km (tipo 'novos') são SOMENTE Volkswagen; usados/seminovos (tipo 'usados') são MULTIMARCAS (várias marcas) — não restrinja a VW no usado. Filtre por tipo, modelo, preço (preco_max/preco_min), ano mínimo, câmbio e combustível para trazer poucas opções certeiras. Depois de mostrar, puxe o cliente para agendar uma visita/test drive.",
    input_schema: {
      type: "object",
      properties: {
        tipo: {
          type: "string",
          description:
            "'novos' (0km), 'usados' (seminovos) ou 'todos'. Padrão: todos."
        },
        modelo: {
          type: "string",
          description:
            "Filtra por modelo/termo (ex.: 'T-Cross', 'Amarok', 'Nivus'). Opcional."
        },
        preco_max: {
          type: "number",
          description: "Preço máximo em reais (ex.: 120000). Opcional."
        },
        preco_min: {
          type: "number",
          description: "Preço mínimo em reais. Opcional."
        },
        ano_min: {
          type: "number",
          description: "Ano mínimo do veículo (ex.: 2022). Opcional."
        },
        cambio: {
          type: "string",
          description: "Filtra por câmbio (ex.: 'automático', 'manual'). Opcional."
        },
        combustivel: {
          type: "string",
          description:
            "Filtra por combustível (ex.: 'flex', 'diesel', 'gasolina'). Opcional."
        }
      },
      required: []
    }
  };
}

/**
 * Monta a lista de tools (formato Anthropic) para uma config de agente.
 * As ferramentas nativas de transferência e de memória são SEMPRE incluídas
 * (mesmo que o admin não as tenha adicionado), para o agente sempre conseguir
 * passar para um humano e registrar o que aprendeu. A de estoque só entra
 * quando o admin adiciona uma ferramenta do tipo "estoque" (opt-in).
 */
export function buildAnthropicTools(tools: any[]): AnthropicTool[] {
  const result: AnthropicTool[] = [];
  let hasTransfer = false;
  let hasEstoque = false;
  (tools || []).forEach(t => {
    if (!t) return;
    if (t.kind === "transfer") {
      result.push(transferToolDef(t.description));
      hasTransfer = true;
      return;
    }
    if (t.kind === "estoque") {
      if (!hasEstoque) {
        result.push(estoqueToolDef(t.description));
        hasEstoque = true;
      }
      return;
    }
    if (t.kind === "memory") {
      // memória é nativa; ignoramos entradas duplicadas do admin
      return;
    }
    if (!t.name) return;
    result.push({
      name: sanitizeToolName(t.name),
      description: t.description || "",
      input_schema: buildInputSchema(t.parameters)
    });
  });
  if (!hasTransfer) {
    result.push(transferToolDef());
  }
  // memória nativa sempre disponível
  result.push(memoryToolDef());
  return result;
}

/** Localiza a definição (config) de uma ferramenta pelo nome sanitizado. */
export function findToolDef(agentTools: any[], toolName: string): any {
  return (agentTools || []).find(
    t => t?.name && sanitizeToolName(t.name) === toolName
  );
}

/** Interpola {{chave}} e {{obj.campo}} usando input + contexto. */
function interpolate(template: string, vars: Record<string, any>): string {
  if (!template) return template;
  return template.replace(/{{\s*([\w.]+)\s*}}/g, (_m, key) => {
    const val = vars[key];
    return val === undefined || val === null ? "" : String(val);
  });
}

/** Achata input + contexto num mapa de chaves (inclui contact.* e ticket.*). */
function buildVars(input: any, ctx: AgentToolContext): Record<string, any> {
  const vars: Record<string, any> = {};
  if (input && typeof input === "object") {
    Object.keys(input).forEach(k => {
      vars[k] = input[k];
    });
  }
  vars["contact.name"] = ctx.contactName;
  vars["contact.number"] = ctx.contactNumber;
  vars["ticket.id"] = ctx.ticketId;
  return vars;
}

export interface AgentToolContext {
  companyId: number;
  ticketId: number;
  contactId?: number | null;
  contactName: string;
  contactNumber: string;
  transferQueueId?: number | null;
}

export interface ToolExecutionResult {
  content: string; // texto devolvido ao modelo (tool_result)
  isError: boolean;
  transferred?: boolean;
}

const MAX_RESULT_CHARS = 4000;

const truncate = (s: string): string =>
  s && s.length > MAX_RESULT_CHARS ? `${s.slice(0, MAX_RESULT_CHARS)}…` : s;

/** Executa UMA ferramenta pedida pelo modelo e devolve o resultado em texto. */
export async function executeTool(
  toolName: string,
  input: any,
  agentTools: any[],
  ctx: AgentToolContext
): Promise<ToolExecutionResult> {
  logger.info(
    `[Agente IA] ticket=${ctx.ticketId} chamando ferramenta '${toolName}' input=${JSON.stringify(
      input || {}
    ).slice(0, 500)}`
  );

  // Transferência (nativa)
  if (toolName === TRANSFER_TOOL_NAME) {
    return executeTransfer(input, ctx);
  }

  // Memória (nativa)
  if (toolName === MEMORY_TOOL_NAME) {
    return executeRememberMemory(input, ctx);
  }

  // Estoque (nativa, opt-in): usa a config da ferramenta kind "estoque".
  if (toolName === ESTOQUE_TOOL_NAME) {
    const estoqueDef = (agentTools || []).find(t => t?.kind === "estoque");
    return executeEstoque(estoqueDef, input);
  }

  // Casa pelo nome sanitizado (o modelo devolve o nome já sanitizado).
  const def = findToolDef(agentTools, toolName);
  if (!def) {
    return { content: `Ferramenta '${toolName}' não encontrada.`, isError: true };
  }

  try {
    if (def.kind === "webhook") {
      const event = def.event || "agent.custom";
      await dispatchWebhookEvent(ctx.companyId, event as any, {
        source: "ai-agent",
        ticketId: ctx.ticketId,
        contact: { name: ctx.contactName, number: ctx.contactNumber },
        input
      });
      return {
        content: "Webhook disparado com sucesso.",
        isError: false
      };
    }

    if (def.kind === "http") {
      const vars = buildVars(input, ctx);
      const url = interpolate(def.url || "", vars);
      if (!url) {
        return { content: "URL da ferramenta não configurada.", isError: true };
      }
      const headers: Record<string, string> = {};
      (def.headers || []).forEach((h: any) => {
        if (h?.key) headers[h.key] = interpolate(String(h.value || ""), vars);
      });

      const method = (def.method || "GET").toUpperCase();
      let data: any;
      if (def.bodyTemplate && ["POST", "PUT", "PATCH"].includes(method)) {
        const bodyStr = interpolate(def.bodyTemplate, vars);
        try {
          data = JSON.parse(bodyStr);
          if (!headers["Content-Type"] && !headers["content-type"]) {
            headers["Content-Type"] = "application/json";
          }
        } catch {
          data = bodyStr; // envia como texto se não for JSON válido
        }
      }

      const startedAt = Date.now();
      const resp = await axios.request({
        url,
        method: method as any,
        headers,
        data,
        timeout: 15000,
        validateStatus: () => true, // não lança em 4xx/5xx; devolve ao modelo
        maxContentLength: 1_000_000
      });
      const ms = Date.now() - startedAt;

      const contentType = String(
        resp.headers?.["content-type"] || resp.headers?.["Content-Type"] || ""
      );
      logger.info(
        `[Agente IA] ferramenta '${toolName}' HTTP ${method} ${url} -> ${resp.status} (${ms}ms, ${contentType || "?"})`
      );

      const payload =
        typeof resp.data === "string"
          ? resp.data
          : JSON.stringify(resp.data);

      // Dica ao modelo quando a URL devolve página HTML (site) em vez de API JSON.
      if (contentType.includes("text/html")) {
        return {
          content: truncate(
            `A URL retornou uma página HTML (não uma API). Informe que não foi possível consultar automaticamente e peça para transferir ou tente outra ferramenta. Status HTTP ${resp.status}.`
          ),
          isError: true
        };
      }

      return {
        content: truncate(`HTTP ${resp.status}: ${payload}`),
        isError: resp.status >= 400
      };
    }

    return {
      content: `Tipo de ferramenta '${def.kind}' não suportado.`,
      isError: true
    };
  } catch (err: any) {
    const msg = err?.response?.data
      ? JSON.stringify(err.response.data)
      : err?.message || "erro";
    logger.error(
      `[Agente IA] erro executando ferramenta ${toolName}: ${msg}`
    );
    return { content: truncate(`Erro na ferramenta: ${msg}`), isError: true };
  }
}

/**
 * Núcleo da transferência (reutilizável): move o ticket para a fila de
 * atendimento humano (SEMPRE sai da fila do agente) e desliga o agente nesse
 * ticket. Ordem do destino: fila citada -> fila de transferência do agente ->
 * fila padrão "Atendimento Humano" (criada se não existir). Usado pela
 * ferramenta de transferência E pelo monitor de inatividade.
 * Devolve o id da fila de destino (ou null).
 */
export interface TransferResult {
  targetQueueId: number | null;
  seller: HandoffResult | null;
}

export async function transferTicketToHuman(params: {
  companyId: number;
  ticketId: number;
  transferQueueId?: number | null;
  filaNome?: string;
  motivo?: string;
  sellerPreference?: string;
}): Promise<TransferResult> {
  const {
    companyId,
    ticketId,
    transferQueueId,
    filaNome,
    motivo,
    sellerPreference
  } = params;
  const ticket = await Ticket.findByPk(ticketId);
  if (!ticket) return { targetQueueId: null, seller: null };

  // Carrega o agente da fila ATUAL (antes de mover) para o rodízio de vendedores.
  let agent: AIAgent | null = null;
  try {
    if (ticket.queueId) {
      const origQueue = await Queue.findByPk(ticket.queueId);
      if (origQueue && origQueue.aiAgentId) {
        agent = await AIAgent.findByPk(origQueue.aiAgentId);
      }
    }
  } catch (e) {
    // best-effort
  }

  let targetQueueId: number | null = null;

  if (filaNome) {
    const queue = await Queue.findOne({
      where: { name: filaNome.trim(), companyId }
    });
    if (queue) targetQueueId = queue.id;
  }
  if (!targetQueueId && transferQueueId) {
    targetQueueId = transferQueueId;
  }
  if (!targetQueueId) {
    const humanQueue = await getOrCreateHumanQueue(companyId);
    if (humanQueue) targetQueueId = humanQueue.id;
  }

  // NUNCA transfira para uma fila que tenha IA (senão o agente reassume na hora).
  if (targetQueueId) {
    const target = await Queue.findByPk(targetQueueId);
    if (target && target.aiAgentId) targetQueueId = null;
  }

  // O destino SEMPRE sai da fila do agente. Se não há fila humana resolvida,
  // o ticket fica sem fila (pendente) — garante que o agente para de atuar sem
  // depender só do useAgent (que é reativado ao voltar para uma fila com IA).
  await ticket.update({
    useAgent: false,
    chatbot: false,
    status: "pending",
    userId: null,
    queueId: targetQueueId
  });

  let fullTicket: any = null;
  try {
    const io = getIO();
    fullTicket = await ShowTicketService(ticketId, companyId);
    io.to(ticketId.toString())
      .to(`company-${companyId}-pending`)
      .to(`company-${companyId}-notification`)
      .to(`queue-${targetQueueId}-pending`)
      .emit(`company-${companyId}-ticket`, {
        action: "update",
        ticket: fullTicket
      });
  } catch (e) {
    // socket é best-effort
  }

  // Rodízio: avisa um vendedor no WhatsApp dele com o contexto do lead.
  let seller: HandoffResult | null = null;
  if (agent) {
    seller = await handoffToSeller({
      agent,
      companyId,
      contactName: fullTicket?.contact?.name || "",
      contactNumber: fullTicket?.contact?.number || "",
      motivo,
      preference: sellerPreference,
      whatsappId: ticket.whatsappId || fullTicket?.whatsappId
    });
  }

  logger.info(
    `[Agente IA] TRANSFERIDO ticket=${ticketId} -> fila=${
      targetQueueId || "sem fila"
    } (agente desligado). Vendedor avisado: ${
      seller?.sellerName || "nenhum"
    }. Motivo: ${motivo || "-"}`
  );
  return { targetQueueId, seller };
}

/**
 * Transferência pedida pelo modelo (ferramenta nativa).
 */
async function executeTransfer(
  input: any,
  ctx: AgentToolContext
): Promise<ToolExecutionResult> {
  const ticket = await Ticket.findByPk(ctx.ticketId);
  if (!ticket) {
    return { content: "Ticket não encontrado para transferir.", isError: true };
  }

  const result = await transferTicketToHuman({
    companyId: ctx.companyId,
    ticketId: ctx.ticketId,
    transferQueueId: ctx.transferQueueId || null,
    filaNome: input?.fila ? String(input.fila) : undefined,
    motivo: input?.motivo,
    sellerPreference: input?.vendedor_preferencia
      ? String(input.vendedor_preferencia)
      : undefined
  });

  const content = result.seller
    ? `Lead encaminhado ao vendedor ${result.seller.sellerName}${
        result.seller.viaPreference ? " (preferência do cliente)" : " (rodízio)"
      }, que já foi avisado no WhatsApp e vai chamar o cliente. Diga ao cliente, de forma curta e calorosa, que o vendedor ${result.seller.sellerName} vai entrar em contato pelo WhatsApp em instantes, e despeça-se. Não continue o atendimento.`
    : "Atendimento transferido para a equipe de vendas. Avise o cliente, de forma curta e cordial, que um vendedor vai chamá-lo em instantes, e despeça-se. Não continue o atendimento.";

  return {
    content,
    isError: false,
    transferred: true
  };
}

/**
 * Grava um fato na memória do agente (nativo). Escopo "contato" => memória de
 * longo prazo do cliente; "conversa" => estado desta conversa.
 */
async function executeRememberMemory(
  input: any,
  ctx: AgentToolContext
): Promise<ToolExecutionResult> {
  const chave = input?.chave ? String(input.chave).trim() : "";
  const valor = input?.valor !== undefined ? String(input.valor) : "";
  if (!chave) {
    return { content: "Informe a chave do fato a memorizar.", isError: true };
  }

  const escopoRaw = (input?.escopo || "").toString().toLowerCase();
  const scope =
    escopoRaw.startsWith("cont") && !escopoRaw.startsWith("conv")
      ? MEMORY_SCOPE_CONTACT
      : MEMORY_SCOPE_SESSION;

  const ok = await saveMemory({
    companyId: ctx.companyId,
    ticketId: ctx.ticketId,
    contactId: ctx.contactId || null,
    scope,
    key: chave,
    value: valor
  });

  const label = scope === MEMORY_SCOPE_CONTACT ? "cliente" : "conversa";
  return {
    content: ok
      ? `Anotado na memória (${label}): ${chave} = ${valor}.`
      : "Não foi possível anotar agora; siga o atendimento normalmente.",
    isError: !ok
  };
}

const formatBRL = (n: number): string =>
  `R$ ${Number(n || 0).toLocaleString("pt-BR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  })}`;

const linhaVeiculo = (v: EstoqueVeiculo): string => {
  const partes = [v.nome || `${v.marca} ${v.modelo}`.trim()];
  const extra: string[] = [];
  if (v.tipo === "usado" && v.km) extra.push(`${v.km.toLocaleString("pt-BR")} km`);
  if (v.tipo === "novo") extra.push("0km");
  const meta = extra.length ? ` (${extra.join(", ")})` : "";
  return `- ${partes[0]}${meta} — ${formatBRL(v.preco)}`;
};

/**
 * Consulta o estoque (0km/usados) e devolve um resumo compacto em texto para o
 * modelo — contagens, faixa de preço e uma lista enxuta dos veículos.
 */
async function executeEstoque(
  def: any,
  input: any
): Promise<ToolExecutionResult> {
  const filtro: EstoqueFiltro = {
    tipo: input?.tipo,
    modelo: input?.modelo,
    precoMax: input?.preco_max,
    precoMin: input?.preco_min,
    anoMin: input?.ano_min,
    cambio: input?.cambio,
    combustivel: input?.combustivel
  };

  try {
    const res = await consultarEstoque(
      {
        baseUrl: def?.baseUrl,
        path: def?.path,
        // Poucos itens para o modelo (economia de token); contagens e faixa de
        // preço vêm no cabeçalho. O cliente refina por modelo/preço se precisar.
        limit: Number(def?.limit) || 8
      },
      filtro
    );

    if (!res.total) {
      return {
        content:
          "Nenhum veículo encontrado com esses critérios no estoque agora. Ofereça ajustar o filtro (modelo/preço) ou transfira para um vendedor consultar novidades.",
        isError: false
      };
    }

    const cab = `Estoque encontrado: ${res.total} veículo(s)` +
      (res.novos ? `, ${res.novos} zero-km` : "") +
      (res.usados ? `, ${res.usados} usado(s)` : "") +
      (res.precoMin != null
        ? `. Preços de ${formatBRL(res.precoMin)} a ${formatBRL(res.precoMax || 0)}.`
        : ".");

    const linhas = res.itens.map(linhaVeiculo).join("\n");
    const rodape = res.truncado
      ? `\n(mostrando ${res.itens.length} de ${res.total}; peça para filtrar por modelo ou faixa de preço para refinar.)`
      : "";

    return {
      content: `${cab}\n${linhas}${rodape}`,
      isError: false
    };
  } catch (err: any) {
    logger.error(`[Agente IA] erro ao consultar estoque: ${err?.message}`);
    return {
      content:
        "Não consegui consultar o estoque agora. Peça desculpas rapidamente e ofereça transferir para um vendedor.",
      isError: true
    };
  }
}
