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

/**
 * "Fewest orders" filling (see docs/DESIGN.md): the position furthest below its target value gets
 * money first, up to its target, then the next one, until the budget runs out. Positions at or
 * above target get nothing; ties go to the earlier position. Positions can share a cap (`shared.of[i]`
 * is an index into `shared.caps`, e.g. a group of stocks that together may only fill its own gap):
 * such a position counts as only as far below target as that cap still allows. Returns the amount
 * for each position.
 */
export function fillLargestGapFirst(
  values: number[],
  targets: number[],
  budget: number,
  shared?: { of: (number | undefined)[]; caps: number[] },
): number[] {
  const out = values.map(() => 0);
  const room = values.map((v, i) => targets[i] - v);
  const caps = shared ? [...shared.caps] : [];
  const free = (i: number) => {
    const s = shared?.of[i];
    return s === undefined ? room[i] : Math.min(room[i], caps[s]);
  };
  let left = budget;
  // Stop at floating-point crumbs, so they don't start another position.
  while (left > 1e-9) {
    let best = -1;
    for (let i = 0; i < values.length; i++) if (free(i) > 1e-9 && (best < 0 || free(i) > free(best))) best = i;
    if (best < 0) break;
    // Each pick fills the position (or its shared cap) or uses up the budget.
    const x = Math.min(left, free(best));
    out[best] += x;
    left -= x;
    room[best] -= x;
    const s = shared?.of[best];
    if (s !== undefined) caps[s] -= x;
  }
  return out;
}
