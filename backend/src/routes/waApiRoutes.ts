import { Router } from "express";
import isAuth from "../middleware/isAuth";
import * as WaApiController from "../controllers/WaApiController";

/**
 * Rotas do módulo WA API (recursos da API oficial via EvoHub).
 * Protegidas por autenticação normal do ticketz (isAuth).
 */
const waApiRoutes = Router();

waApiRoutes.get(
  "/wa-api/:whatsappId/templates",
  isAuth,
  WaApiController.templates
);

export default waApiRoutes;
