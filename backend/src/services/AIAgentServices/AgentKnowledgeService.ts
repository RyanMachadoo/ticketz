import { QueryTypes } from "sequelize";
import sequelize from "../../database";
import AgentKnowledgeDoc from "../../models/AgentKnowledgeDoc";
import AgentKnowledgeChunk from "../../models/AgentKnowledgeChunk";
import { logger } from "../../utils/logger";

const CHUNK_SIZE = Number(process.env.KNOWLEDGE_CHUNK_SIZE || 900);
const CHUNK_OVERLAP = Number(process.env.KNOWLEDGE_CHUNK_OVERLAP || 120);

/**
 * Quebra um texto em trechos de ~CHUNK_SIZE caracteres, respeitando parágrafos
 * quando possível e com uma pequena sobreposição (overlap) para não cortar
 * contexto entre trechos.
 */
export function splitIntoChunks(text: string): string[] {
  const clean = String(text || "").replace(/\r\n/g, "\n").trim();
  if (!clean) return [];
  const paras = clean.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);

  const chunks: string[] = [];
  let buf = "";
  const flush = () => {
    if (buf.trim()) chunks.push(buf.trim());
    buf = "";
  };

  for (const para of paras) {
    if (para.length > CHUNK_SIZE) {
      // Parágrafo gigante: corta por frases.
      flush();
      const sentences = para.split(/(?<=[.!?])\s+/);
      let sbuf = "";
      for (const s of sentences) {
        if ((sbuf + " " + s).length > CHUNK_SIZE) {
          if (sbuf.trim()) chunks.push(sbuf.trim());
          sbuf = s;
        } else {
          sbuf = sbuf ? `${sbuf} ${s}` : s;
        }
      }
      if (sbuf.trim()) chunks.push(sbuf.trim());
      continue;
    }
    if ((buf + "\n\n" + para).length > CHUNK_SIZE) {
      flush();
      buf = para;
    } else {
      buf = buf ? `${buf}\n\n${para}` : para;
    }
  }
  flush();

  // Overlap: prefixa cada trecho com o fim do anterior (contexto).
  if (CHUNK_OVERLAP > 0 && chunks.length > 1) {
    for (let i = 1; i < chunks.length; i += 1) {
      const prev = chunks[i - 1];
      const tail = prev.slice(Math.max(0, prev.length - CHUNK_OVERLAP));
      chunks[i] = `${tail} ${chunks[i]}`.trim();
    }
  }
  return chunks;
}

/** Ingere um documento de texto na base de um agente. */
export async function ingestDocument(params: {
  companyId: number;
  agentId: number;
  title: string;
  filename?: string;
  text: string;
  source?: string;
}): Promise<AgentKnowledgeDoc> {
  const { companyId, agentId, title, filename, text, source } = params;
  const chunks = splitIntoChunks(text);

  return sequelize.transaction(async t => {
    const doc = await AgentKnowledgeDoc.create(
      {
        companyId,
        agentId,
        title: title || filename || "Documento",
        filename: filename || null,
        source: source || "upload",
        charCount: String(text || "").length,
        chunkCount: chunks.length
      } as any,
      { transaction: t }
    );

    for (let i = 0; i < chunks.length; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await AgentKnowledgeChunk.create(
        {
          companyId,
          agentId,
          docId: doc.id,
          ord: i,
          content: chunks[i]
        } as any,
        { transaction: t }
      );
    }

    logger.info(
      `[Conhecimento] documento '${doc.title}' ingerido no agente ${agentId}: ${chunks.length} trechos.`
    );
    return doc;
  });
}

/** Quantos trechos o agente tem (para habilitar a ferramenta de consulta). */
export async function countChunks(
  companyId: number,
  agentId: number
): Promise<number> {
  return AgentKnowledgeChunk.count({ where: { companyId, agentId } });
}

export interface KnowledgeHit {
  content: string;
  rank: number;
}

/** Executa a busca com uma expressão tsquery (montada no SQL a partir de :q). */
async function runSearch(
  tsqueryExpr: string,
  q: string,
  companyId: number,
  agentId: number,
  k: number
): Promise<KnowledgeHit[]> {
  const rows: any[] = await sequelize.query(
    `SELECT "content", ts_rank("tsv", ${tsqueryExpr}) AS rank
       FROM "AgentKnowledgeChunks"
      WHERE "companyId" = :companyId
        AND "agentId" = :agentId
        AND "tsv" @@ ${tsqueryExpr}
      ORDER BY rank DESC
      LIMIT :k`,
    {
      replacements: { q, companyId, agentId, k },
      type: QueryTypes.SELECT
    }
  );
  return rows.map(r => ({ content: r.content, rank: Number(r.rank) }));
}

/**
 * Busca full-text (Postgres, português) os trechos mais relevantes da base do
 * agente para uma pergunta, em duas etapas:
 *  1) TODAS as palavras no mesmo trecho (plainto_tsquery) — mais precisa;
 *  2) se nada vier, QUALQUER uma das palavras (websearch_to_tsquery com "or"),
 *     ordenando pela relevância — evita "nada encontrado" só porque a pergunta
 *     usou uma palavra que não está no texto (ex.: "necessários").
 * As duas funções do Postgres nunca dão erro de sintaxe com texto livre.
 */
export async function searchKnowledge(
  companyId: number,
  agentId: number,
  query: string,
  k = 4
): Promise<KnowledgeHit[]> {
  const q = String(query || "").trim();
  if (!q) return [];
  try {
    const exact = await runSearch(
      "plainto_tsquery('portuguese', :q)",
      q,
      companyId,
      agentId,
      k
    );
    if (exact.length) return exact;

    // Fallback: palavras com 3+ letras, unidas por "or".
    const words = q
      .toLowerCase()
      .split(/[^a-zà-ÿ0-9]+/i)
      .filter(w => w.length >= 3)
      .slice(0, 10);
    if (!words.length) return [];
    return await runSearch(
      "websearch_to_tsquery('portuguese', :q)",
      words.join(" or "),
      companyId,
      agentId,
      k
    );
  } catch (err: any) {
    logger.error(`[Conhecimento] falha na busca (agente ${agentId}): ${err?.message}`);
    return [];
  }
}

/** Lista os documentos da base de um agente. */
export async function listDocs(
  companyId: number,
  agentId: number
): Promise<AgentKnowledgeDoc[]> {
  return AgentKnowledgeDoc.findAll({
    where: { companyId, agentId },
    order: [["id", "DESC"]]
  });
}

/** Remove um documento e seus trechos. */
export async function deleteDoc(
  companyId: number,
  agentId: number,
  docId: number
): Promise<boolean> {
  const doc = await AgentKnowledgeDoc.findOne({
    where: { id: docId, companyId, agentId }
  });
  if (!doc) return false;
  await AgentKnowledgeChunk.destroy({ where: { docId: doc.id } });
  await doc.destroy();
  return true;
}
