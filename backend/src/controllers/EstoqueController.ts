import { Request, Response } from "express";
import { consultarEstoque } from "../services/EstoqueServices/EstoqueService";

/**
 * Endpoints de consulta de estoque (0km/usados) — mesma fonte usada pela
 * ferramenta nativa do agente de IA. Úteis para teste e para o frontend.
 * A fonte (site) vem de env (ESTOQUE_BASE_URL/ESTOQUE_PATH) ou dos query params.
 */

const buildFiltro = (req: Request) => {
  const q = req.query as any;
  return {
    tipo: q.tipo,
    modelo: q.modelo,
    precoMax: q.precoMax ? Number(q.precoMax) : undefined,
    precoMin: q.precoMin ? Number(q.precoMin) : undefined,
    anoMin: q.anoMin ? Number(q.anoMin) : undefined,
    cambio: q.cambio,
    combustivel: q.combustivel
  };
};

const buildCfg = (req: Request) => {
  const q = req.query as any;
  return {
    baseUrl: q.baseUrl,
    path: q.path,
    limit: q.limit ? Number(q.limit) : 30
  };
};

export const index = async (req: Request, res: Response): Promise<Response> => {
  const data = await consultarEstoque(buildCfg(req), buildFiltro(req));
  return res.status(200).json(data);
};

export const novos = async (req: Request, res: Response): Promise<Response> => {
  const data = await consultarEstoque(buildCfg(req), {
    ...buildFiltro(req),
    tipo: "novos"
  });
  return res.status(200).json(data);
};

export const usados = async (req: Request, res: Response): Promise<Response> => {
  const data = await consultarEstoque(buildCfg(req), {
    ...buildFiltro(req),
    tipo: "usados"
  });
  return res.status(200).json(data);
};
