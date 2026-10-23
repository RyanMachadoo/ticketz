import { GetCompanySetting } from "../../helpers/CheckSettings";
import { transferTicketToHuman } from "../AIAgentServices/AgentToolRunner";
import { resolveSellerAgent } from "../AIAgentServices/AgentSellerService";
import { logger } from "../../utils/logger";

/**
 * Lead de CAMPANHA via botão de resposta rápida.
 *
 * Quando o cliente toca num botão de um template de campanha (ex.: "Tenho
 * interesse"), esse toque chega como uma mensagem de entrada com o texto do
 * botão. Se esse texto estiver na lista de gatilhos da empresa (configuração
 * "campaignSellerButtons"), o lead vai DIRETO para o rodízio de vendedores: o
 * vendedor da vez recebe o contexto no WhatsApp dele e trata o cliente fora da
 * plataforma. O ticket vai para a fila humana (pending) para ficar registrado.
 *
 * Recurso OPT-IN: se a configuração estiver vazia, nada acontece (não
 * sequestra fluxos interativos normais). Tudo best-effort.
 */

const stripAccents = (s: string): string =>
  (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "");
const norm = (s: string): string =>
  stripAccents(String(s || "")).toLowerCase().trim();

export async function handleCampaignButtonLead(params: {
  companyId: number;
  ticketId: number;
  buttonText: string;
}): Promise<boolean> {
  const { companyId, ticketId } = params;
  const btn = String(params.buttonText || "").trim();
  if (!btn) return false;

  try {
    const raw = await GetCompanySetting(companyId, "campaignSellerButtons", "");
    if (!raw || !String(raw).trim()) return false; // recurso desligado

    const triggers = String(raw)
      .split(/[,;\n]/)
      .map(norm)
      .filter(Boolean);
    if (!triggers.includes(norm(btn))) return false; // botão não é de interesse

    // Agente com rodízio de vendedores (para pegar a fila de destino).
    const agent = await resolveSellerAgent(companyId);
    const transferQueueId = agent?.transferQueueId || null;

    const result = await transferTicketToHuman({
      companyId,
      ticketId,
      transferQueueId,
      motivo: `Lead de campanha — o cliente tocou em "${btn}".`
    });

    logger.info(
      `[Campanha][rodízio] lead por botão "${btn}" (ticket=${ticketId}) -> vendedor: ${
        result?.seller?.sellerName || "nenhum"
      }.`
    );
    return !!result?.seller;
  } catch (err: any) {
    logger.error(
      `[Campanha][rodízio] falha ao tratar lead por botão (ticket=${ticketId}): ${err?.message}`
    );
    return false;
  }
}

export default handleCampaignButtonLead;
