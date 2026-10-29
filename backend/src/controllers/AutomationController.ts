import { Request, Response } from "express";
import AppError from "../errors/AppError";
import { enroll } from "../services/AutomationServices/EnrollService";
import { ensureJourneys } from "../services/AutomationServices/EnsureJourneysService";
import AutomationJourney from "../models/AutomationJourney";
import AutomationStep from "../models/AutomationStep";
import AutomationEnrollment from "../models/AutomationEnrollment";
import AutomationTask from "../models/AutomationTask";

/**
 * POST /automations/trigger  (automationAuth)
 * Recebe um evento do API interno e inscreve o cliente na jornada.
 */
export const trigger = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const companyId = (req as any).automationCompanyId as number;
  const { tipo, numero, nome, dataEvento, externalRef, loja, modelo, extra } =
    req.body || {};

  if (!tipo || !numero || !dataEvento) {
    throw new AppError("campos obrigatórios: tipo, numero, dataEvento", 400);
  }

  const data = { ...(extra || {}) };
  if (loja) data.loja = loja;
  if (modelo) data.modelo = modelo;

  const result = await enroll({
    companyId,
    tipo,
    numero,
    nome,
    dataEvento,
    externalRef,
    data
  });

  return res.status(200).json(result);
};

/**
 * GET /automations/enrollments/:ref  (automationAuth)
 * Status de uma inscrição (por externalRef) e de cada passo.
 */
export const enrollmentStatus = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const companyId = (req as any).automationCompanyId as number;
  const { ref } = req.params;

  const enrollment = await AutomationEnrollment.findOne({
    where: { companyId, externalRef: ref },
    order: [["id", "DESC"]]
  });
  if (!enrollment) {
    throw new AppError("inscrição não encontrada", 404);
  }

  const tasks = await AutomationTask.findAll({
    where: { enrollmentId: enrollment.id },
    include: [{ model: AutomationStep }],
    order: [["runAt", "ASC"]]
  });

  return res.status(200).json({
    enrollmentId: enrollment.id,
    journeyId: enrollment.journeyId,
    status: enrollment.status,
    contactNumber: enrollment.contactNumber,
    eventAt: enrollment.eventAt,
    tasks: tasks.map((t: any) => ({
      step: t.step?.key,
      name: t.step?.name,
      runAt: t.runAt,
      status: t.status,
      attempts: t.attempts,
      sentAt: t.sentAt,
      wamid: t.wamid,
      lastError: t.lastError
    }))
  });
};

/**
 * GET /automations/journeys  (isAuth — tela/admin)
 * Lista as jornadas/passos da empresa (cria as padrão se faltarem).
 */
export const journeys = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { companyId } = req.user as any;
  const data = await ensureJourneys(companyId);
  return res.status(200).json(data);
};

/**
 * PUT /automations/steps/:id  (isAuth — tela/admin)
 * Vincula/ajusta o template e os parâmetros de um passo.
 */
export const updateStep = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { companyId, profile } = req.user as any;
  if (profile !== "admin") {
    throw new AppError("acesso restrito a administradores", 403);
  }

  const { id } = req.params;
  const step = await AutomationStep.findByPk(id);
  if (!step || step.companyId !== companyId) {
    throw new AppError("passo não encontrado", 404);
  }

  const {
    templateName,
    templateLanguage,
    templateParams,
    offsetMinutes,
    name,
    isActive
  } = req.body || {};

  await step.update({
    ...(templateName !== undefined ? { templateName: templateName || null } : {}),
    ...(templateLanguage !== undefined ? { templateLanguage } : {}),
    ...(Array.isArray(templateParams) ? { templateParams } : {}),
    ...(offsetMinutes !== undefined ? { offsetMinutes: Number(offsetMinutes) } : {}),
    ...(name !== undefined ? { name } : {}),
    ...(isActive !== undefined ? { isActive: !!isActive } : {})
  });

  return res.status(200).json(step);
};

/**
 * PUT /automations/journeys/:id  (isAuth — tela/admin)
 * Ativa/desativa uma jornada ou define a conexão de envio.
 */
export const updateJourney = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { companyId, profile } = req.user as any;
  if (profile !== "admin") {
    throw new AppError("acesso restrito a administradores", 403);
  }

  const { id } = req.params;
  const journey = await AutomationJourney.findByPk(id);
  if (!journey || journey.companyId !== companyId) {
    throw new AppError("jornada não encontrada", 404);
  }

  const { isActive, whatsappId, name } = req.body || {};
  await journey.update({
    ...(isActive !== undefined ? { isActive: !!isActive } : {}),
    ...(whatsappId !== undefined
      ? { whatsappId: whatsappId ? Number(whatsappId) : null }
      : {}),
    ...(name !== undefined ? { name } : {})
  });

  return res.status(200).json(journey);
};
