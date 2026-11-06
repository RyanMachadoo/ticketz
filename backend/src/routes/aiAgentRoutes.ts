import { Router } from "express";
import multer from "multer";
import isAuth from "../middleware/isAuth";
import uploadConfig from "../config/upload";
import * as AIAgentController from "../controllers/AIAgentController";
import * as AgentKnowledgeController from "../controllers/AgentKnowledgeController";

/**
 * Rotas dos agentes de IA (Claude / Anthropic).
 * Escrita restrita a admin (validado no controller).
 */
const aiAgentRoutes = Router();
const upload = multer(uploadConfig);

aiAgentRoutes.get("/ai-agents", isAuth, AIAgentController.index);
aiAgentRoutes.get("/ai-agents/:id", isAuth, AIAgentController.show);
aiAgentRoutes.post("/ai-agents", isAuth, AIAgentController.store);
aiAgentRoutes.put("/ai-agents/:id", isAuth, AIAgentController.update);
aiAgentRoutes.delete("/ai-agents/:id", isAuth, AIAgentController.remove);

// Base de conhecimento (RAG) do agente.
aiAgentRoutes.get(
  "/ai-agents/:id/knowledge",
  isAuth,
  AgentKnowledgeController.index
);
aiAgentRoutes.post(
  "/ai-agents/:id/knowledge",
  isAuth,
  upload.array("file"),
  AgentKnowledgeController.upload
);
aiAgentRoutes.delete(
  "/ai-agents/:id/knowledge/:docId",
  isAuth,
  AgentKnowledgeController.remove
);

export default aiAgentRoutes;
