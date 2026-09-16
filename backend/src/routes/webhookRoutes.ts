import { Router } from "express";
import isAuth from "../middleware/isAuth";
import * as WebhookController from "../controllers/WebhookController";

/**
 * Rotas do módulo Integrações: CRUD de webhooks de saída (ex.: n8n).
 */
const webhookRoutes = Router();

webhookRoutes.get("/webhooks", isAuth, WebhookController.index);
webhookRoutes.post("/webhooks", isAuth, WebhookController.store);
webhookRoutes.get("/webhooks/:id", isAuth, WebhookController.show);
webhookRoutes.put("/webhooks/:id", isAuth, WebhookController.update);
webhookRoutes.delete("/webhooks/:id", isAuth, WebhookController.remove);
webhookRoutes.post("/webhooks/:id/test", isAuth, WebhookController.test);

export default webhookRoutes;
