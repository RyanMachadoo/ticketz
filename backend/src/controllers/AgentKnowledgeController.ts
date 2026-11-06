import { Request, Response } from "express";
import fs from "fs";
import path from "path";
import AppError from "../errors/AppError";
import AIAgent from "../models/AIAgent";
import {
  ingestDocument,
  listDocs,
  deleteDoc
} from "../services/AIAgentServices/AgentKnowledgeService";
import { logger } from "../utils/logger";

const ALLOWED = [".txt", ".md", ".markdown", ".csv"];

async function getAgent(id: string, companyId: number): Promise<AIAgent> {
  const agent = await AIAgent.findByPk(id);
  if (!agent || agent.companyId !== companyId) {
    throw new AppError("agente não encontrado", 404);
  }
  return agent;
}

/** GET /ai-agents/:id/knowledge — lista os documentos da base do agente. */
export const index = async (req: Request, res: Response): Promise<Response> => {
  const { companyId } = req.user as any;
  const { id } = req.params;
  await getAgent(id, companyId);
  const docs = await listDocs(companyId, Number(id));
  return res.status(200).json(docs);
};

/**
 * POST /ai-agents/:id/knowledge — sobe um ou mais arquivos .txt/.md e ingere
 * o texto na base do agente (quebra em trechos). Admin apenas.
 */
export const upload = async (req: Request, res: Response): Promise<Response> => {
  const { companyId, profile } = req.user as any;
  if (profile !== "admin") {
    throw new AppError("acesso restrito a administradores", 403);
  }
  const { id } = req.params;
  await getAgent(id, companyId);

  const files = (req.files as Express.Multer.File[]) || [];
  if (!files.length) {
    throw new AppError("envie ao menos um arquivo .txt ou .md", 400);
  }

  const created: any[] = [];
  for (const file of files) {
    const ext = path.extname(file.originalname || "").toLowerCase();
    try {
      if (!ALLOWED.includes(ext)) {
        logger.warn(
          `[Conhecimento] arquivo ignorado (extensão ${ext}): ${file.originalname}`
        );
        // eslint-disable-next-line no-continue
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      const text = fs.readFileSync(file.path, "utf8");
      // eslint-disable-next-line no-await-in-loop
      const doc = await ingestDocument({
        companyId,
        agentId: Number(id),
        title: file.originalname,
        filename: file.originalname,
        text,
        source: "upload"
      });
      created.push(doc);
    } catch (err: any) {
      logger.error(
        `[Conhecimento] falha ao ingerir ${file.originalname}: ${err?.message}`
      );
    } finally {
      // remove o arquivo temporário
      try {
        fs.unlinkSync(file.path);
      } catch (e) {
        /* ignore */
      }
    }
  }

  if (!created.length) {
    throw new AppError(
      "nenhum arquivo válido (.txt/.md/.csv) foi ingerido",
      400
    );
  }

  return res.status(200).json(created);
};

/** DELETE /ai-agents/:id/knowledge/:docId — remove um documento e seus trechos. */
export const remove = async (req: Request, res: Response): Promise<Response> => {
  const { companyId, profile } = req.user as any;
  if (profile !== "admin") {
    throw new AppError("acesso restrito a administradores", 403);
  }
  const { id, docId } = req.params;
  await getAgent(id, companyId);
  const ok = await deleteDoc(companyId, Number(id), Number(docId));
  if (!ok) throw new AppError("documento não encontrado", 404);
  return res.status(200).json({ ok: true });
};
