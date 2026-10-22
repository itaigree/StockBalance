import type { FxQuote, Settings } from '../types';

/**
 * Fetch the USD/ILS rate (ILS per 1 USD). Tries Yahoo via local proxy (unless priceProvider is
 * 'finnhub' or 'manual'), then Frankfurter, then open.er-api. Never throws.
 */
export async function fetchUsdIls(
  settings: Settings,
  fetchImpl: typeof fetch = fetch,
  now: () => Date = () => new Date(),
): Promise<{ quote: FxQuote } | { error: string }> {
  void settings;
  void fetchImpl;
  void now;
  throw new Error('not implemented');
}
