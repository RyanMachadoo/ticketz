import { Router } from "express";
import isAuth from "../middleware/isAuth";
import * as WaUsageController from "../controllers/WaUsageController";

/**
 * Rotas do módulo "Custos / Uso" do canal oficial (EvoHub).
 * Consumo/custo por conexão e controle de limite/bloqueio. Restrito a admin
 * nas ações de escrita (validado no controller).
 */
const waUsageRoutes = Router();

waUsageRoutes.get("/wa-usage", isAuth, WaUsageController.index);
waUsageRoutes.put(
  "/wa-usage/:whatsappId",
  isAuth,
  WaUsageController.updateConfig
);
waUsageRoutes.post(
  "/wa-usage/:whatsappId/block",
  isAuth,
  WaUsageController.block
);
waUsageRoutes.post(
  "/wa-usage/:whatsappId/unblock",
  isAuth,
  WaUsageController.unblock
);

export default waUsageRoutes;
