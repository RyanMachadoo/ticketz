import { Router } from "express";
import isAuth from "../middleware/isAuth";
import automationAuth from "../middleware/automationAuth";
import * as AutomationController from "../controllers/AutomationController";

/**
 * Automações de relacionamento (pós-vendas / vendas).
 *  - /automations/trigger e /enrollments: autenticados pelo token do API
 *    interno (automationAuth).
 *  - /automations/journeys e /steps: autenticados pela plataforma (isAuth),
 *    para configuração na tela (vincular templates, ativar/desativar).
 */
const automationRoutes = Router();

// API interna (gatilho + consulta)
automationRoutes.post(
  "/automations/trigger",
  automationAuth,
  AutomationController.trigger
);
automationRoutes.get(
  "/automations/enrollments/:ref",
  automationAuth,
  AutomationController.enrollmentStatus
);

// Configuração (tela/admin)
automationRoutes.get(
  "/automations/journeys",
  isAuth,
  AutomationController.journeys
);
automationRoutes.put(
  "/automations/journeys/:id",
  isAuth,
  AutomationController.updateJourney
);
automationRoutes.put(
  "/automations/steps/:id",
  isAuth,
  AutomationController.updateStep
);

export default automationRoutes;
