/**
 * Split `total` in proportion to `weights`, rounded to `decimals` places, so that the parts add up
 * exactly to `total` (rounded to the same precision). Uses largest-remainder rounding; ties go to
 * the earlier index. Negative or non-finite weights count as 0. All-zero weights → all zeros.
 */
export function apportion(total: number, weights: number[], decimals: number): number[] {
  const scale = 10 ** decimals;
  const units = Math.round(total * scale);
  const w = weights.map((x) => (Number.isFinite(x) && x > 0 ? x : 0));
  const sum = w.reduce((a, b) => a + b, 0);
  if (sum <= 0 || units === 0) return w.map(() => 0);

  const raw = w.map((x) => (units * x) / sum);
  const floors = raw.map((x) => Math.floor(x));
  let remaining = units - floors.reduce((a, b) => a + b, 0);
  const order = raw
    .map((x, i) => ({ i, frac: x - floors[i] }))
    .filter(({ i }) => w[i] > 0)
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; remaining > 0 && order.length > 0; k = (k + 1) % order.length, remaining--) {
    floors[order[k].i] += 1;
  }
  return floors.map((x) => x / scale);
}
