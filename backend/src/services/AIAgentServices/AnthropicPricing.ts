/**
 * Tabela de preços (US$ por 1 milhão de tokens) dos modelos Claude, para
 * estimar o custo por turno do agente na observabilidade. São valores de
 * referência públicos da Anthropic; o controle de custo oficial é o do EvoHub
 * (WaUsage). Aqui é um indicador aproximado do custo de IA por atendimento.
 *
 * Pode ser sobrescrito por env: AGENT_PRICE_INPUT_<slug> / AGENT_PRICE_OUTPUT_<slug>
 * (US$ por 1M tokens). Ex.: AGENT_PRICE_INPUT_SONNET=3.
 */

interface PriceEntry {
  input: number; // US$ / 1M tokens de entrada
  output: number; // US$ / 1M tokens de saída
}

// Preços de referência (US$ por 1M tokens).
const PRICING: Array<{ match: RegExp; price: PriceEntry }> = [
  { match: /opus/i, price: { input: 15, output: 75 } },
  { match: /haiku/i, price: { input: 0.8, output: 4 } },
  { match: /sonnet/i, price: { input: 3, output: 15 } }
];

// Fallback caso o modelo não case com nenhum padrão conhecido.
const DEFAULT_PRICE: PriceEntry = { input: 3, output: 15 };

function resolvePrice(model: string): PriceEntry {
  const found = PRICING.find(p => p.match.test(model || ""));
  const base = found ? { ...found.price } : { ...DEFAULT_PRICE };

  // Override por env (opcional) — útil se a Anthropic mudar os preços.
  const slug = (model || "").match(/opus|sonnet|haiku/i)?.[0]?.toUpperCase();
  if (slug) {
    const inEnv = Number(process.env[`AGENT_PRICE_INPUT_${slug}`]);
    const outEnv = Number(process.env[`AGENT_PRICE_OUTPUT_${slug}`]);
    if (Number.isFinite(inEnv) && inEnv > 0) base.input = inEnv;
    if (Number.isFinite(outEnv) && outEnv > 0) base.output = outEnv;
  }
  return base;
}

/** Custo estimado em US$ a partir dos tokens de entrada/saída. */
export function estimateCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number
): number {
  const price = resolvePrice(model);
  const cost =
    (Number(inputTokens || 0) / 1_000_000) * price.input +
    (Number(outputTokens || 0) / 1_000_000) * price.output;
  // 6 casas decimais (custos por turno são bem pequenos).
  return Math.round(cost * 1_000_000) / 1_000_000;
}
