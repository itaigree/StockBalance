import type { PriceQuote, Settings } from '../types';
import { DEFAULT_TIMEOUT_MS, defaultFetch, getJson, mapLimit, pick, positiveNumber, type FetchFn } from './http';

export interface FetchPricesResult {
  /** Successfully fetched quotes by ticker. */
  quotes: Record<string, PriceQuote>;
  /** Human-readable reason per ticker that could not be fetched. */
  failures: Record<string, string>;
}

const CONCURRENCY = 4;
const YAHOO_UNAVAILABLE = "Couldn't reach Yahoo (Yahoo prices only work when the app runs on your computer with npm start).";

type One = { price: number } | { error: string };

/** URL of the Yahoo chart API through the local dev-server proxy (see vite.config.ts). */
export function yahooChartUrl(symbol: string): string {
  return `/api/yahoo/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`;
}

/**
 * Fetch current USD prices. Provider order per settings.priceProvider (see docs/DESIGN.md):
 * 'auto' = Yahoo via local proxy, then Finnhub (if a key is set) for the tickers still missing;
 * 'yahoo' / 'finnhub' = only that one; 'manual' = fetch nothing (every ticker is a failure with a
 * "manual prices" reason). Never throws; per-ticker failures go to `failures`. Requests run with
 * limited concurrency and a timeout.
 */
export async function fetchPrices(
  tickers: string[],
  settings: Settings,
  fetchImpl: FetchFn = defaultFetch,
  now: () => Date = () => new Date(),
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<FetchPricesResult> {
  const list = [...new Set(tickers.map((t) => t.trim().toUpperCase()).filter(Boolean))];
  const quotes: Record<string, PriceQuote> = {};
  const failures: Record<string, string> = {};
  if (list.length === 0) return { quotes, failures };

  const provider = settings.priceProvider;
  if (provider === 'manual') {
    for (const t of list) failures[t] = 'Prices are set to manual in Settings.';
    return { quotes, failures };
  }

  const key = settings.finnhubApiKey.trim();
  let missing = list;
  const reasons: Record<string, string[]> = {};
  const record = (results: One[], tickersDone: string[], source: PriceQuote['source']) => {
    const stillMissing: string[] = [];
    results.forEach((r, i) => {
      const t = tickersDone[i];
      if ('price' in r) quotes[t] = { priceUsd: r.price, asOf: now().toISOString(), source };
      else {
        (reasons[t] ??= []).push(r.error);
        stillMissing.push(t);
      }
    });
    return stillMissing;
  };

  if (provider === 'auto' || provider === 'yahoo') {
    missing = record(await yahooPrices(missing, fetchImpl, timeoutMs), missing, 'yahoo');
  }
  if (provider === 'finnhub' || (provider === 'auto' && key && missing.length > 0)) {
    if (!key) {
      for (const t of missing) (reasons[t] ??= []).push('Set a Finnhub API key in Settings.');
    } else {
      missing = record(await finnhubPrices(missing, key, fetchImpl, timeoutMs), missing, 'finnhub');
    }
  }

  for (const t of missing) {
    let why = (reasons[t] ?? []).join(' ');
    if (provider === 'auto' && !key && why.includes(YAHOO_UNAVAILABLE)) {
      why += ' Add a free Finnhub API key in Settings, or enter the price yourself.';
    }
    failures[t] = why || 'Unknown error.';
  }
  return { quotes, failures };
}

/** Yahoo symbols use "-" for share classes (BRK.B → BRK-B). */
function yahooSymbol(ticker: string): string {
  return ticker.replace(/\./g, '-');
}

async function yahooOne(ticker: string, fetchImpl: FetchFn, timeoutMs: number): Promise<One & { unavailable?: boolean }> {
  const r = await getJson(fetchImpl, yahooChartUrl(yahooSymbol(ticker)), timeoutMs);
  if (!r.ok) {
    if (r.kind === 'timeout') return { error: "Yahoo didn't answer in time." };
    return { error: YAHOO_UNAVAILABLE, unavailable: true };
  }
  const error = pick(r.json, 'chart', 'error');
  if (error) {
    const description = pick(error, 'description');
    return { error: `Yahoo: ${typeof description === 'string' && description ? description : 'unknown symbol'}.` };
  }
  const meta = pick(r.json, 'chart', 'result', 0, 'meta');
  if (meta === undefined) return { error: `Yahoo answered with an unexpected response (HTTP ${r.status}).` };
  const currency = pick(meta, 'currency');
  if (typeof currency === 'string' && currency.toUpperCase() !== 'USD') {
    return { error: `Yahoo lists this stock in ${currency}; only USD stocks are supported.` };
  }
  const price = positiveNumber(pick(meta, 'regularMarketPrice'));
  return price !== null ? { price } : { error: 'Yahoo returned no price.' };
}

async function yahooPrices(tickers: string[], fetchImpl: FetchFn, timeoutMs: number): Promise<One[]> {
  if (tickers.length === 0) return [];
  // Try one first: if the proxy isn't there (static hosting), don't send the rest.
  const first = await yahooOne(tickers[0], fetchImpl, timeoutMs);
  if ('unavailable' in first && first.unavailable) return tickers.map(() => ({ error: YAHOO_UNAVAILABLE }));
  const rest = await mapLimit(tickers.slice(1), CONCURRENCY, (t) => yahooOne(t, fetchImpl, timeoutMs));
  return [first, ...rest].map((r) => ('price' in r ? { price: r.price } : { error: r.error }));
}

async function finnhubPrices(tickers: string[], key: string, fetchImpl: FetchFn, timeoutMs: number): Promise<One[]> {
  let keyRejected = false;
  return mapLimit(tickers, CONCURRENCY, async (t): Promise<One> => {
    if (keyRejected) return { error: 'Finnhub rejected the API key.' };
    const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(t)}&token=${encodeURIComponent(key)}`;
    const r = await getJson(fetchImpl, url, timeoutMs);
    if (!r.ok) {
      if (r.kind === 'timeout') return { error: "Finnhub didn't answer in time." };
      if (r.status === 401 || r.status === 403) {
        keyRejected = true;
        return { error: 'Finnhub rejected the API key.' };
      }
      if (r.status === 429) return { error: 'Finnhub rate limit reached; try again in a minute.' };
      return { error: "Couldn't reach Finnhub." };
    }
    if (r.status === 401 || r.status === 403) {
      keyRejected = true;
      return { error: 'Finnhub rejected the API key.' };
    }
    if (r.status === 429) return { error: 'Finnhub rate limit reached; try again in a minute.' };
    const apiError = pick(r.json, 'error');
    if (typeof apiError === 'string') return { error: `Finnhub: ${apiError}` };
    const price = positiveNumber(pick(r.json, 'c'));
    return price !== null ? { price } : { error: "Finnhub doesn't know this symbol." };
  });
}
