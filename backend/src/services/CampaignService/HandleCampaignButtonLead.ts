import { GetCompanySetting } from "../../helpers/CheckSettings";
import { transferTicketToHuman } from "../AIAgentServices/AgentToolRunner";
import {
  resolveSellerAgent,
  activeSellersOf
} from "../AIAgentServices/AgentSellerService";
import Whatsapp from "../../models/Whatsapp";
import AIAgent from "../../models/AIAgent";
import { logger } from "../../utils/logger";

/**
 * Lead de CAMPANHA via botão de resposta rápida.
 *
 * Quando o cliente toca num botão de um template de campanha (ex.: "Quero
 * agendar test drive"), esse toque chega como uma mensagem de entrada com o
 * texto do botão. O lead vai DIRETO para o rodízio de vendedores: o vendedor
 * da vez recebe o contexto no WhatsApp dele (via conexão Baileys de aviso) e
 * trata o cliente fora da plataforma. O ticket vai para a fila humana
 * (pending) para ficar registrado.
 *
 * Gatilho (configuração "campaignSellerButtons" da empresa):
 *   - Toque em BOTÃO: lista VAZIA => qualquer botão dispara ("funciona de
 *     cara"); lista PREENCHIDA => só os botões listados disparam.
 *   - Mensagem de TEXTO (quando o proxy entrega o toque como texto): só dispara
 *     se o texto bater com um gatilho configurado (evita tratar toda frase do
 *     cliente como lead). Portanto, para o caso "chega como texto", é PRECISO
 *     preencher a lista com os rótulos dos botões.
 *
 * Tudo best-effort e com log em cada ponto de decisão.
 */

const stripAccents = (s: string): string =>
  (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "");
const norm = (s: string): string =>
  stripAccents(String(s || "")).toLowerCase().trim();

export async function handleCampaignButtonLead(params: {
  companyId: number;
  ticketId: number;
  buttonText: string;
  whatsappId?: number; // conexão onde a resposta chegou (aponta pro agente do rodízio)
  isButton?: boolean; // true = toque em botão; false = mensagem de texto
}): Promise<boolean> {
  const { companyId, ticketId, whatsappId } = params;
  const isButton = params.isButton !== false; // compat: default = botão
  const btn = String(params.buttonText || "").trim();
  if (!btn) {
    logger.info(
      `[Campanha][rodízio] IGNORADO (ticket=${ticketId}): texto do botão vazio.`
    );
    return false;
  }

  try {
    const raw = await GetCompanySetting(companyId, "campaignSellerButtons", "");
    const triggers = String(raw || "")
      .split(/[,;\n]/)
      .map(norm)
      .filter(Boolean);
    const matched = triggers.includes(norm(btn));

    logger.info(
      `[Campanha][rodízio] AVALIANDO (ticket=${ticketId}) isButton=${isButton} texto="${btn}" gatilhosConfigurados=[${triggers.join(
        "; "
      )}] bateu=${matched}`
    );

    if (isButton) {
      // Botão: lista vazia dispara qualquer um; preenchida, só os listados.
      if (triggers.length && !matched) {
        logger.info(
          `[Campanha][rodízio] IGNORADO (ticket=${ticketId}): botão "${btn}" não está na lista de gatilhos.`
        );
        return false;
      }
    } else if (!matched) {
      // Texto puro: só dispara se bater um gatilho configurado.
      logger.info(
        `[Campanha][rodízio] IGNORADO (ticket=${ticketId}): chegou como TEXTO e "${btn}" não bate com nenhum gatilho configurado. Preencha "campaignSellerButtons" com os rótulos dos botões.`
      );
      return false;
    }

    // Pool de vendedores: 1) o da CONEXÃO onde a resposta chegou (roteamento
    // atual); senão 2) o de um agente (rodizioAgentId da conexão ou o 1º agente
    // com vendedores). O agente é opcional quando a conexão já tem vendedores.
    const connection = whatsappId ? await Whatsapp.findByPk(whatsappId) : null;
    const connSellers = activeSellersOf(connection).length;

    let agent: AIAgent | null = null;
    let origem = "auto";
    if (connection?.rodizioAgentId) {
      agent = await AIAgent.findByPk(connection.rodizioAgentId);
      if (agent) origem = `conexão(${whatsappId})->agente ${agent.id}`;
    }
    if (!agent && !connSellers) {
      agent = await resolveSellerAgent(companyId);
      if (agent) origem = `auto->agente ${agent.id}`;
    }

    const agentSellers = agent ? activeSellersOf(agent).length : 0;
    const nSellers = connSellers || agentSellers;
    const fonte = connSellers
      ? `conexão ${whatsappId}`
      : agent
      ? `agente ${agent.id}`
      : "nenhuma";

    logger.info(
      `[Campanha][rodízio] botão "${btn}" (ticket=${ticketId}) -> pool=${fonte} (${origem}), vendedores ativos=${nSellers}.`
    );
    if (!nSellers) {
      logger.warn(
        `[Campanha][rodízio] SEM vendedores ativos (ticket=${ticketId}, conexão=${whatsappId}). Cadastre os vendedores na conexão (Roteamento) e marque-os como ativos.`
      );
      return false;
    }

    const transferQueueId = agent?.transferQueueId || null;

    const result = await transferTicketToHuman({
      companyId,
      ticketId,
      transferQueueId,
      agentId: agent?.id || null,
      motivo: `Lead de campanha — o cliente tocou em "${btn}".`
    });

    if (result?.seller) {
      logger.info(
        `[Campanha][rodízio] lead por botão "${btn}" (ticket=${ticketId}) ENVIADO ao vendedor ${result.seller.sellerName}.`
      );
    } else {
      logger.warn(
        `[Campanha][rodízio] lead por botão "${btn}" (ticket=${ticketId}) NÃO enviado — verifique a conexão de aviso (Baileys) e os números dos vendedores.`
      );
    }
    return !!result?.seller;
  } catch (err: any) {
    logger.error(
      `[Campanha][rodízio] falha ao tratar lead por botão (ticket=${ticketId}): ${err?.message}`
    );
    return false;
  }
}

export default handleCampaignButtonLead;
