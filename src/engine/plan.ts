import type { Category } from '../types';
import { fmtIls, fmtPercent } from '../lib/format';
import { mergedTargets, validPrice } from './targets';
import type { CategoryPlan, PlanInput, PlanOptions, PlanResult, PlannedBuy, PlannedOrder } from './types';
import { valueCategory } from './valuation';
import { waterfill } from './waterfill';

const EPS = 1e-9;
/** Dollars of slack when flooring an order to whole shares (absorbs floating-point noise). */
const FLOOR_SLACK_USD = 1e-7;
const MAX_ITERATIONS = 10_000;

/** A category prepared for planning. */
interface Cat {
  category: Category;
  budgetUsd: number;
  /** Target fraction per ticker (weights > 0, summing to 1). */
  weights: Map<string, number>;
  /** Current value (USD) of each target ticker. */
  values: Map<string, number>;
  /** Value after investing the whole budget: all priced holdings + budget (T_c). */
  total: number;
}

/** Per category: ticker → dollars (ideal buys) or ticker → shares (rounded buys). */
type PerCat = Map<string, number>[];

/** Compute what to buy. See docs/DESIGN.md, "The allocation algorithm". */
export function planPurchase(input: PlanInput): PlanResult {
  const { categories, prices, usdIls, fxFeePercent, budgetsIls, options } = input;
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!(Number.isFinite(usdIls) && usdIls > 0)) errors.push('The USD/ILS exchange rate is missing or invalid.');
  if (!(Number.isFinite(fxFeePercent) && fxFeePercent >= 0)) errors.push('The currency conversion fee must be 0 or more.');
  if (options.maxTickers !== null && !(Number.isInteger(options.maxTickers) && options.maxTickers >= 1)) {
    errors.push('"Max different stocks" must be a whole number of at least 1, or empty for no limit.');
  }
  if (!(Number.isFinite(options.minOrderUsd) && options.minOrderUsd >= 0)) {
    errors.push('The minimum order must be 0 or more.');
  }
  const rate = usdIls * (1 + fxFeePercent / 100);

  const budgetsIlsList = categories.map((c) => {
    const b = budgetsIls[c.id] ?? 0;
    if (Number.isFinite(b) && b >= 0) return b;
    errors.push(`${c.name}: the amount to invest must be 0 or more.`);
    return 0;
  });
  const before = categories.map((c) => valueCategory(c, prices));

  categories.forEach((c, i) => {
    if (budgetsIlsList[i] <= 0) return;
    if (before[i].missingPrices.length > 0) {
      errors.push(`${c.name}: no price for ${before[i].missingPrices.join(', ')}. Enter the price or refresh prices.`);
    }
    const targets = mergedTargets(c);
    const sum = targets.reduce((a, t) => a + t.percent, 0);
    if (targets.length === 0) {
      warnings.push(`${c.name} has no target stocks, so its ${fmtIls(budgetsIlsList[i])} stays as cash.`);
    } else if (Math.abs(sum - 100) > 0.01) {
      warnings.push(`${c.name}: the targets add up to ${fmtPercent(sum)}, so they were scaled to 100%.`);
    }
  });

  if (errors.length > 0) {
    return {
      orders: [],
      categories: categories.map((c, i) => ({
        categoryId: c.id,
        budgetIls: budgetsIlsList[i],
        budgetUsd: Number.isFinite(rate) && rate > 0 ? budgetsIlsList[i] / rate : 0,
        buys: [],
        spentUsd: 0,
        spentIls: 0,
        leftoverIls: budgetsIlsList[i],
        before: before[i],
        after: before[i],
      })),
      totals: { budgetIls: sum(budgetsIlsList), spentUsd: 0, spentIls: 0, leftoverIls: sum(budgetsIlsList) },
      warnings,
      errors,
    };
  }

  const cats: Cat[] = categories.map((c, i) => {
    const budgetUsd = budgetsIlsList[i] / rate;
    const targets = mergedTargets(c);
    const tsum = targets.reduce((a, t) => a + t.percent, 0);
    const weights = new Map(targets.map((t) => [t.ticker, t.percent / tsum]));
    const values = new Map(targets.map((t) => [t.ticker, (c.holdings[t.ticker] ?? 0) * (validPrice(prices, t.ticker) ?? 0)]));
    return { category: c, budgetUsd, weights, values, total: before[i].investedUsd + budgetUsd };
  });

  const price = (t: string) => prices[t];
  const wholeShares = options.wholeShares;

  // Tickers that may be bought. Order limits drop tickers for one round; `banned` drops them for good.
  const candidates = new Set<string>();
  for (const c of cats) if (c.budgetUsd > 0) for (const t of c.weights.keys()) candidates.add(t);
  const banned = new Set<string>();
  /** Tickers left out because of the order limits (for the warning). */
  let skipped = new Set<string>();

  let shares: PerCat = cats.map(() => new Map());
  let orderShares = new Map<string, number>();
  for (let outer = 0; outer <= MAX_ITERATIONS; outer++) {
    if (outer === MAX_ITERATIONS) throw new Error('planPurchase did not converge');
    const allowed = new Set([...candidates].filter((t) => !banned.has(t)));
    const dropped = new Set<string>();
    const ideal = applyOrderLimits(cats, allowed, options, dropped, price);
    ({ shares, orderShares } = roundOrders(cats, ideal, price, wholeShares));
    if (wholeShares) topUp(cats, allowed, shares, orderShares, price, options);

    // Rounding can leave an order below the minimum: ban the smallest such ticker and start over.
    // (With fractional shares, flooring to 1e-6 of a share may shave off a fraction of a cent.)
    const tooSmall = [...orderShares]
      .map(([t, n]) => ({ t, cost: n * price(t) }))
      .filter(({ t, cost }) => cost < options.minOrderUsd - EPS - (wholeShares ? 0 : price(t) * 1e-6))
      .sort((a, b) => a.cost - b.cost || a.t.localeCompare(b.t));
    if (tooSmall.length > 0) {
      banned.add(tooSmall[0].t);
      skipped.add(tooSmall[0].t);
      continue;
    }

    // A ticker that kept its place under the limits but couldn't buy even one share wastes that
    // place: ban it and give the dropped tickers another chance.
    if (wholeShares && dropped.size > 0) {
      const wasted = [...totalsByTicker(ideal)].filter(([t, x]) => x > EPS && !orderShares.has(t)).map(([t]) => t);
      if (wasted.length > 0) {
        for (const t of wasted) banned.add(t);
        continue;
      }
    }
    skipped = new Set([...skipped, ...dropped]);
    break;
  }

  const orders: PlannedOrder[] = [...orderShares]
    .map(([ticker, n]) => ({ ticker, shares: n, priceUsd: price(ticker), costUsd: n * price(ticker) }))
    .sort((a, b) => b.costUsd - a.costUsd || a.ticker.localeCompare(b.ticker));

  const skippedNow = [...skipped].filter((t) => !orderShares.has(t)).sort();
  if (skippedNow.length > 0) {
    warnings.push(
      `To keep your orders few and not too small, these stocks were skipped this time: ${skippedNow.join(', ')}.`,
    );
  }

  const categoryPlans: CategoryPlan[] = cats.map((c, i) => {
    const buys: PlannedBuy[] = [...shares[i]]
      .filter(([, n]) => n > EPS * EPS)
      .map(([ticker, n]) => ({ ticker, shares: n, costUsd: n * price(ticker) }))
      .sort((a, b) => b.costUsd - a.costUsd || a.ticker.localeCompare(b.ticker));
    const spentUsd = sum(buys.map((b) => b.costUsd));
    const spentIls = spentUsd * rate;
    let leftoverIls = budgetsIlsList[i] - spentIls;
    if (leftoverIls < 0 && leftoverIls > -1e-6) leftoverIls = 0;

    if (budgetsIlsList[i] > 0 && buys.length === 0 && c.weights.size > 0) {
      warnings.push(
        `${c.category.name}: ${fmtIls(budgetsIlsList[i])} stays as cash for next time — it isn't enough for a share or an order this time.`,
      );
    }

    const holdings = { ...c.category.holdings };
    for (const b of buys) holdings[b.ticker] = (holdings[b.ticker] ?? 0) + b.shares;
    return {
      categoryId: c.category.id,
      budgetIls: budgetsIlsList[i],
      budgetUsd: c.budgetUsd,
      buys,
      spentUsd,
      spentIls,
      leftoverIls,
      before: before[i],
      after: valueCategory({ ...c.category, holdings }, prices),
    };
  });

  const spentUsd = sum(categoryPlans.map((c) => c.spentUsd));
  return {
    orders,
    categories: categoryPlans,
    totals: {
      budgetIls: sum(budgetsIlsList),
      spentUsd,
      spentIls: spentUsd * rate,
      leftoverIls: sum(categoryPlans.map((c) => c.leftoverIls)),
    },
    warnings,
    errors: [],
  };
}

/** Step 1: ideal dollar buys per category over the allowed tickers. */
function idealBuys(cats: Cat[], allowed: Set<string>): PerCat {
  return cats.map((c) => {
    const out = new Map<string, number>();
    if (!(c.budgetUsd > 0)) return out;
    const tickers = [...c.weights.keys()].filter((t) => allowed.has(t));
    const amounts = waterfill(
      tickers.map((t) => c.values.get(t)!),
      tickers.map((t) => c.weights.get(t)!),
      c.budgetUsd,
      c.total,
    );
    tickers.forEach((t, i) => amounts[i] > 0 && out.set(t, amounts[i]));
    return out;
  });
}

function totalsByTicker(perCat: PerCat): Map<string, number> {
  const totals = new Map<string, number>();
  for (const m of perCat) for (const [t, x] of m) totals.set(t, (totals.get(t) ?? 0) + x);
  return totals;
}

/**
 * Step 2: recompute the ideal buys, removing the smallest ticker while there are more tickers than
 * `maxTickers` or some ticker's combined order is below `minOrderUsd`. Mutates `allowed`; removed
 * tickers are added to `dropped`. With whole shares, a ticker whose single share already meets the
 * minimum is not removed here: its order is either 0 or at least one share, checked after rounding.
 */
function applyOrderLimits(
  cats: Cat[],
  allowed: Set<string>,
  options: PlanOptions,
  dropped: Set<string>,
  price: (t: string) => number,
): PerCat {
  const min = options.minOrderUsd;
  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const ideal = idealBuys(cats, allowed);
    const active = [...totalsByTicker(ideal)]
      .filter(([, x]) => x > EPS)
      .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]));
    let victim: [string, number] | undefined;
    if (options.maxTickers !== null && active.length > options.maxTickers) victim = active[0];
    else if (min > 0) {
      victim = active.find(([t, x]) => x < min - EPS && (!options.wholeShares || price(t) < min - EPS));
    }
    if (!victim) return ideal;
    dropped.add(victim[0]);
    allowed.delete(victim[0]);
  }
  throw new Error('order limits did not converge');
}

/**
 * Step 3a: round each combined order down (whole shares, or 1e-6 share) and split its shares
 * between categories in proportion to their ideal dollar amounts.
 */
function roundOrders(
  cats: Cat[],
  ideal: PerCat,
  price: (t: string) => number,
  wholeShares: boolean,
): { shares: PerCat; orderShares: Map<string, number> } {
  const shares: PerCat = cats.map(() => new Map());
  const orderShares = new Map<string, number>();
  for (const [t, total] of totalsByTicker(ideal)) {
    if (total <= EPS) continue;
    const exact = (total + FLOOR_SLACK_USD) / price(t);
    const n = wholeShares ? Math.floor(exact) : Math.floor(exact * 1e6) / 1e6;
    if (n <= 0) continue;
    orderShares.set(t, n);
    ideal.forEach((m, i) => {
      const x = m.get(t);
      if (x) shares[i].set(t, (n * x) / total);
    });
  }
  return { shares, orderShares };
}

/**
 * Step 3b (whole shares): spend leftovers on one more share at a time, choosing the share that
 * reduces the balance objective the most, until no extra share helps. Mutates `shares` and
 * `orderShares`.
 */
function topUp(
  cats: Cat[],
  allowed: Set<string>,
  shares: PerCat,
  orderShares: Map<string, number>,
  price: (t: string) => number,
  options: PlanOptions,
): void {
  const leftover = cats.map((c, i) => {
    let spent = 0;
    for (const [t, n] of shares[i]) spent += n * price(t);
    return c.budgetUsd - spent;
  });
  const valueNow = (i: number, t: string) => cats[i].values.get(t)! + (shares[i].get(t) ?? 0) * price(t);
  const candidates = [...allowed].sort();

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    let best: { t: string; payers: number[]; pay: number[]; delta: number } | null = null;
    for (const t of candidates) {
      const p = price(t);
      const current = orderShares.get(t) ?? 0;
      if (current === 0 && options.maxTickers !== null && orderShares.size >= options.maxTickers) continue;
      if ((current + 1) * p < options.minOrderUsd - EPS) continue;

      // Only categories still below their target for t pay, and each at most 2 × its gap, so no
      // category ends further from its target than before (its own a·(a − 2·gap) stays ≤ 0).
      const gapOf = (i: number) => cats[i].weights.get(t)! * cats[i].total - valueNow(i, t);
      const payers = cats
        .map((_, i) => i)
        .filter((i) => cats[i].weights.has(t) && leftover[i] > EPS && gapOf(i) > EPS);
      const gaps = payers.map(gapOf);
      const caps = payers.map((i, k) => Math.min(leftover[i], 2 * gaps[k]));
      if (sum(caps) < p - EPS) continue;

      const pay = splitCost(p, gaps, caps);
      // Change in Σ (v − g)² / w for each payer: a·(a − 2·gap) / w.
      const delta = sum(payers.map((i, k) => (pay[k] * (pay[k] - 2 * gaps[k])) / cats[i].weights.get(t)!));
      if (delta < -EPS && (!best || delta < best.delta)) best = { t, payers, pay, delta };
    }
    if (!best) return;

    const p = price(best.t);
    orderShares.set(best.t, (orderShares.get(best.t) ?? 0) + 1);
    best.payers.forEach((i, k) => {
      shares[i].set(best.t, (shares[i].get(best.t) ?? 0) + best.pay[k] / p);
      leftover[i] -= best.pay[k];
    });
  }
}

/**
 * Split `amount` between payers: first in proportion to `needs`, then (for what's still uncovered)
 * in proportion to the remaining capacity; nobody pays more than their cap.
 */
function splitCost(amount: number, needs: number[], caps: number[]): number[] {
  const first = cappedProportional(amount, needs, caps);
  const rest = amount - sum(first);
  if (rest <= 0) return first;
  const room = caps.map((c, i) => c - first[i]);
  const second = cappedProportional(rest, room, room);
  return first.map((x, i) => x + second[i]);
}

/** Distribute `amount` in proportion to `weights`, never giving anyone more than their cap. */
function cappedProportional(amount: number, weights: number[], caps: number[]): number[] {
  const out = weights.map(() => 0);
  let active = weights.map((_, i) => i).filter((i) => weights[i] > 0 && caps[i] > 0);
  let remaining = amount;
  while (remaining > 0 && active.length > 0) {
    const w = sum(active.map((i) => weights[i]));
    const full = active.filter((i) => out[i] + (remaining * weights[i]) / w >= caps[i]);
    if (full.length === 0) {
      for (const i of active) out[i] += (remaining * weights[i]) / w;
      return out;
    }
    for (const i of full) {
      remaining -= caps[i] - out[i];
      out[i] = caps[i];
    }
    active = active.filter((i) => !full.includes(i));
  }
  return out;
}

function sum(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0);
}

/** Exposed for tests: the balance objective E of a set of categories after buying `shares`. */
export function balanceObjective(input: PlanInput, buys: Record<string, Record<string, number>>): number {
  const rate = input.usdIls * (1 + input.fxFeePercent / 100);
  let e = 0;
  for (const c of input.categories) {
    const targets = mergedTargets(c);
    const tsum = targets.reduce((a, t) => a + t.percent, 0);
    if (tsum <= 0) continue;
    const v = valueCategory(c, input.prices);
    const total = v.investedUsd + (input.budgetsIls[c.id] ?? 0) / rate;
    for (const t of targets) {
      const w = t.percent / tsum;
      const value = ((c.holdings[t.ticker] ?? 0) + (buys[c.id]?.[t.ticker] ?? 0)) * input.prices[t.ticker];
      e += (value - w * total) ** 2 / w;
    }
  }
  return e;
}
