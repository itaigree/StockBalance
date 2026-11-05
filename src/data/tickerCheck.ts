import type { AppData, PriceQuote, Settings } from '../types';
import { isTicker, normalizeTicker } from '../lib/format';
import { DEFAULT_TIMEOUT_MS, defaultFetch, getJson, pick, type FetchFn } from './http';
import { POPULAR_TICKERS } from './popularTickers';
import { fetchPrices } from './prices';

/** A ticker the user may have meant, with its name when known. */
export interface TickerSuggestion {
  ticker: string;
  name?: string;
}

/**
 * What checking a ticker found: its price; that no price source knows it (or lists it only in another
 * currency), with suggestions; or that it couldn't be checked (no source reachable, prices manual).
 */
export type TickerCheck =
  | { status: 'ok'; priceUsd: number; quote: PriceQuote }
  | { status: 'notFound'; reason: string; suggestions: TickerSuggestion[] }
  /** Suggestions here are close spellings of a ticker the app doesn't know, as a hint only. */
  | { status: 'unchecked'; reason: string; suggestions: TickerSuggestion[] };

const MAX_SUGGESTIONS = 4;
/** Yahoo's codes for US exchanges (Nasdaq, NYSE, NYSE American, NYSE Arca, Cboe). */
const YAHOO_US_EXCHANGES = new Set(['NMS', 'NGM', 'NCM', 'NAS', 'NYQ', 'NYS', 'ASE', 'PCX', 'BTS']);
const YAHOO_TYPES = new Set(['EQUITY', 'ETF', 'MUTUALFUND']);

/**
 * Check a ticker by getting its price from the price sources in the settings. When no source knows it,
 * suggest what may have been meant: from the sources' search (Yahoo, and Finnhub with a key) and from
 * close spellings among the user's own stocks and well-known ones. Never throws.
 */
export async function checkTicker(
  ticker: string,
  settings: Settings,
  own: string[] = [],
  fetchImpl: FetchFn = defaultFetch,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<TickerCheck> {
  const t = normalizeTicker(ticker);
  if (settings.priceProvider === 'manual')
    return { status: 'unchecked', reason: 'Prices are set to manual in Settings.', suggestions: [] };
  const r = await fetchPrices([t], settings, fetchImpl, undefined, timeoutMs);
  const quote = r.quotes[t];
  if (quote) return { status: 'ok', priceUsd: quote.priceUsd, quote };
  const unknown = r.unknown[t];
  if (!unknown) {
    // No source could say: close spellings of a ticker the app doesn't know at all, as a hint.
    const known = POPULAR_TICKERS[t] !== undefined || own.some((o) => normalizeTicker(o) === t);
    return {
      status: 'unchecked',
      reason: r.failures[t] ?? 'Unknown error.',
      suggestions: known ? [] : closeSpellings(t, own).slice(0, MAX_SUGGESTIONS),
    };
  }
  return {
    status: 'notFound',
    reason: unknown === 'notUsd' ? r.failures[t] : `No price found for ${t}.`,
    suggestions: await suggestTickers(t, settings, own, fetchImpl, timeoutMs),
  };
}

/** What a mistyped ticker may have been: the sources' search first, then close spellings, closest first. */
export async function suggestTickers(
  ticker: string,
  settings: Settings,
  own: string[] = [],
  fetchImpl: FetchFn = defaultFetch,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<TickerSuggestion[]> {
  const t = normalizeTicker(ticker);
  const key = settings.finnhubApiKey.trim();
  const provider = settings.priceProvider;
  const [yahoo, finnhub] = await Promise.all([
    provider === 'auto' || provider === 'yahoo' ? yahooSearch(t, settings.yahooProxyUrl, fetchImpl, timeoutMs) : [],
    key && (provider === 'auto' || provider === 'finnhub') ? finnhubSearch(t, key, fetchImpl, timeoutMs) : [],
  ]);
  const found = [...yahoo, ...finnhub, ...closeSpellings(t, own)];
  const seen = new Set([t]);
  const unique = found.filter((s) => !seen.has(s.ticker) && seen.add(s.ticker));
  // Closest spelling first; the order found breaks ties (the search's own ranking first).
  return unique
    .map((s, i) => ({ s, i, d: distance(t, s.ticker) }))
    .sort((a, b) => a.d - b.d || a.i - b.i)
    .slice(0, MAX_SUGGESTIONS)
    .map(({ s }) => s);
}

/** Tickers among the user's own and well-known ones that are spelled almost the same. */
export function closeSpellings(ticker: string, own: string[] = []): TickerSuggestion[] {
  const t = normalizeTicker(ticker);
  // One slip for tickers of up to 4 letters (2 would match almost anything), two for longer ones.
  const most = t.replace('.', '').length <= 4 ? 1 : 2;
  const candidates = new Map<string, string | undefined>();
  for (const o of own) candidates.set(normalizeTicker(o), POPULAR_TICKERS[normalizeTicker(o)]);
  for (const [p, name] of Object.entries(POPULAR_TICKERS)) if (!candidates.has(p)) candidates.set(p, name);
  // Also the same ticker with an exchange or share-class ending left out (MXWO → MXWO.L, BRK → BRK.B).
  return [...candidates]
    .filter(([c]) => c !== t && (distance(t, c) <= most || c.startsWith(`${t}.`)))
    .map(([c, name]) => ({ ticker: c, ...(name ? { name } : {}) }));
}

/** The tickers the user already has, in any category, purchase or price. */
export function ownTickers(data: Pick<AppData, 'categories' | 'prices'>): string[] {
  const all = new Set(Object.keys(data.prices));
  for (const c of data.categories) {
    for (const t of c.targets) all.add(t.ticker);
    for (const t of Object.keys(c.holdings)) all.add(t);
  }
  return [...all];
}

/**
 * Edit distance between two tickers, counting a swap of two neighbouring letters as one slip (APPL →
 * AAPL is 1, VOO → VOOO is 1). Optimal string alignment distance.
 */
export function distance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

/** Yahoo's search, through the price forwarder or the local proxy like prices (see vite.config.ts). */
export function yahooSearchUrl(query: string, proxyUrl = ''): string {
  const base = proxyUrl.trim().replace(/\/+$/, '') || '/api/yahoo';
  const q = encodeURIComponent(query);
  return `${base}/v1/finance/search?q=${q}&quotesCount=8&newsCount=0&listsCount=0&enableFuzzyQuery=true`;
}

async function yahooSearch(
  query: string,
  proxyUrl: string,
  fetchImpl: FetchFn,
  timeoutMs: number,
): Promise<TickerSuggestion[]> {
  const r = await getJson(fetchImpl, yahooSearchUrl(query, proxyUrl), timeoutMs);
  if (!r.ok) return [];
  const quotes = pick(r.json, 'quotes');
  if (!Array.isArray(quotes)) return [];
  const out: TickerSuggestion[] = [];
  for (const q of quotes) {
    const symbol = pick(q, 'symbol');
    const type = pick(q, 'quoteType');
    const exchange = pick(q, 'exchange');
    if (typeof symbol !== 'string' || typeof type !== 'string' || !YAHOO_TYPES.has(type)) continue;
    // Only US listings (the app prices in USD); Yahoo writes share classes as BRK-B.
    if (typeof exchange !== 'string' || !YAHOO_US_EXCHANGES.has(exchange)) continue;
    const ticker = normalizeTicker(symbol);
    if (!isTicker(ticker)) continue;
    const name = pick(q, 'shortname') ?? pick(q, 'longname');
    out.push({ ticker, ...(typeof name === 'string' && name.trim() ? { name: name.trim() } : {}) });
  }
  return out;
}

async function finnhubSearch(
  query: string,
  key: string,
  fetchImpl: FetchFn,
  timeoutMs: number,
): Promise<TickerSuggestion[]> {
  const url = `https://finnhub.io/api/v1/search?q=${encodeURIComponent(query)}&exchange=US&token=${encodeURIComponent(key)}`;
  const r = await getJson(fetchImpl, url, timeoutMs);
  if (!r.ok) return [];
  const results = pick(r.json, 'result');
  if (!Array.isArray(results)) return [];
  const out: TickerSuggestion[] = [];
  for (const x of results) {
    const symbol = pick(x, 'symbol');
    if (typeof symbol !== 'string') continue;
    const ticker = normalizeTicker(symbol);
    if (!isTicker(ticker)) continue;
    const name = pick(x, 'description');
    out.push({ ticker, ...(typeof name === 'string' && name.trim() ? { name: name.trim() } : {}) });
  }
  return out;
}
