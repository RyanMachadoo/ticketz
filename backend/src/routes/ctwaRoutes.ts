import { Router } from "express";
import isAuth from "../middleware/isAuth";
import * as CtwaController from "../controllers/CtwaController";

/**
 * Rotas do relatório Click-to-WhatsApp (atribuição de leads por anúncio).
 */
const ctwaRoutes = Router();

ctwaRoutes.get("/ctwa/report", isAuth, CtwaController.report);
ctwaRoutes.get("/ctwa/leads", isAuth, CtwaController.leads);

export default ctwaRoutes;
