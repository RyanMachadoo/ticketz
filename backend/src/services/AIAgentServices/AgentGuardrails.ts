import { logger } from "../../utils/logger";

/**
 * Guardrails determinísticos (estilo ADK: checagens em CÓDIGO antes de executar
 * ferramentas, independentes do que o modelo "decidiu"). São políticas simples,
 * previsíveis e auditáveis, configuradas por agente (coluna guardrails).
 *
 * Config (todas opcionais):
 *  {
 *    "maxToolCallsPerTurn": 6,          // trava anti-loop/anti-custo por turno
 *    "allowedDomains": ["api.x.com"],   // se preenchido, só HTTP p/ esses domínios
 *    "blockedDomains": ["localhost"],   // nunca chamar esses domínios
 *    "blockedKeywords": ["senha"],      // bloqueia se aparecer no input da ferramenta
 *    "maskPii": true                    // mascara CPF/telefone/e-mail/cartão em logs/trace
 *  }
 *
 * IMPORTANTE: a máscara de PII é aplicada apenas ao que é REGISTRADO (log/trace),
 * nunca ao que vai para a ferramenta — mascarar o envio quebraria integrações.
 */

export interface GuardrailConfig {
  maxToolCallsPerTurn?: number;
  allowedDomains?: string[];
  blockedDomains?: string[];
  blockedKeywords?: string[];
  maskPii?: boolean;
}

export interface GuardrailDecision {
  allowed: boolean;
  reason?: string; // motivo do bloqueio (também vira tool_result de erro)
  event?: { tool: string; action: "block" | "mask"; reason: string };
}

export function normalizeGuardrails(raw: any): GuardrailConfig {
  const g = raw && typeof raw === "object" ? raw : {};
  const toArr = (v: any): string[] =>
    Array.isArray(v)
      ? v.map(x => String(x || "").trim().toLowerCase()).filter(Boolean)
      : [];
  return {
    maxToolCallsPerTurn:
      Number(g.maxToolCallsPerTurn) > 0
        ? Math.floor(Number(g.maxToolCallsPerTurn))
        : undefined,
    allowedDomains: toArr(g.allowedDomains),
    blockedDomains: toArr(g.blockedDomains),
    blockedKeywords: toArr(g.blockedKeywords),
    maskPii: !!g.maskPii
  };
}

const extractHost = (url: string): string => {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    // interpola pode deixar {{}} — tenta um fallback bruto
    const m = (url || "").match(/^https?:\/\/([^/]+)/i);
    return m ? m[1].toLowerCase() : "";
  }
};

const hostMatches = (host: string, pattern: string): boolean => {
  if (!host || !pattern) return false;
  return host === pattern || host.endsWith(`.${pattern}`) || host.includes(pattern);
};

/** Mascara PII em um texto (para logs/trace). */
export function maskPiiText(text: string): string {
  if (!text) return text;
  return (
    text
      // cartão (13-16 dígitos, com ou sem separador)
      .replace(/\b(?:\d[ -]?){13,16}\b/g, m => maskTail(m, 4))
      // CPF
      .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, "***.***.***-**")
      // CNPJ
      .replace(/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g, "**.***.***/****-**")
      // e-mail
      .replace(/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, m => maskEmail(m))
      // telefone brasileiro (10-11 dígitos, opcional +55)
      .replace(/(\+?55\s?)?\(?\d{2}\)?\s?9?\d{4}[- ]?\d{4}\b/g, m =>
        maskTail(m, 2)
      )
  );
}

const maskTail = (s: string, keep: number): string => {
  const digits = s.replace(/\D/g, "");
  if (digits.length <= keep) return s;
  return `••••${digits.slice(-keep)}`;
};

const maskEmail = (e: string): string => {
  const [user, domain] = e.split("@");
  if (!domain) return e;
  const u = user.length <= 2 ? user[0] || "" : `${user.slice(0, 2)}`;
  return `${u}•••@${domain}`;
};

/** Mascara PII dentro de um objeto de input (deep, só para registro). */
export function maskPiiInput(input: any): any {
  try {
    const json = JSON.stringify(input ?? {});
    return JSON.parse(maskPiiText(json));
  } catch {
    return input;
  }
}

/**
 * Decide se uma chamada de ferramenta pode prosseguir. Determinístico:
 *  1) teto de chamadas por turno;
 *  2) palavras bloqueadas no input;
 *  3) domínios (allow/block) para ferramentas HTTP.
 * Nunca lança.
 */
export function checkToolCall(params: {
  cfg: GuardrailConfig;
  toolName: string;
  input: any;
  toolDef?: any; // def da ferramenta (para pegar url em http)
  resolvedUrl?: string; // url já interpolada (quando disponível)
  callsSoFar: number;
}): GuardrailDecision {
  const { cfg, toolName, input, toolDef, resolvedUrl, callsSoFar } = params;

  // 1) teto de chamadas por turno
  if (
    cfg.maxToolCallsPerTurn !== undefined &&
    callsSoFar >= cfg.maxToolCallsPerTurn
  ) {
    const reason = `Limite de ${cfg.maxToolCallsPerTurn} chamada(s) de ferramenta por turno atingido.`;
    logger.warn(`[Guardrail] ticket/tool '${toolName}' bloqueado: ${reason}`);
    return {
      allowed: false,
      reason,
      event: { tool: toolName, action: "block", reason }
    };
  }

  // 2) palavras bloqueadas no input
  if (cfg.blockedKeywords && cfg.blockedKeywords.length) {
    let hay = "";
    try {
      hay = JSON.stringify(input ?? {}).toLowerCase();
    } catch {
      hay = String(input || "").toLowerCase();
    }
    const hit = cfg.blockedKeywords.find(k => hay.includes(k));
    if (hit) {
      const reason = `Conteúdo bloqueado por política (palavra "${hit}").`;
      logger.warn(`[Guardrail] ferramenta '${toolName}' bloqueada: ${reason}`);
      return {
        allowed: false,
        reason,
        event: { tool: toolName, action: "block", reason }
      };
    }
  }

  // 3) domínios (só p/ HTTP)
  const url = resolvedUrl || toolDef?.url || "";
  const isHttp = toolDef?.kind === "http" || /^https?:\/\//i.test(url);
  if (isHttp && url) {
    const host = extractHost(url);
    if (host) {
      if (
        cfg.blockedDomains &&
        cfg.blockedDomains.some(d => hostMatches(host, d))
      ) {
        const reason = `Domínio bloqueado por política: ${host}.`;
        logger.warn(`[Guardrail] ferramenta '${toolName}' bloqueada: ${reason}`);
        return {
          allowed: false,
          reason,
          event: { tool: toolName, action: "block", reason }
        };
      }
      if (
        cfg.allowedDomains &&
        cfg.allowedDomains.length &&
        !cfg.allowedDomains.some(d => hostMatches(host, d))
      ) {
        const reason = `Domínio ${host} fora da lista de domínios permitidos.`;
        logger.warn(`[Guardrail] ferramenta '${toolName}' bloqueada: ${reason}`);
        return {
          allowed: false,
          reason,
          event: { tool: toolName, action: "block", reason }
        };
      }
    }
  }

  return { allowed: true };
}
