import { Request, Response } from "express";
import { logger } from "../utils/logger";
import { addEvoHubInboundJob } from "../queues/EvoHubInboundQueue";

/**
 * Valida o token que VOCÊ cadastra no painel do EvoHub para este webhook.
 * Aceita o token de 3 formas (o EvoHub pode enviar de qualquer uma):
 *   - query string:  ?token=SEU_TOKEN
 *   - header:        x-webhook-token: SEU_TOKEN
 *   - Authorization: Bearer SEU_TOKEN
 * Compara com a env EVOHUB_WEBHOOK_TOKEN. Se a env estiver vazia, não valida
 * (útil só em ambiente de teste — em produção, sempre preencha).
 */
function tokenIsValid(req: Request): boolean {
  const expected = process.env.EVOHUB_WEBHOOK_TOKEN;
  if (!expected) return true;

  const fromQuery = req.query.token as string | undefined;
  const fromHeader = req.headers["x-webhook-token"] as string | undefined;
  const auth = req.headers.authorization as string | undefined;
  const fromBearer = auth?.startsWith("Bearer ") ? auth.slice(7) : undefined;

  return [fromQuery, fromHeader, fromBearer].includes(expected);
}

/**
 * GET /webhooks/evohub/:whatsappId
 * Handshake de verificação, caso o EvoHub repasse o verify challenge da Meta.
 * Configure o verify token em env: EVOHUB_VERIFY_TOKEN.
 */
export const verify = (req: Request, res: Response): Response => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === process.env.EVOHUB_VERIFY_TOKEN) {
    return res.status(200).send(challenge as string);
  }
  return res.sendStatus(403);
};

/**
 * POST /webhooks/evohub/:whatsappId
 * REGRA DE OURO: responde 200 IMEDIATAMENTE e processa em fila (Bull).
 * Nunca segurar a resposta gravando no banco — o EvoHub conta como falha e
 * desativa o webhook após 20 falhas seguidas (aviso por e-mail em 10/20).
 */
export const webhook = async (req: Request, res: Response): Promise<Response> => {
  const { whatsappId } = req.params;

  if (!tokenIsValid(req)) {
    logger.warn(`[EvoHub] token invalido no webhook da conexao ${whatsappId}`);
    return res.sendStatus(401);
  }

  try {
    await addEvoHubInboundJob({
      whatsappId: Number(whatsappId),
      payload: req.body
    });
  } catch (err) {
    // Mesmo se o enfileiramento falhar, responder 200 evita a desativacao.
    // O erro fica logado pra investigacao (o EvoHub costuma reenviar).
    logger.error(`[EvoHub] falha ao enfileirar webhook da conexao ${whatsappId}: ${err}`);
  }
  return res.sendStatus(200);
};
