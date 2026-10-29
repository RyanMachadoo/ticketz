import { Request, Response, NextFunction } from "express";
import AppError from "../errors/AppError";

/**
 * Autenticação do endpoint de gatilho das automações. O API interno do Ryan
 * envia `Authorization: Bearer <AUTOMATION_API_TOKEN>`. A empresa alvo vem de
 * AUTOMATION_COMPANY_ID (padrão 1) e é anexada em req.automationCompanyId.
 *
 * Config (variáveis de ambiente):
 *   AUTOMATION_API_TOKEN   -> token secreto (obrigatório)
 *   AUTOMATION_COMPANY_ID  -> empresa das automações (padrão 1)
 */
const automationAuth = (
  req: Request,
  _res: Response,
  next: NextFunction
): void => {
  const configured = process.env.AUTOMATION_API_TOKEN;
  if (!configured) {
    throw new AppError("AUTOMATION_API_TOKEN não configurado no servidor", 500);
  }

  const header = req.headers.authorization || "";
  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token || token !== configured) {
    throw new AppError("não autorizado", 401);
  }

  (req as any).automationCompanyId = Number(
    process.env.AUTOMATION_COMPANY_ID || 1
  );
  next();
};

export default automationAuth;
