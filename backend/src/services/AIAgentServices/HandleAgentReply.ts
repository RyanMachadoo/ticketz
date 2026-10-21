import AIAgent from "../../models/AIAgent";
import Message from "../../models/Message";
import Queue from "../../models/Queue";
import Ticket from "../../models/Ticket";
import { logger } from "../../utils/logger";
import ShowTicketService from "../TicketServices/ShowTicketService";
import { getReferralForTicket } from "../CtwaServices/CtwaService";
import SendWhatsAppMessage from "../WbotServices/SendWhatsAppMessage";
import {
  AnthropicMessage,
  callMessages,
  describeAnthropicError,
  extractText,
  extractToolUses
} from "./AnthropicProvider";
import {
  AgentToolContext,
  buildAnthropicTools,
  executeTool,
  findToolDef,
  transferTicketToHuman,
  MEMORY_TOOL_NAME,
  ESTOQUE_TOOL_NAME
} from "./AgentToolRunner";
import {
  loadMemory,
  formatMemoryForPrompt
} from "./AgentMemoryService";
import {
  normalizeGuardrails,
  checkToolCall,
  maskPiiInput
} from "./AgentGuardrails";
import { recordTrace, TraceToolCall } from "./AgentTraceService";
import {
  scheduleInactivityCheck,
  cancelInactivityCheck
} from "../../queues/AgentInactivityQueue";

/**
 * Orquestra uma resposta do agente de IA para um ticket (estilo ADK):
 *  1) carrega o agente vinculado à fila do ticket;
 *  2) carrega a MEMÓRIA (sessão + longo prazo) e injeta no contexto;
 *  3) monta o histórico da conversa;
 *  4) chama a API da Anthropic com as ferramentas;
 *  5) aplica GUARDRAILS determinísticos antes de cada ferramenta;
 *  6) executa as ferramentas pedidas (loop) até a resposta final;
 *  7) envia a resposta final ao cliente pelo canal do ticket;
 *  8) grava um TRACE (raio-x) do turno: tokens, custo, latência, trajetória.
 *
 * Tudo protegido por try/catch — uma falha do agente NUNCA quebra o atendimento.
 */

const HISTORY_LIMIT = Number(process.env.AGENT_HISTORY_LIMIT || 20);
const AGENT_TIMEZONE = process.env.AGENT_TIMEZONE || "America/Sao_Paulo";

// Trava simples em memória para não rodar o agente duas vezes no mesmo ticket
// ao mesmo tempo (ex.: cliente manda várias mensagens seguidas).
const runningTickets = new Set<number>();

/** Data/hora atual, por extenso, no fuso configurado (horário de Brasília). */
function nowInTimezone(): string {
  try {
    return new Intl.DateTimeFormat("pt-BR", {
      timeZone: AGENT_TIMEZONE,
      weekday: "long",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    }).format(new Date());
  } catch {
    return new Date().toISOString();
  }
}

interface ConversationBuild {
  messages: AnthropicMessage[];
  resetApplied: boolean; // histórico foi cortado por intervalo longo
  gapDays: number; // dias desde o último contato (quando houve corte)
  freshStartApplied: boolean; // histórico cortado por reativação (pós-transferência)
}

const stripAccents = (s: string): string =>
  (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "");

const normalizeText = (s: string): string =>
  stripAccents(String(s || ""))
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const wordSet = (s: string): Set<string> =>
  new Set(normalizeText(s).split(" ").filter(w => w.length > 2));

const jaccard = (a: Set<string>, b: Set<string>): number => {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  a.forEach(w => {
    if (b.has(w)) inter += 1;
  });
  return inter / (a.size + b.size - inter);
};

// Cliente pedindo/insistindo em desconto.
const DISCOUNT_RE = /(descont|abaix|mais barat|melhor(a|ar)?\s*o?\s*pre|ultimo\s*pre|ultima?\s*oferta|faz\s*por|cobre|cobrir|preco\s*menor|baratinh|desconta|chora)/;

/** Monta o bloco de campanhas vigentes (só as ativas) para o contexto. */
function formatCampaigns(campaigns: any[]): string {
  const active = (Array.isArray(campaigns) ? campaigns : []).filter(
    c => c && c.ativo !== false && (c.titulo || c.descricao)
  );
  if (!active.length) return "";
  const lines = active.slice(0, 10).map(c => {
    const val = c.validade ? ` (válido até ${c.validade})` : "";
    const desc = c.descricao ? `: ${c.descricao}` : "";
    return `- ${c.titulo || "Campanha"}${desc}${val}`;
  });
  return [
    "CAMPANHAS/CONDIÇÕES VIGENTES (cite quando fizer sentido; use SÓ o que está aqui, não invente outras nem prometa valores além destes):",
    ...lines
  ].join("\n");
}

/**
 * Discernimento de handoff: decide, em código, quando a conversa travou e deve
 * ir para um humano — agente repetindo as mesmas respostas, ou cliente
 * insistindo em desconto além do limite. Rede de segurança do que o prompt
 * também orienta. Retorna motivo quando deve transferir.
 */
function detectStuck(
  messages: AnthropicMessage[],
  threshold: number
): { stuck: boolean; reason?: string } {
  if (!threshold || threshold <= 0) return { stuck: false };

  const assistants = messages
    .filter(m => m.role === "assistant")
    .map(m => String(m.content || ""));
  const users = messages
    .filter(m => m.role === "user")
    .map(m => String(m.content || ""));

  // 1) Agente em loop: últimas N respostas muito parecidas entre si.
  if (assistants.length >= threshold) {
    const last = assistants.slice(-threshold).map(wordSet);
    const sims: number[] = [];
    for (let i = 1; i < last.length; i += 1) {
      sims.push(jaccard(last[i - 1], last[i]));
    }
    const avg = sims.length
      ? sims.reduce((a, b) => a + b, 0) / sims.length
      : 0;
    if (avg >= 0.72) {
      return {
        stuck: true,
        reason: `Conversa repetitiva: o agente repetiu respostas semelhantes ${threshold}x.`
      };
    }
  }

  // 2) Cliente insistindo em desconto além do limite.
  const recentUsers = users.slice(-10);
  const discountCount = recentUsers.filter(t =>
    DISCOUNT_RE.test(normalizeText(t))
  ).length;
  if (discountCount >= threshold) {
    return {
      stuck: true,
      reason: `Cliente insistiu em desconto/negociação ${discountCount}x — melhor um vendedor assumir.`
    };
  }

  return { stuck: false };
}

/**
 * Monta e normaliza o histórico para o formato da Anthropic (alterna papéis).
 *
 * "Corte de continuidade": se o cliente volta após um intervalo grande
 * (resetDays, ex.: 3 dias), o histórico é cortado no ponto de retomada para o
 * agente recomeçar o assunto do zero. As PREFERÊNCIAS não se perdem — elas vêm
 * da memória de longo prazo (por contato), não do histórico cru.
 *
 * "Recomeço por reativação" (freshStart): quando o ticket volta para a fila da
 * IA depois de ter sido transferido para um humano, o histórico cru ainda
 * contém a despedida/transferência do próprio agente ("já vou te passar para um
 * vendedor..."). Se reenviarmos isso, o modelo "acha" que já saiu da conversa e
 * responde VAZIO. Então cortamos para a última fala do cliente em diante (tudo
 * após a última mensagem fromMe), dando um começo limpo — a memória de longo
 * prazo continua provendo o contexto do cliente.
 */
async function buildConversation(
  ticketId: number,
  companyId: number,
  resetDays: number,
  freshStart = false
): Promise<ConversationBuild> {
  const messages = await Message.findAll({
    where: { ticketId, companyId },
    order: [
      ["createdAt", "ASC"],
      ["id", "ASC"]
    ],
    limit: HISTORY_LIMIT
  });

  // Detecta o corte: o intervalo longo MAIS RECENTE entre mensagens consecutivas.
  let startIdx = 0;
  let resetApplied = false;
  let gapDays = 0;
  if (resetDays && resetDays > 0 && messages.length > 1) {
    const thresholdMs = resetDays * 24 * 60 * 60 * 1000;
    for (let i = messages.length - 1; i > 0; i -= 1) {
      const gap =
        new Date(messages[i].createdAt).getTime() -
        new Date(messages[i - 1].createdAt).getTime();
      if (gap >= thresholdMs) {
        startIdx = i;
        resetApplied = true;
        gapDays = Math.round(gap / 86400000);
        break;
      }
    }
  }

  // Reativação: corta para depois da última mensagem do agente/atendente
  // (fromMe), mantendo só o bloco final do cliente. Prevalece sobre o corte por
  // tempo (o começo limpo é o ponto mais recente dos dois).
  let freshStartApplied = false;
  if (freshStart && messages.length) {
    let lastFromMeIdx = -1;
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i].fromMe) {
        lastFromMeIdx = i;
        break;
      }
    }
    // Só corta se houver mensagem do cliente DEPOIS da última fala nossa —
    // caso contrário não há nada novo para responder e mantemos o histórico.
    if (lastFromMeIdx >= 0 && lastFromMeIdx < messages.length - 1) {
      if (lastFromMeIdx + 1 > startIdx) startIdx = lastFromMeIdx + 1;
      freshStartApplied = true;
    }
  }

  const slice = messages.slice(startIdx);
  const turns: { role: "user" | "assistant"; text: string }[] = [];
  slice.forEach(m => {
    let text = (m.body || "").trim();
    if (!text && m.mediaType && m.mediaType !== "chat") {
      text = `[cliente enviou uma mídia do tipo ${m.mediaType}]`;
    }
    if (!text) return;
    const role: "user" | "assistant" = m.fromMe ? "assistant" : "user";
    const last = turns[turns.length - 1];
    if (last && last.role === role) {
      last.text += `\n${text}`;
    } else {
      turns.push({ role, text });
    }
  });

  // Remove turnos iniciais do assistente (a conversa precisa começar com user).
  while (turns.length && turns[0].role === "assistant") {
    turns.shift();
  }

  return {
    messages: turns.map(t => ({ role: t.role, content: t.text })),
    resetApplied,
    gapDays,
    freshStartApplied
  };
}

export async function handleAgentReply(
  ticketId: number,
  companyId: number
): Promise<void> {
  if (runningTickets.has(ticketId)) {
    logger.info(`[Agente IA] já processando ticket=${ticketId}; ignorando.`);
    return;
  }
  runningTickets.add(ticketId);

  // Acumuladores de telemetria (viram um AgentTrace no fim).
  const turnStart = Date.now();
  let inputTokens = 0;
  let outputTokens = 0;
  let steps = 0;
  const toolCalls: TraceToolCall[] = [];
  const guardrailEvents: any[] = [];
  let lastStopReason = "";
  let traceAgentId = 0;
  let traceModel = "";
  let traceStatus = "ok";
  let traceError = "";
  let finalText = "";
  let transferred = false;
  let shouldTrace = false;

  try {
    const ticket = await Ticket.findByPk(ticketId);
    if (!ticket || ticket.companyId !== companyId) return;
    if (ticket.status === "closed") return;
    // Controle é pela FILA: a IA atua enquanto o ticket estiver numa fila com
    // agente. Sem fila ou fila sem agente → não atua.
    if (!ticket.queueId) return;

    const queue = await Queue.findByPk(ticket.queueId);
    if (!queue || !queue.aiAgentId) return;

    // Reativação: se o ticket voltou para uma fila COM IA depois de ter sido
    // transferido (useAgent=false), religa o agente — estar numa fila de IA é o
    // sinal de que a IA deve atender de novo. Guardamos o flag para começar a
    // conversa do zero (ver buildConversation/freshStart): sem isso, o histórico
    // ainda traria a despedida/transferência e o modelo responderia vazio.
    const reactivated = ticket.useAgent === false;
    if (reactivated) {
      await ticket.update({ useAgent: true });
      logger.info(
        `[Agente IA] ticket=${ticketId} voltou para fila com IA — agente reativado (recomeço limpo da conversa).`
      );
    }

    const agent = await AIAgent.findByPk(queue.aiAgentId);
    if (!agent || !agent.isActive) return;
    if (!agent.apiKey) {
      logger.warn(
        `[Agente IA] agente ${agent.id} sem chave de API; não respondeu.`
      );
      return;
    }

    // A partir daqui é um turno "de verdade": vamos gravar trace no fim.
    shouldTrace = true;
    traceAgentId = agent.id;
    traceModel = agent.model;

    const fullTicket = await ShowTicketService(ticketId, companyId);
    const contactId = fullTicket.contactId || fullTicket.contact?.id || null;
    const contactName = fullTicket.contact?.name || "";
    const contactNumber = fullTicket.contact?.number || "";

    // Memória (sessão + longo prazo) para personalizar e não repetir perguntas.
    const memory = await loadMemory(companyId, ticketId, contactId);
    const memoryLine = formatMemoryForPrompt(memory);

    // Origem Click-to-WhatsApp: se a conversa veio de um anúncio, dá esse
    // contexto ao agente (ele pode personalizar a abordagem pelo anúncio).
    let ctwaLine = "";
    try {
      const ref = await getReferralForTicket(ticketId);
      if (ref) {
        ctwaLine = `Este cliente chegou por um anúncio (Click-to-WhatsApp): "${
          ref.headline || ref.sourceId || "anúncio"
        }". Leve isso em conta na abordagem.`;
      }
    } catch (e) {
      // best-effort
    }

    // Histórico (com corte de continuidade se o cliente sumiu por vários dias).
    const resetDays =
      agent.conversationResetDays === undefined ||
      agent.conversationResetDays === null
        ? 0
        : Number(agent.conversationResetDays);
    const convo = await buildConversation(
      ticketId,
      companyId,
      resetDays,
      reactivated
    );
    const messages = convo.messages;
    if (!messages.length) return;

    // Data/hora atual, para o agente interpretar "ontem", "semana passada" etc.
    const dateLine = `Data e hora atuais: ${nowInTimezone()} (horário de Brasília). Use isto como "hoje" ao interpretar o cliente (ex.: "ontem", "semana passada") — nunca assuma que ainda é a data da última conversa.`;

    // Retomada após intervalo longo: recomeçar o assunto sem citar o passado.
    const resumoLine = convo.resetApplied
      ? `O último contato deste cliente foi há cerca de ${convo.gapDays} dia(s). Comece como um novo atendimento: cumprimente de novo e puxe o assunto do zero. NÃO cite a conversa anterior nem retome pendências antigas a menos que o próprio cliente traga. Você ainda conhece as preferências dele pela memória — use só quando fizer sentido natural.`
      : "";

    const systemPrompt = [
      agent.systemPrompt || "",
      "",
      `Contexto do atendimento: você está conversando com ${
        contactName || "um cliente"
      }${contactNumber ? ` (${contactNumber})` : ""} pelo WhatsApp.`,
      dateLine,
      ctwaLine,
      resumoLine,
      memoryLine,
      formatCampaigns(agent.campaigns),
      "REGRAS FIXAS:",
      "• SEMPRE responda ao cliente em texto no mesmo turno — nunca termine só chamando ferramentas.",
      "• Seja objetivo e econômico: 2 a 4 frases curtas, uma pergunta por vez, sem repetir o que já foi dito (cada mensagem tem custo).",
      "• Modelos/preço/ano/km/cores: consulte consultar_estoque ANTES e responda só com o retorno dela; nunca invente.",
      "• 0km (carros novos): trabalhamos SOMENTE com Volkswagen. Seminovos/usados: a Francauto vende MULTIMARCAS — fique aberto a qualquer marca, não empurre VW no usado.",
      "• Memória (anotar_memoria): no máximo uma anotação curta por resposta, só de fato novo e útil, e ainda assim responda ao cliente no mesmo turno.",
      "• Transfira para um humano quando o cliente agendar visita, quiser negociar/fechar, pedir uma pessoa, ou quando você não puder resolver.",
      "• Responda em português do Brasil."
    ]
      .filter(Boolean)
      .join("\n");

    const guardrails = normalizeGuardrails(agent.guardrails);
    const tools = buildAnthropicTools(agent.tools || []);
    const ctx: AgentToolContext = {
      companyId,
      ticketId,
      contactId,
      contactName,
      contactNumber,
      transferQueueId: agent.transferQueueId || null
    };

    // Discernimento de handoff (rede de segurança em código): se a conversa
    // travou — agente repetindo respostas ou cliente implorando desconto além
    // do limite — passa para um humano em vez de insistir. Sem chamar o modelo.
    const stuck = detectStuck(
      messages,
      Number(agent.repeatTransferThreshold) || 0
    );
    if (stuck.stuck) {
      await transferTicketToHuman({
        companyId,
        ticketId,
        transferQueueId: agent.transferQueueId || null,
        motivo: stuck.reason
      });
      transferred = true;
      finalText =
        "Pra te atender melhor, vou te passar para um vendedor que cuida pessoalmente das condições, tá? Já já alguém fala com você. 😊";
      toolCalls.push({
        name: "handoff_repeticao",
        status: "transfer",
        reason: stuck.reason
      });
      logger.info(
        `[Agente IA] handoff por repetição/insistência ticket=${ticketId}: ${stuck.reason}`
      );
    }

    const maxSteps = agent.maxToolSteps || 5;

    // Controle de uso de ferramentas no turno:
    //  - externalCalls: só http/webhook/estoque contam para o guardrail (memória
    //    e transferência são internas e não devem estourar o limite).
    //  - memória: no máximo MEMORY_MAX_PER_TURN anotações e sem repetir a mesma,
    //    para o agente parar de "só anotar" e RESPONDER ao cliente.
    const MEMORY_MAX_PER_TURN = 2;
    let externalCalls = 0;
    let memoryCalls = 0;
    const memoryWritten = new Set<string>();

    // Só roda o laço do modelo se não transferimos por repetição acima.
    if (!transferred)
      for (let step = 0; step <= maxSteps; step += 1) {
      steps += 1;
      // eslint-disable-next-line no-await-in-loop
      const resp = await callMessages({
        apiKey: agent.apiKey,
        model: agent.model,
        maxTokens: agent.maxTokens,
        temperature: Number(agent.temperature),
        system: systemPrompt,
        messages,
        tools,
        workspaceId: agent.anthropicWorkspaceId || undefined
      });

      inputTokens += Number(resp.raw?.usage?.input_tokens || 0);
      outputTokens += Number(resp.raw?.usage?.output_tokens || 0);
      lastStopReason = resp.stopReason || lastStopReason;

      const toolUses = extractToolUses(resp.content);

      if (resp.stopReason === "tool_use" && toolUses.length) {
        logger.info(
          `[Agente IA] ticket=${ticketId} passo ${step}: modelo pediu ${
            toolUses.length
          } ferramenta(s): ${toolUses.map(t => t.name).join(", ")}`
        );
        // Registra a vez do assistente (com os pedidos de ferramenta).
        messages.push({ role: "assistant", content: resp.content });

        const toolResults: any[] = [];
        // eslint-disable-next-line no-restricted-syntax
        for (const tu of toolUses) {
          const def = findToolDef(agent.tools, tu.name);
          const isMemory = tu.name === MEMORY_TOOL_NAME;
          const isExternal = !!def || tu.name === ESTOQUE_TOOL_NAME;

          // Memória: limita quantidade por turno e evita repetição — assim o
          // modelo não gasta o turno "só anotando" e volta a responder.
          if (isMemory) {
            const sig = `${tu.input?.chave}=${tu.input?.valor}`;
            if (memoryCalls >= MEMORY_MAX_PER_TURN || memoryWritten.has(sig)) {
              toolResults.push({
                type: "tool_result",
                tool_use_id: tu.id,
                content:
                  "Memória suficiente por agora — PARE de anotar e responda ao cliente em texto neste turno."
              });
              // eslint-disable-next-line no-continue
              continue;
            }
            memoryWritten.add(sig);
            memoryCalls += 1;
          }

          // GUARDRAIL determinístico ANTES de executar — só ferramentas
          // externas (http/webhook/estoque) contam para o limite por turno.
          const decision = checkToolCall({
            cfg: guardrails,
            toolName: tu.name,
            input: tu.input,
            toolDef: def,
            callsSoFar: isExternal ? externalCalls : 0
          });

          if (!decision.allowed) {
            if (decision.event) guardrailEvents.push(decision.event);
            toolCalls.push({
              name: tu.name,
              status: "blocked",
              blocked: true,
              isError: true,
              reason: decision.reason
            });
            toolResults.push({
              type: "tool_result",
              tool_use_id: tu.id,
              content: `Ação bloqueada por política de segurança: ${decision.reason} Explique ao cliente de forma educada ou transfira para um humano.`,
              is_error: true
            });
            // eslint-disable-next-line no-continue
            continue;
          }

          if (isExternal) externalCalls += 1;

          const startedAt = Date.now();
          // eslint-disable-next-line no-await-in-loop
          const result = await executeTool(tu.name, tu.input, agent.tools, ctx);
          const ms = Date.now() - startedAt;
          if (result.transferred) transferred = true;

          toolCalls.push({
            name: tu.name,
            status: result.transferred
              ? "transfer"
              : result.isError
              ? "error"
              : "ok",
            ms,
            isError: !!result.isError
          });

          // Auditoria (com máscara de PII quando ligada).
          const auditInput = guardrails.maskPii
            ? maskPiiInput(tu.input)
            : tu.input;
          logger.info(
            `[Agente IA][auditoria] ticket=${ticketId} ferramenta=${tu.name} input=${JSON.stringify(
              auditInput
            ).slice(0, 500)} status=${result.isError ? "erro" : "ok"}`
          );

          toolResults.push({
            type: "tool_result",
            tool_use_id: tu.id,
            content: result.content,
            ...(result.isError ? { is_error: true } : {})
          });
        }
        messages.push({ role: "user", content: toolResults });
        if (transferred) {
          // Transferiu no meio das ferramentas: não precisa continuar o loop.
          finalText =
            extractText(resp.content) ||
            "Perfeito! Já estou te passando para um vendedor dar sequência. 😊";
          break;
        }
        // continua o loop para o modelo concluir com base nos resultados
      } else {
        finalText = extractText(resp.content);
        break;
      }
    }

    // Rede de segurança: se o loop acabou sem texto (ex.: estourou passos ou o
    // modelo só chamou ferramentas), faz até 2 chamadas finais SEM ferramentas,
    // instruindo a responder em texto — assim o cliente nunca fica sem resposta.
    for (let tryN = 0; !finalText && !transferred && tryN < 2; tryN += 1) {
      try {
        steps += 1;
        const closing = await callMessages({
          apiKey: agent.apiKey,
          model: agent.model,
          maxTokens: agent.maxTokens,
          temperature: Number(agent.temperature),
          system: `${systemPrompt}\n\nIMPORTANTE: responda AGORA ao cliente em português, de forma curta e útil. NÃO chame ferramentas.`,
          messages,
          workspaceId: agent.anthropicWorkspaceId || undefined
        });
        inputTokens += Number(closing.raw?.usage?.input_tokens || 0);
        outputTokens += Number(closing.raw?.usage?.output_tokens || 0);
        lastStopReason = closing.stopReason || lastStopReason;
        finalText = extractText(closing.content);
      } catch (e) {
        describeAnthropicError(e);
        break;
      }
    }

    // Último recurso: se, mesmo após as tentativas acima, ainda não há texto e
    // não transferimos, o cliente NÃO pode ficar no vácuo. Manda uma saudação
    // curta e segura para reabrir a conversa (acontece sobretudo logo após uma
    // reativação, quando o modelo ainda tenta "encerrar" o assunto antigo).
    if (!finalText && !transferred) {
      finalText = reactivated
        ? "Oi! Voltei por aqui 😊 Em que posso te ajudar com os nossos veículos?"
        : "Oi! Como posso te ajudar? 😊";
      logger.info(
        `[Agente IA] texto final vazio — usando resposta de segurança (ticket=${ticketId}, reativado=${reactivated}).`
      );
    }

    if (finalText) {
      await SendWhatsAppMessage({ body: finalText, ticket: fullTicket });
      logger.info(
        `[Agente IA] resposta enviada (ticket=${ticketId}, agente=${agent.id}, transferido=${transferred}, freshStart=${convo.freshStartApplied}).`
      );
    } else {
      logger.info(
        `[Agente IA] sem texto final para enviar (ticket=${ticketId}).`
      );
    }

    // Monitor de inatividade: se o agente respondeu e NÃO transferiu, agenda a
    // passagem para um humano caso o cliente fique X min sem responder. Se
    // transferiu, cancela qualquer verificação pendente.
    if (transferred) {
      await cancelInactivityCheck(ticketId);
    } else if (finalText && Number(agent.inactivityTimeoutMinutes) > 0) {
      await scheduleInactivityCheck(
        ticketId,
        companyId,
        Number(agent.inactivityTimeoutMinutes),
        agent.transferQueueId || null
      );
    }

    traceStatus = transferred ? "transferred" : "ok";
  } catch (err: any) {
    traceStatus = "error";
    traceError = describeAnthropicError(err);
  } finally {
    runningTickets.delete(ticketId);

    // Grava o trace do turno (raio-x) — best-effort.
    if (shouldTrace) {
      await recordTrace({
        companyId,
        ticketId,
        agentId: traceAgentId,
        model: traceModel,
        inputTokens,
        outputTokens,
        latencyMs: Date.now() - turnStart,
        steps,
        toolCalls,
        guardrailEvents,
        stopReason: lastStopReason,
        status: traceStatus,
        finalText,
        error: traceError
      });
    }
  }
}

export default handleAgentReply;
