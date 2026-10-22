import type { AppData, Settings } from '../types';

export const DEFAULT_SETTINGS: Settings = {
  priceProvider: 'auto',
  finnhubApiKey: '',
  fxFeePercent: 0,
  wholeShares: true,
  minOrderUsd: 0,
  maxTickersPerPurchase: null,
};

export function emptyData(): AppData {
  return { version: 1, categories: [], prices: {}, fx: null, settings: { ...DEFAULT_SETTINGS }, transactions: [] };
}

export type ParseResult = { ok: true; data: AppData } | { ok: false; error: string };

/**
 * Validate (and, for older versions, migrate) untrusted data — from localStorage or an imported
 * backup file — into AppData. Missing optional fields get defaults; tickers are normalised to
 * upper case. Returns a human-readable error when the data can't be used.
 */
export function parseAppData(raw: unknown): ParseResult {
  void raw;
  throw new Error('not implemented');
}
