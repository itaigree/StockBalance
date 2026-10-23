import type { Category } from '../types';

/**
 * A category's targets with duplicate tickers merged (percents summed) and non-positive or invalid
 * percents dropped, in first-appearance order. `sum` is the total of the remaining percents.
 */
export function mergedTargets(category: Pick<Category, 'targets'>): { ticker: string; percent: number }[] {
  const merged = new Map<string, number>();
  for (const t of category.targets) {
    if (!(Number.isFinite(t.percent) && t.percent > 0)) continue;
    merged.set(t.ticker, (merged.get(t.ticker) ?? 0) + t.percent);
  }
  return [...merged].map(([ticker, percent]) => ({ ticker, percent }));
}

/** Sum of a category's (merged, positive) target percents. */
export function targetSum(category: Pick<Category, 'targets'>): number {
  return mergedTargets(category).reduce((a, t) => a + t.percent, 0);
}

/** True when the targets add up to 100% (±0.01). */
export function targetsAddUp(category: Pick<Category, 'targets'>): boolean {
  return Math.abs(targetSum(category) - 100) <= 0.01;
}

/** A valid price (finite and > 0) or null. */
export function validPrice(prices: Record<string, number>, ticker: string): number | null {
  const p = prices[ticker];
  return Number.isFinite(p) && p > 0 ? p : null;
}
