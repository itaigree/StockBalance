import type { AppData } from '../types';
import { CATEGORY_COLORS } from '../lib/ids';
import { DEFAULT_SETTINGS } from './schema';

/** Demo prices (USD); the app replaces them with live prices when it refreshes. */
const SAMPLE_PRICES: Record<string, number> = { VOO: 560, VXUS: 65, BND: 73, QQQ: 550, GLD: 300, AAPL: 230 };

/**
 * Realistic demo data: three categories (Pension, Kids, Investments) with overlapping tickers
 * (VOO is in all three), some prices and an FX rate, so every screen can be tried.
 */
export function sampleData(now: Date = new Date()): AppData {
  const asOf = now.toISOString();
  return {
    version: 1,
    categories: [
      {
        id: 'sample-pension',
        name: 'Pension',
        color: CATEGORY_COLORS[0],
        targets: [
          { ticker: 'VOO', percent: 60 },
          { ticker: 'VXUS', percent: 25 },
          { ticker: 'BND', percent: 15 },
        ],
        holdings: { VOO: 40, VXUS: 150, BND: 60 },
        cashIls: 0,
        contribution: { kind: 'percent', percent: 70 },
        notes: 'Long term. Gets 70% of what is left after the kids.',
      },
      {
        id: 'sample-kids',
        name: 'Kids',
        color: CATEGORY_COLORS[1],
        targets: [
          { ticker: 'VOO', percent: 80 },
          { ticker: 'BND', percent: 20 },
        ],
        holdings: { VOO: 3.5, BND: 5 },
        cashIls: 250,
        contribution: { kind: 'fixed', amountIls: 1000 },
      },
      {
        id: 'sample-investments',
        name: 'Investments',
        color: CATEGORY_COLORS[2],
        targets: [
          { ticker: 'QQQ', percent: 50 },
          { ticker: 'VOO', percent: 30 },
          { ticker: 'GLD', percent: 20 },
        ],
        holdings: { QQQ: 8, VOO: 4, GLD: 6, AAPL: 5 },
        cashIls: 0,
        contribution: { kind: 'remainder' },
        notes: 'AAPL is an old purchase: kept, but not bought any more.',
      },
    ],
    prices: Object.fromEntries(
      Object.entries(SAMPLE_PRICES).map(([t, priceUsd]) => [t, { priceUsd, asOf, source: 'manual' as const }]),
    ),
    fx: { usdIls: 3.7, asOf, source: 'manual' },
    settings: { ...DEFAULT_SETTINGS },
    transactions: [],
  };
}
