/**
 * Ratio water-filling (see docs/DESIGN.md, step 1).
 *
 * Spends `budget` over positions with current values `values` and target fractions `weights`, so
 * that every position that receives money ends at the same ratio value / weight (the "level"), and
 * positions already above that level get nothing. This is the buy-only allocation that minimises
 * Σ (value − weight·total)² / weight. Positions with weight ≤ 0 get nothing.
 *
 * The level never goes above `maxLevel`: with weights that are fractions of a category's full target
 * set and `maxLevel` = the category's total value after investing, no position is pushed above its
 * target value. Money that can't be placed then stays unspent.
 *
 * Returns the amount for each position (same order); the amounts add up to `budget` when at least
 * one weight is positive, the budget is positive and the level cap isn't reached.
 */
export function waterfill(values: number[], weights: number[], budget: number, maxLevel = Infinity): number[] {
  const out = values.map(() => 0);
  if (!(budget > 0)) return out;

  const idx = values
    .map((_, i) => i)
    .filter((i) => weights[i] > 0)
    .sort((a, b) => values[a] / weights[a] - values[b] / weights[b] || a - b);
  if (idx.length === 0) return out;

  // Add positions in order of increasing ratio until the level no longer reaches the next one.
  let sumV = 0;
  let sumW = 0;
  let level = 0;
  let k = 0;
  while (k < idx.length) {
    sumV += values[idx[k]];
    sumW += weights[idx[k]];
    level = (budget + sumV) / sumW;
    k++;
    const next = k < idx.length ? values[idx[k]] / weights[idx[k]] : Infinity;
    if (level <= next) break;
  }
  if (level > maxLevel) {
    level = maxLevel;
    while (k > 0 && values[idx[k - 1]] / weights[idx[k - 1]] >= level) k--;
  }

  for (let j = 0; j < k; j++) {
    const i = idx[j];
    out[i] = Math.max(0, weights[i] * level - values[i]);
  }
  return out;
}
