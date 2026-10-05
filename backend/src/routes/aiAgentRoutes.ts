import { Router } from "express";
import isAuth from "../middleware/isAuth";
import * as AIAgentController from "../controllers/AIAgentController";

/**
 * Rotas dos agentes de IA (Claude / Anthropic).
 * Escrita restrita a admin (validado no controller).
 */
const aiAgentRoutes = Router();

aiAgentRoutes.get("/ai-agents", isAuth, AIAgentController.index);
aiAgentRoutes.get("/ai-agents/:id", isAuth, AIAgentController.show);
aiAgentRoutes.post("/ai-agents", isAuth, AIAgentController.store);
aiAgentRoutes.put("/ai-agents/:id", isAuth, AIAgentController.update);
aiAgentRoutes.delete("/ai-agents/:id", isAuth, AIAgentController.remove);

export default aiAgentRoutes;
