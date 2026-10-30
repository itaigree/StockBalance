import type { Category } from '../types';

/**
 * A category's targets with duplicate tickers merged (percents summed) and non-positive or invalid
 * percents dropped, in first-appearance order. A ticker keeps the group of its first appearance.
 */
export function mergedTargets(category: Pick<Category, 'targets'>): { ticker: string; percent: number; group?: string }[] {
  const merged = new Map<string, { percent: number; group?: string }>();
  for (const t of category.targets) {
    if (!(Number.isFinite(t.percent) && t.percent > 0)) continue;
    const m = merged.get(t.ticker);
    if (m) m.percent += t.percent;
    else merged.set(t.ticker, { percent: t.percent, ...(t.group ? { group: t.group } : {}) });
  }
  return [...merged].map(([ticker, m]) => ({ ticker, ...m }));
}

/** Sum of a category's (merged, positive) target percents. */
export function targetSum(category: Pick<Category, 'targets'>): number {
  return mergedTargets(category).reduce((a, t) => a + t.percent, 0);
}

/**
 * True when a total is more than 0.01 away from what it should be, as typed: 99.99 and 100.01 are
 * within it, whatever the float sum gives. The category editor and the planner use the same rule.
 */
export function offBy001(total: number, expected: number): boolean {
  return Math.abs(total - expected) > 0.01 + 1e-9;
}

/** True when the targets add up to 100% (±0.01). */
export function targetsAddUp(category: Pick<Category, 'targets'>): boolean {
  return !offBy001(targetSum(category), 100);
}

/** A valid price (finite and > 0) or null. */
export function validPrice(prices: Record<string, number>, ticker: string): number | null {
  const p = prices[ticker];
  return Number.isFinite(p) && p > 0 ? p : null;
}
