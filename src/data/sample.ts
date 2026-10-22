import type { AppData } from '../types';

/**
 * Realistic demo data: three categories (Pension, Kids, Investments) with overlapping tickers
 * (e.g. VOO in two categories), some prices and an FX rate, so every screen can be tried.
 */
export function sampleData(now: Date = new Date()): AppData {
  void now;
  throw new Error('not implemented');
}
