import type { FxQuote, Settings } from '../types';
import { DEFAULT_TIMEOUT_MS, defaultFetch, getJson, pick, positiveNumber, type FetchFn } from './http';
import { yahooChartUrl } from './prices';

/** Anything outside this range is treated as a bad answer (USD/ILS has been ~3–5 for decades). */
const MIN_RATE = 1.5;
const MAX_RATE = 10;

interface Source {
  name: string;
  source: FxQuote['source'];
  url: string;
  read: (json: unknown) => unknown;
}

const yahoo = (proxyUrl: string): Source => ({
  name: 'Yahoo',
  source: 'yahoo',
  url: yahooChartUrl('ILS=X', proxyUrl),
  read: (json) => pick(json, 'chart', 'result', 0, 'meta', 'regularMarketPrice'),
});
const FRANKFURTER: Source = {
  name: 'Frankfurter',
  source: 'frankfurter',
  url: 'https://api.frankfurter.dev/v1/latest?base=USD&symbols=ILS',
  read: (json) => pick(json, 'rates', 'ILS'),
};
const OPEN_ER_API: Source = {
  name: 'open.er-api.com',
  source: 'open-er-api',
  url: 'https://open.er-api.com/v6/latest/USD',
  read: (json) => {
    const result = pick(json, 'result');
    return result === undefined || result === 'success' ? pick(json, 'rates', 'ILS') : undefined;
  },
};

/**
 * Fetch the USD/ILS rate (ILS per 1 USD). Tries Yahoo via local proxy (unless priceProvider is
 * 'finnhub' or 'manual'), then Frankfurter, then open.er-api. Never throws.
 */
export async function fetchUsdIls(
  settings: Settings,
  fetchImpl: FetchFn = defaultFetch,
  now: () => Date = () => new Date(),
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<{ quote: FxQuote } | { error: string }> {
  const sources =
    settings.priceProvider === 'finnhub' || settings.priceProvider === 'manual'
      ? [FRANKFURTER, OPEN_ER_API]
      : [yahoo(settings.yahooProxyUrl), FRANKFURTER, OPEN_ER_API];

  for (const s of sources) {
    const r = await getJson(fetchImpl, s.url, timeoutMs);
    if (!r.ok || r.status < 200 || r.status >= 300) continue;
    const rate = positiveNumber(s.read(r.json));
    if (rate !== null && rate > MIN_RATE && rate < MAX_RATE) {
      return { quote: { usdIls: rate, asOf: now().toISOString(), source: s.source } };
    }
  }
  return {
    error: `couldn't get the USD/ILS rate (tried ${sources.map((s) => s.name).join(', ')}). You can type it in yourself.`,
  };
}
