import { Op } from "sequelize";
import AgentMemory from "../../models/AgentMemory";
import { logger } from "../../utils/logger";

/**
 * Memória do agente (estilo ADK):
 *  - "session": estado desta conversa (por ticket).
 *  - "contact": memória de longo prazo do cliente (por contato), reaproveitada
 *     entre conversas.
 *
 * Tudo é best-effort: uma falha de memória NUNCA quebra o atendimento.
 */

export const MEMORY_SCOPE_SESSION = "session";
export const MEMORY_SCOPE_CONTACT = "contact";

// Limites para não deixar a memória (e o prompt) crescer sem controle.
const MAX_KEYS_PER_SCOPE = 40;
const MAX_VALUE_CHARS = 600;
const MAX_KEY_CHARS = 60;

export interface LoadedMemory {
  session: Record<string, string>;
  contact: Record<string, string>;
}

const normKey = (k: string): string =>
  (k || "")
    .toString()
    .trim()
    .slice(0, MAX_KEY_CHARS);

/** Carrega a memória de sessão (ticket) e de longo prazo (contato). */
export async function loadMemory(
  companyId: number,
  ticketId: number,
  contactId: number | null
): Promise<LoadedMemory> {
  const out: LoadedMemory = { session: {}, contact: {} };
  try {
    const rows = await AgentMemory.findAll({
      where: {
        companyId,
        [Op.or]: [
          { scope: MEMORY_SCOPE_SESSION, ticketId },
          ...(contactId
            ? [{ scope: MEMORY_SCOPE_CONTACT, contactId }]
            : [])
        ]
      },
      order: [["updatedAt", "ASC"]]
    });

    rows.forEach(r => {
      if (r.scope === MEMORY_SCOPE_CONTACT) {
        out.contact[r.key] = r.value || "";
      } else {
        out.session[r.key] = r.value || "";
      }
    });
  } catch (err: any) {
    logger.error(`[Agente IA] falha ao carregar memória: ${err?.message}`);
  }
  return out;
}

/**
 * Grava (upsert) um fato na memória. scope decide se é da conversa (ticket) ou
 * de longo prazo (contato). Sobrescreve a mesma chave. Respeita um teto de
 * chaves por escopo para não inflar.
 */
export async function saveMemory(params: {
  companyId: number;
  ticketId: number;
  contactId: number | null;
  scope: string;
  key: string;
  value: string;
}): Promise<boolean> {
  const scope =
    params.scope === MEMORY_SCOPE_CONTACT
      ? MEMORY_SCOPE_CONTACT
      : MEMORY_SCOPE_SESSION;
  const key = normKey(params.key);
  if (!key) return false;
  const value = (params.value || "").toString().slice(0, MAX_VALUE_CHARS);

  // Memória de contato exige contactId; sem ele, grava como sessão.
  const effectiveScope =
    scope === MEMORY_SCOPE_CONTACT && !params.contactId
      ? MEMORY_SCOPE_SESSION
      : scope;

  try {
    const where =
      effectiveScope === MEMORY_SCOPE_CONTACT
        ? {
            companyId: params.companyId,
            scope: MEMORY_SCOPE_CONTACT,
            contactId: params.contactId,
            key
          }
        : {
            companyId: params.companyId,
            scope: MEMORY_SCOPE_SESSION,
            ticketId: params.ticketId,
            key
          };

    const existing = await AgentMemory.findOne({ where });
    if (existing) {
      await existing.update({ value });
      return true;
    }

    // Teto por escopo: evita memória infinita (remove as mais antigas).
    const countWhere =
      effectiveScope === MEMORY_SCOPE_CONTACT
        ? {
            companyId: params.companyId,
            scope: MEMORY_SCOPE_CONTACT,
            contactId: params.contactId
          }
        : {
            companyId: params.companyId,
            scope: MEMORY_SCOPE_SESSION,
            ticketId: params.ticketId
          };
    const count = await AgentMemory.count({ where: countWhere });
    if (count >= MAX_KEYS_PER_SCOPE) {
      const oldest = await AgentMemory.findOne({
        where: countWhere,
        order: [["updatedAt", "ASC"]]
      });
      if (oldest) await oldest.destroy();
    }

    await AgentMemory.create({
      companyId: params.companyId,
      scope: effectiveScope,
      contactId:
        effectiveScope === MEMORY_SCOPE_CONTACT ? params.contactId : null,
      ticketId:
        effectiveScope === MEMORY_SCOPE_SESSION ? params.ticketId : null,
      key,
      value
    } as any);
    return true;
  } catch (err: any) {
    logger.error(`[Agente IA] falha ao gravar memória: ${err?.message}`);
    return false;
  }
}

/** Monta um texto compacto da memória para injetar no system prompt. */
export function formatMemoryForPrompt(mem: LoadedMemory): string {
  const contactKeys = Object.keys(mem.contact || {});
  const sessionKeys = Object.keys(mem.session || {});
  if (!contactKeys.length && !sessionKeys.length) return "";

  const lines: string[] = ["Memória do atendimento (use para personalizar e não repetir perguntas):"];
  if (contactKeys.length) {
    lines.push("- Sobre o cliente (histórico):");
    contactKeys.forEach(k => lines.push(`  • ${k}: ${mem.contact[k]}`));
  }
  if (sessionKeys.length) {
    lines.push("- Nesta conversa:");
    sessionKeys.forEach(k => lines.push(`  • ${k}: ${mem.session[k]}`));
  }
  return lines.join("\n");
}

/** Remove toda a memória de sessão de um ticket (ex.: ao reabrir/encerrar). */
export async function clearSessionMemory(
  companyId: number,
  ticketId: number
): Promise<void> {
  try {
    await AgentMemory.destroy({
      where: { companyId, scope: MEMORY_SCOPE_SESSION, ticketId }
    });
  } catch (err: any) {
    logger.error(`[Agente IA] falha ao limpar memória de sessão: ${err?.message}`);
  }
}
