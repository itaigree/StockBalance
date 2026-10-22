import type { PriceQuote, Settings } from '../types';

export interface FetchPricesResult {
  /** Successfully fetched quotes by ticker. */
  quotes: Record<string, PriceQuote>;
  /** Human-readable reason per ticker that could not be fetched. */
  failures: Record<string, string>;
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
  fetchImpl: typeof fetch = fetch,
  now: () => Date = () => new Date(),
): Promise<FetchPricesResult> {
  void tickers;
  void settings;
  void fetchImpl;
  void now;
  throw new Error('not implemented');
}
