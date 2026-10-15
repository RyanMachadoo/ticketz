import axios from "axios";
import { logger } from "../../utils/logger";

/**
 * Consulta de estoque de veículos a partir do site da concessionária
 * (plataforma DealerSpace). A página de listagem traz um bloco JSON-LD
 * (schema.org AutomotiveBusiness) com um array `offers`, cada item um `Car`
 * com nome, marca, modelo, ano, km, combustível, câmbio e preço. Lemos esse
 * JSON-LD (padrão de SEO, estável) em vez de raspar classes CSS.
 *
 * O MESMO feed traz 0km e usados; separamos pelo km (0 => novo). Paginamos via
 * ?page=N até acabar. Resultado fica em cache por alguns minutos para não
 * bater no site a cada mensagem e manter a resposta do agente rápida/barata.
 *
 * Tudo best-effort: falha de rede/parse NUNCA quebra o atendimento — devolve o
 * que tiver (ou vazio) e o agente trata.
 */

export interface EstoqueVeiculo {
  nome: string;
  marca: string;
  modelo: string;
  ano: number | null;
  km: number;
  combustivel: string;
  cambio: string;
  preco: number;
  tipo: "novo" | "usado"; // km === 0 => novo (0km)
}

export interface EstoqueFiltro {
  tipo?: string; // "novos" | "usados" | "todos"
  modelo?: string;
  precoMax?: number;
  precoMin?: number;
  anoMin?: number;
  cambio?: string;
  combustivel?: string;
}

export interface EstoqueResultado {
  total: number;
  novos: number;
  usados: number;
  precoMin: number | null;
  precoMax: number | null;
  itens: EstoqueVeiculo[];
  truncado: boolean; // true se havia mais itens do que o limite retornado
}

const TTL_MS = Number(process.env.ESTOQUE_CACHE_TTL_MS || 10 * 60 * 1000);
const MAX_PAGES = 12;
const PAGE_SIZE_HINT = 12;
const DEFAULT_BASE_URL =
  process.env.ESTOQUE_BASE_URL || "https://www.francauto.com.br";
const DEFAULT_PATH = process.env.ESTOQUE_PATH || "/seminovos";
const UA =
  "Mozilla/5.0 (compatible; TicketzEstoqueBot/1.0; +https://ticketz.com.br)";

interface CacheEntry {
  at: number;
  data: EstoqueVeiculo[];
}
const cache = new Map<string, CacheEntry>();

const stripAccents = (s: string): string =>
  (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "");

const norm = (s: string): string => stripAccents(String(s || "")).toLowerCase().trim();

function parseAno(vehicleConfiguration?: string, dateFirst?: string): number | null {
  const fromCfg = String(vehicleConfiguration || "").match(/\b(19|20)\d{2}\b/);
  if (fromCfg) return Number(fromCfg[0]);
  const fromDate = String(dateFirst || "").match(/\b(19|20)\d{2}\b/);
  if (fromDate) return Number(fromDate[0]);
  return null;
}

/** Extrai os veículos dos blocos JSON-LD de uma página HTML. */
function parseLdOffers(html: string): EstoqueVeiculo[] {
  const out: EstoqueVeiculo[] = [];
  const re = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  // eslint-disable-next-line no-cond-assign
  while ((m = re.exec(html))) {
    let data: any;
    try {
      data = JSON.parse(m[1].trim());
    } catch {
      // bloco JSON-LD inválido; ignora
      // eslint-disable-next-line no-continue
      continue;
    }
    const blocks = Array.isArray(data) ? data : [data];
    blocks.forEach(b => {
      const offers = b && Array.isArray(b.offers) ? b.offers : [];
      offers.forEach((o: any) => {
        const car = o && o.itemOffered;
        if (!car) return;
        const km =
          Math.round(parseFloat(car.mileageFromOdometer?.value || "0")) || 0;
        const preco = Math.round(parseFloat(o.price || "0")) || 0;
        out.push({
          nome: String(car.name || "").trim(),
          marca: String(car.brand?.name || "").trim(),
          modelo: String(car.model || "").trim(),
          ano: parseAno(car.vehicleConfiguration, car.dateVehicleFirstRegistered),
          km,
          combustivel: String(car.fuelType || "").trim(),
          cambio: String(car.vehicleTransmission || "").trim(),
          preco,
          tipo: km === 0 ? "novo" : "usado"
        });
      });
    });
  }
  return out;
}

/** Busca o estoque completo (todas as páginas), com cache em memória. */
async function fetchStock(
  baseUrl: string,
  path: string
): Promise<EstoqueVeiculo[]> {
  const key = `${baseUrl}${path}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < TTL_MS) {
    return cached.data;
  }

  const all: EstoqueVeiculo[] = [];
  const seen = new Set<string>();

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const url = `${baseUrl}${path}?page=${page}`;
    let html = "";
    try {
      // eslint-disable-next-line no-await-in-loop
      const resp = await axios.get(url, {
        timeout: 15000,
        maxContentLength: 8_000_000,
        headers: { "User-Agent": UA, Accept: "text/html" },
        validateStatus: () => true
      });
      if (resp.status >= 400) {
        logger.warn(`[Estoque] página ${page} status ${resp.status} em ${url}`);
        break;
      }
      html = typeof resp.data === "string" ? resp.data : String(resp.data);
    } catch (err: any) {
      logger.warn(`[Estoque] falha ao buscar ${url}: ${err?.message}`);
      break;
    }

    const items = parseLdOffers(html);
    if (!items.length) break;

    let added = 0;
    items.forEach(it => {
      const k = `${it.nome}|${it.preco}|${it.km}`;
      if (!seen.has(k)) {
        seen.add(k);
        all.push(it);
        added += 1;
      }
    });

    // Sem itens novos (site clampou a paginação) ou última página: encerra.
    if (added === 0 || items.length < PAGE_SIZE_HINT) break;
  }

  if (all.length) {
    cache.set(key, { at: Date.now(), data: all });
  } else {
    // Mantém cache antigo (se houver) em caso de falha momentânea do site.
    if (cached) return cached.data;
  }
  return all;
}

/** Aplica os filtros do agente sobre a lista. */
function applyFilters(
  list: EstoqueVeiculo[],
  filtro: EstoqueFiltro
): EstoqueVeiculo[] {
  const tipo = norm(filtro.tipo || "todos");
  const wantNovos = tipo.startsWith("nov");
  const wantUsados = tipo.startsWith("usad") || tipo.startsWith("semi");
  const modelo = norm(filtro.modelo || "");
  const cambio = norm(filtro.cambio || "");
  const combustivel = norm(filtro.combustivel || "");

  return list.filter(v => {
    if (wantNovos && v.tipo !== "novo") return false;
    if (wantUsados && v.tipo !== "usado") return false;
    if (modelo && !norm(`${v.nome} ${v.modelo} ${v.marca}`).includes(modelo))
      return false;
    if (cambio && !norm(v.cambio).includes(cambio)) return false;
    if (combustivel && !norm(v.combustivel).includes(combustivel)) return false;
    if (filtro.precoMax && v.preco > Number(filtro.precoMax)) return false;
    if (filtro.precoMin && v.preco < Number(filtro.precoMin)) return false;
    if (filtro.anoMin && v.ano && v.ano < Number(filtro.anoMin)) return false;
    return true;
  });
}

export interface EstoqueConfig {
  baseUrl?: string;
  path?: string;
  limit?: number; // máximo de itens detalhados no retorno
}

/** Consulta principal usada pela ferramenta do agente e pelo endpoint HTTP. */
export async function consultarEstoque(
  cfg: EstoqueConfig,
  filtro: EstoqueFiltro
): Promise<EstoqueResultado> {
  const baseUrl = (cfg.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const path = cfg.path || DEFAULT_PATH;
  const limit = Math.min(Math.max(Number(cfg.limit) || 20, 1), 60);

  const todos = await fetchStock(baseUrl, path);
  const filtrados = applyFilters(todos, filtro).sort((a, b) => a.preco - b.preco);

  const precos = filtrados.map(v => v.preco).filter(p => p > 0);
  return {
    total: filtrados.length,
    novos: filtrados.filter(v => v.tipo === "novo").length,
    usados: filtrados.filter(v => v.tipo === "usado").length,
    precoMin: precos.length ? Math.min(...precos) : null,
    precoMax: precos.length ? Math.max(...precos) : null,
    itens: filtrados.slice(0, limit),
    truncado: filtrados.length > limit
  };
}

/** Limpa o cache (útil em testes ou ao forçar atualização). */
export function clearEstoqueCache(): void {
  cache.clear();
}
