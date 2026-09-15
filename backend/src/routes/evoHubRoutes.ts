import { Router } from "express";
import * as EvoHubWebhookController from "../controllers/EvoHubWebhookController";

const evoHubRoutes = Router();

/**
 * Endpoints PÚBLICOS (a Meta/EvoHub chamam sem o auth do ticketz).
 * A "segurança" aqui é o verify token + o :whatsappId na URL + (se houver)
 * validação de assinatura. NÃO colocar isModAuth/tokenAuth nessas rotas.
 *
 * A URL final deve bater com a cadastrada no painel do EvoHub, ex.:
 *   https://SEU_DOMINIO/webhooks/evohub/1
 */
evoHubRoutes.get("/webhooks/evohub/:whatsappId", EvoHubWebhookController.verify);
evoHubRoutes.post("/webhooks/evohub/:whatsappId", EvoHubWebhookController.webhook);

export default evoHubRoutes;
