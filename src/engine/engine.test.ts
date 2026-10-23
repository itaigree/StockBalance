import { describe, expect, it } from 'vitest';
import type { Category, ContributionRule } from '../types';
import { apportion } from './apportion';
import { applyTransaction, revertTransaction, transactionFromPlan } from './ledger';
import { planPurchase } from './plan';
import { splitContribution } from './split';
import type { PlanInput, PlanOptions } from './types';
import { valueCategory } from './valuation';
import { waterfill } from './waterfill';

function cat(
  id: string,
  targets: Record<string, number>,
  holdings: Record<string, number> = {},
  extra: Partial<Category> = {},
): Category {
  return {
    id,
    name: id,
    color: '#000',
    targets: Object.entries(targets).map(([ticker, percent]) => ({ ticker, percent })),
    holdings,
    cashIls: 0,
    contribution: { kind: 'none' },
    ...extra,
  };
}

const NO_LIMITS: PlanOptions = { wholeShares: false, minOrderUsd: 0, maxTickers: null };

/** A plan input where 1 USD = 1 ILS, so budgets read as dollars. */
function input(categories: Category[], prices: Record<string, number>, budgets: Record<string, number>, options: Partial<PlanOptions> = {}): PlanInput {
  return { categories, prices, usdIls: 1, fxFeePercent: 0, budgetsIls: budgets, options: { ...NO_LIMITS, ...options } };
}

const sharesOf = (plan: ReturnType<typeof planPurchase>, categoryId: string) =>
  Object.fromEntries(plan.categories.find((c) => c.categoryId === categoryId)!.buys.map((b) => [b.ticker, b.shares]));
const orderMap = (plan: ReturnType<typeof planPurchase>) => Object.fromEntries(plan.orders.map((o) => [o.ticker, o.shares]));

describe('apportion', () => {
  it('splits so the parts add up exactly', () => {
    expect(apportion(10, [1, 1, 1], 2)).toEqual([3.34, 3.33, 3.33]);
    expect(apportion(1, [1, 2], 6)).toEqual([0.333333, 0.666667]);
    expect(apportion(5, [0, 3, 0], 0)).toEqual([0, 5, 0]);
  });

  it('returns zeros for zero weights', () => {
    expect(apportion(10, [0, 0], 2)).toEqual([0, 0]);
    expect(apportion(10, [], 2)).toEqual([]);
  });
});

describe('waterfill', () => {
  it('splits by weight when starting from nothing', () => {
    expect(waterfill([0, 0], [0.6, 0.4], 1000)).toEqual([600, 400]);
  });

  it('fills under-weight positions proportionally and skips over-weight ones', () => {
    // Targets 50/40/10, first one already at 700 of a final 1000 → the other two end at the same ratio.
    const x = waterfill([700, 0, 0], [0.5, 0.4, 0.1], 300);
    expect(x[0]).toBe(0);
    expect(x[1]).toBeCloseTo(240);
    expect(x[2]).toBeCloseTo(60);
  });

  it('reaches the targets exactly when the budget covers all gaps', () => {
    const x = waterfill([100, 300], [0.5, 0.5], 200);
    expect(x[0]).toBeCloseTo(200);
    expect(x[1]).toBeCloseTo(0);
  });

  it('never pushes a position above maxLevel', () => {
    // Only the over-weight position is allowed: nothing should be bought.
    expect(waterfill([900], [0.5], 100, 1000)).toEqual([0]);
    // Capped at the target value 0.5 × 1000 = 500.
    expect(waterfill([400], [0.5], 300, 1000)[0]).toBeCloseTo(100);
  });

  it('handles no budget and no weights', () => {
    expect(waterfill([1, 2], [0.5, 0.5], 0)).toEqual([0, 0]);
    expect(waterfill([1, 2], [0, 0], 100)).toEqual([0, 0]);
  });
});

describe('splitContribution', () => {
  const c = (id: string, contribution: ContributionRule) => ({ id, name: id, contribution });

  it('takes fixed amounts first, then percents of the rest, then the remainder', () => {
    const r = splitContribution(10000, [
      c('kids', { kind: 'fixed', amountIls: 1000 }),
      c('pension', { kind: 'percent', percent: 70 }),
      c('invest', { kind: 'remainder' }),
      c('other', { kind: 'none' }),
    ]);
    expect(r.amounts).toEqual({ kids: 1000, pension: 6300, invest: 2700, other: 0 });
    expect(r.unassignedIls).toBe(0);
    expect(r.warnings).toEqual([]);
  });

  it('scales fixed amounts down when they exceed the total', () => {
    const r = splitContribution(1000, [
      c('a', { kind: 'fixed', amountIls: 1500 }),
      c('b', { kind: 'fixed', amountIls: 500 }),
      c('c', { kind: 'remainder' }),
    ]);
    expect(r.amounts).toEqual({ a: 750, b: 250, c: 0 });
    expect(r.warnings).toHaveLength(1);
  });

  it('scales percents down when they add up to more than 100', () => {
    const r = splitContribution(1000, [c('a', { kind: 'percent', percent: 150 }), c('b', { kind: 'percent', percent: 50 })]);
    expect(r.amounts).toEqual({ a: 750, b: 250 });
    expect(r.warnings).toHaveLength(1);
  });

  it('reports money that no category receives', () => {
    const r = splitContribution(1000, [c('a', { kind: 'percent', percent: 60 })]);
    expect(r.amounts).toEqual({ a: 600 });
    expect(r.unassignedIls).toBe(400);
    expect(r.warnings[0]).toMatch(/isn't assigned/);
  });

  it('rounds to agorot and still adds up exactly', () => {
    const r = splitContribution(100, [c('a', { kind: 'remainder' }), c('b', { kind: 'remainder' }), c('c', { kind: 'remainder' })]);
    expect(r.amounts).toEqual({ a: 33.34, b: 33.33, c: 33.33 });
  });

  it('rejects a negative total', () => {
    const r = splitContribution(-5, [c('a', { kind: 'remainder' })]);
    expect(r.amounts).toEqual({ a: 0 });
    expect(r.warnings).toHaveLength(1);
  });
});

describe('valueCategory', () => {
  it('lists targets first, then other holdings, with weights and differences', () => {
    const v = valueCategory(cat('c', { VOO: 60, BND: 40 }, { BND: 10, AAPL: 2, VOO: 6 }), { VOO: 100, BND: 50, AAPL: 100 });
    expect(v.investedUsd).toBe(600 + 500 + 200);
    expect(v.positions.map((p) => p.ticker)).toEqual(['VOO', 'BND', 'AAPL']);
    expect(v.positions[0].weightPercent).toBeCloseTo((600 / 1300) * 100);
    expect(v.positions[0].diffPercent).toBeCloseTo((600 / 1300) * 100 - 60);
    expect(v.positions[2].targetPercent).toBe(0);
    expect(v.missingPrices).toEqual([]);
  });

  it('flags missing prices and treats an empty category as 0% everywhere', () => {
    const v = valueCategory(cat('c', { VOO: 50, BND: 50 }), { VOO: 100 });
    expect(v.missingPrices).toEqual(['BND']);
    expect(v.positions[0].weightPercent).toBe(0);
    expect(v.positions[1].weightPercent).toBeNull();
  });

  it('scales targets that do not add up to 100', () => {
    const v = valueCategory(cat('c', { A: 30, B: 30 }), { A: 1, B: 1 });
    expect(v.positions.map((p) => p.targetPercent)).toEqual([50, 50]);
  });
});

describe('planPurchase', () => {
  it('buys whole shares in target proportions', () => {
    const plan = planPurchase(input([cat('p', { VOO: 60, BND: 40 })], { VOO: 100, BND: 50 }, { p: 1000 }, { wholeShares: true }));
    expect(plan.errors).toEqual([]);
    expect(orderMap(plan)).toEqual({ VOO: 6, BND: 8 });
    expect(plan.totals.spentUsd).toBeCloseTo(1000);
    expect(plan.categories[0].leftoverIls).toBeCloseTo(0);
  });

  it('converts ILS to USD including the conversion fee', () => {
    const plan = planPurchase({
      ...input([cat('p', { VOO: 100 })], { VOO: 1 }, { p: 1000 }),
      usdIls: 4,
      fxFeePercent: 0.25,
    });
    expect(plan.categories[0].budgetUsd).toBeCloseTo(1000 / (4 * 1.0025));
    expect(plan.totals.spentIls).toBeCloseTo(plan.totals.spentUsd * 4 * 1.0025);
    expect(plan.totals.spentIls).toBeCloseTo(1000);
  });

  it('meets the targets exactly when the budget covers the gaps (fractional shares)', () => {
    const c = cat('p', { A: 50, B: 30, C: 20 }, { A: 5, B: 1 });
    const plan = planPurchase(input([c], { A: 100, B: 100, C: 100 }, { p: 400 }));
    const after = plan.categories[0].after.positions.map((p) => p.weightPercent);
    expect(after[0]).toBeCloseTo(50);
    expect(after[1]).toBeCloseTo(30);
    expect(after[2]).toBeCloseTo(20);
  });

  it('never buys over-weight or non-target stocks', () => {
    const c = cat('p', { VOO: 50, BND: 50 }, { VOO: 7, AAPL: 3 });
    const plan = planPurchase(input([c], { VOO: 100, BND: 100, AAPL: 100 }, { p: 300 }));
    expect(sharesOf(plan, 'p')).toEqual({ BND: 3 });
  });

  it('merges the same stock from several categories into one order', () => {
    const plan = planPurchase(
      input([cat('pension', { VOO: 100 }), cat('kids', { VOO: 100 })], { VOO: 500 }, { pension: 300, kids: 300 }, { wholeShares: true }),
    );
    // Neither category can afford a share alone; together they buy one and own half each.
    expect(plan.orders).toEqual([{ ticker: 'VOO', shares: 1, priceUsd: 500, costUsd: 500 }]);
    expect(sharesOf(plan, 'pension').VOO).toBeCloseTo(0.5);
    expect(sharesOf(plan, 'kids').VOO).toBeCloseTo(0.5);
    expect(plan.categories[0].leftoverIls).toBeCloseTo(50);
  });

  it('uses leftovers to buy the extra whole share that helps balance most', () => {
    const plan = planPurchase(input([cat('p', { A: 50, B: 50 })], { A: 30, B: 70 }, { p: 100 }, { wholeShares: true }));
    expect(orderMap(plan)).toEqual({ A: 1, B: 1 });
    expect(plan.totals.spentUsd).toBeCloseTo(100);
  });

  it('does not buy an extra share that would make the balance worse', () => {
    // 1 share of A ($90) and nothing else fits; a second share would overshoot the target badly.
    const plan = planPurchase(input([cat('p', { A: 50, B: 50 }, { B: 1 })], { A: 90, B: 100 }, { p: 150 }, { wholeShares: true }));
    expect(orderMap(plan)).toEqual({ A: 1 });
  });

  it('keeps leftover cash rather than overshooting a target with an affordable extra share', () => {
    // A reaches its 50% target exactly with 50 shares; B ($1,000) is unaffordable. Another A share
    // would only push A above target, so the remaining $500 stays as cash.
    const plan = planPurchase(input([cat('p', { A: 50, B: 50 })], { A: 10, B: 1000 }, { p: 1000 }, { wholeShares: true }));
    expect(orderMap(plan)).toEqual({ A: 50 });
    expect(plan.categories[0].leftoverIls).toBeCloseTo(500);
  });

  it('respects the maximum number of different stocks', () => {
    const c = cat('p', { A: 40, B: 35, C: 25 });
    const one = planPurchase(input([c], { A: 1, B: 1, C: 1 }, { p: 1000 }, { maxTickers: 1 }));
    expect(Object.keys(orderMap(one))).toEqual(['A']);
    // A alone can only take its target value: 40% of 1000.
    expect(one.orders[0].costUsd).toBeCloseTo(400);
    const two = planPurchase(input([c], { A: 1, B: 1, C: 1 }, { p: 1000 }, { maxTickers: 2 }));
    expect(Object.keys(orderMap(two)).sort()).toEqual(['A', 'B']);
    expect(two.warnings.join(' ')).toMatch(/skipped this time: C/);
  });

  it('skips orders below the minimum and moves their money to other stocks', () => {
    const c = cat('p', { A: 90, B: 10 }, { A: 0, B: 0 });
    const plan = planPurchase(input([c], { A: 1, B: 1 }, { p: 1000 }, { minOrderUsd: 200 }));
    expect(Object.keys(orderMap(plan))).toEqual(['A']);
    expect(plan.orders[0].costUsd).toBeCloseTo(900);
    expect(plan.categories[0].leftoverIls).toBeCloseTo(100);
  });

  it('keeps a category’s money as cash when all its stocks are skipped', () => {
    const plan = planPurchase(
      input([cat('big', { A: 100 }), cat('small', { B: 100 })], { A: 10, B: 10 }, { big: 1000, small: 50 }, { minOrderUsd: 100 }),
    );
    expect(Object.keys(orderMap(plan))).toEqual(['A']);
    const small = plan.categories.find((c) => c.categoryId === 'small')!;
    expect(small.spentUsd).toBe(0);
    expect(small.leftoverIls).toBe(50);
    expect(plan.warnings.some((w) => w.startsWith('small:'))).toBe(true);
  });

  it('drops a whole-share order that rounding left below the minimum', () => {
    // Ideal: A $600, B $400. B at $300/share rounds to 1 share = $300 < $350 minimum.
    const plan = planPurchase(input([cat('p', { A: 60, B: 40 })], { A: 10, B: 300 }, { p: 1000 }, { wholeShares: true, minOrderUsd: 350 }));
    expect(plan.orders.every((o) => o.costUsd >= 350)).toBe(true);
    expect(orderMap(plan)).toEqual({ A: 60 });
  });

  // Found in review: the limits were decided on fractional amounts, before rounding to whole shares.
  it('gives a dropped stock another chance when the kept one cannot buy a single share', () => {
    const rate37 = (cats: Category[], prices: Record<string, number>, budgets: Record<string, number>, options: Partial<PlanOptions>) => ({
      ...input(cats, prices, budgets, { wholeShares: true, ...options }),
      usdIls: 3.7,
    });
    // VOO keeps the only slot but $500 can't buy a $550 share; BND can use the money instead.
    const a = planPurchase(rate37([cat('p', { VOO: 60, BND: 40 })], { VOO: 550, BND: 72 }, { p: 1850 }, { maxTickers: 1 }));
    expect(orderMap(a)).toEqual({ BND: 3 });
    expect(a.warnings.join(' ')).not.toMatch(/isn't enough/);

    const b = planPurchase(
      rate37([cat('p', { VOO: 40, VXUS: 30, BND: 30 })], { VOO: 550, VXUS: 65, BND: 72 }, { p: 2000 }, { maxTickers: 2 }),
    );
    expect(orderMap(b)).toEqual({ VXUS: 2, BND: 2 });
  });

  it('keeps a stock whose single share already meets the minimum order', () => {
    const plan = planPurchase(input([cat('p', { A: 90, B: 10 })], { A: 500, B: 150 }, { p: 900 }, { wholeShares: true, minOrderUsd: 100 }));
    expect(orderMap(plan)).toEqual({ A: 1, B: 1 });
  });

  it('never makes a category pay toward a stock it is already above target in', () => {
    const pension = cat('pension', { VOO: 100 });
    const kids = cat('kids', { VOO: 50, QQQ: 50 }, { VOO: 1 });
    const plan = planPurchase(input([pension, kids], { VOO: 500, QQQ: 480 }, { pension: 400, kids: 400 }, { wholeShares: true }));
    expect(sharesOf(plan, 'kids').VOO).toBeUndefined();
  });

  it('does not drop a fractional order for missing a fraction of a cent of the minimum', () => {
    const plan = planPurchase(input([cat('p', { VOO: 100 })], { VOO: 333.33 }, { p: 100 }, { minOrderUsd: 100 }));
    expect(plan.orders).toHaveLength(1);
    expect(plan.orders[0].costUsd).toBeCloseTo(100, 3);
  });

  it('returns errors instead of orders for invalid input', () => {
    const c = cat('p', { A: 100 });
    expect(planPurchase({ ...input([c], { A: 1 }, { p: 10 }), usdIls: 0 }).errors).toHaveLength(1);
    expect(planPurchase(input([c], {}, { p: 10 })).errors[0]).toMatch(/no price for A/);
    expect(planPurchase(input([c], { A: 1 }, { p: -1 })).errors).toHaveLength(1);
    expect(planPurchase(input([c], { A: 1 }, { p: 10 }, { maxTickers: 0 })).errors).toHaveLength(1);
    const bad = planPurchase(input([c], {}, { p: 10 }));
    expect(bad.orders).toEqual([]);
    expect(bad.categories[0].leftoverIls).toBe(10);
  });

  it('ignores missing prices in categories that get no money', () => {
    const plan = planPurchase(input([cat('a', { A: 100 }), cat('b', { B: 100 })], { A: 10 }, { a: 100, b: 0 }));
    expect(plan.errors).toEqual([]);
    expect(orderMap(plan)).toEqual({ A: 10 });
  });

  it('warns about a category without targets and targets that do not add up', () => {
    const plan = planPurchase(input([cat('a', {}), cat('b', { B: 50 })], { B: 10 }, { a: 100, b: 100 }));
    expect(plan.warnings.join(' ')).toMatch(/a has no target stocks/);
    expect(plan.warnings.join(' ')).toMatch(/b: the targets add up to 50.0%/);
    expect(plan.categories[0].leftoverIls).toBe(100);
  });
});

describe('ledger', () => {
  const categories = [
    cat('pension', { VOO: 100 }, { VOO: 2 }, { cashIls: 100 }),
    cat('kids', { VOO: 50, BND: 50 }, {}, { cashIls: 0 }),
  ];
  const plan = planPurchase(input(categories, { VOO: 500, BND: 100 }, { pension: 700, kids: 600 }, { wholeShares: true }));
  const executed = {
    orders: plan.orders.map((o) => ({ ticker: o.ticker, shares: o.shares, priceUsd: o.priceUsd })),
    usdIls: 1,
    fxFeePercent: 0,
    date: '2026-10-23T12:00:00.000Z',
    newMoneyIls: { pension: 600, kids: 600 },
  };

  it('splits executed shares between categories exactly', () => {
    const tx = transactionFromPlan(plan, executed, 'tx1');
    for (const o of tx.orders) {
      const total = tx.allocations.filter((a) => a.ticker === o.ticker).reduce((s, a) => s + a.shares, 0);
      expect(total).toBeCloseTo(o.shares, 9);
    }
    expect(tx.cash.map((c) => c.categoryId).sort()).toEqual(['kids', 'pension']);
  });

  it('scales the split when fewer shares were bought than planned', () => {
    const tx = transactionFromPlan(plan, { ...executed, orders: [{ ticker: 'VOO', shares: 1, priceUsd: 510 }] }, 'tx2');
    expect(tx.orders).toEqual([{ ticker: 'VOO', shares: 1, priceUsd: 510 }]);
    expect(tx.allocations.reduce((s, a) => s + a.shares, 0)).toBeCloseTo(1, 9);
  });

  it('rejects tickers that are not in the plan and invalid numbers', () => {
    expect(() => transactionFromPlan(plan, { ...executed, orders: [{ ticker: 'QQQ', shares: 1, priceUsd: 1 }] }, 'x')).toThrow(/not part/);
    expect(() => transactionFromPlan(plan, { ...executed, orders: [{ ticker: 'VOO', shares: 1, priceUsd: 0 }] }, 'x')).toThrow(/price/);
    expect(() => transactionFromPlan(plan, { ...executed, usdIls: 0 }, 'x')).toThrow(/exchange rate/);
  });

  it('applies and reverts holdings and cash', () => {
    const tx = transactionFromPlan(plan, executed, 'tx1');
    const applied = applyTransaction(categories, tx);
    const pension = applied.find((c) => c.id === 'pension')!;
    const boughtVoo = tx.allocations.filter((a) => a.categoryId === 'pension').reduce((s, a) => s + a.shares, 0);
    expect(pension.holdings.VOO).toBeCloseTo(2 + boughtVoo, 9);
    const spent = tx.cash.find((c) => c.categoryId === 'pension')!.spentIls;
    expect(pension.cashIls).toBeCloseTo(100 + 600 - spent, 6);
    expect(categories[0].holdings.VOO).toBe(2); // input untouched

    const reverted = revertTransaction(applied, tx);
    expect(reverted[0].holdings).toEqual({ VOO: 2 });
    expect(reverted[0].cashIls).toBeCloseTo(100, 6);
    expect(reverted[1].holdings).toEqual({});
    expect(reverted[1].cashIls).toBeCloseTo(0, 6);
  });

  it('leaves exactly 0 cash when a category spends its whole budget', () => {
    // Three categories share one whole share, so each gets an awkward fraction of it.
    const cats = [cat('a', { X: 100 }), cat('b', { X: 100 }), cat('c', { X: 100 })];
    const p = planPurchase(input(cats, { X: 30 }, { a: 10, b: 10, c: 10 }, { wholeShares: true }));
    expect(p.orders).toEqual([{ ticker: 'X', shares: 1, priceUsd: 30, costUsd: 30 }]);
    const tx = transactionFromPlan(
      p,
      { orders: [{ ticker: 'X', shares: 1, priceUsd: 30 }], usdIls: 1, fxFeePercent: 0, date: 'd', newMoneyIls: { a: 10, b: 10, c: 10 } },
      't',
    );
    const after = applyTransaction(cats, tx);
    expect(after.map((c) => c.cashIls)).toEqual([0, 0, 0]);
    expect(after.reduce((s, c) => s + c.holdings.X, 0)).toBeCloseTo(1, 9);
  });

  it('never leaves negative shares when reverting', () => {
    const tx = transactionFromPlan(plan, executed, 'tx1');
    const edited = applyTransaction(categories, tx).map((c) => ({ ...c, holdings: {} }));
    expect(revertTransaction(edited, tx).every((c) => Object.keys(c.holdings).length === 0)).toBe(true);
  });
});
