import { Router } from "express";
import isAuth from "../middleware/isAuth";
import * as AITraceController from "../controllers/AITraceController";

/**
 * Observabilidade do agente de IA (traces por turno + resumo agregado).
 */
const aiTraceRoutes = Router();

aiTraceRoutes.get("/ai-agents-traces", isAuth, AITraceController.index);
aiTraceRoutes.get("/ai-agents-traces/summary", isAuth, AITraceController.summary);

export default aiTraceRoutes;
