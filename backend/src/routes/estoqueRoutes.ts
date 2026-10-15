import { Router } from "express";
import isAuth from "../middleware/isAuth";
import * as EstoqueController from "../controllers/EstoqueController";

/**
 * Consulta de estoque (0km/usados). Mesma fonte da ferramenta do agente de IA.
 */
const estoqueRoutes = Router();

estoqueRoutes.get("/estoque", isAuth, EstoqueController.index);
estoqueRoutes.get("/estoque/novos", isAuth, EstoqueController.novos);
estoqueRoutes.get("/estoque/usados", isAuth, EstoqueController.usados);

export default estoqueRoutes;
