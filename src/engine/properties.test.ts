import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Category } from '../types';
import { applyTransaction, revertTransaction, transactionFromPlan } from './ledger';
import { balanceObjective, planPurchase } from './plan';
import { splitContribution } from './split';
import type { PlanInput, PlanResult } from './types';
import { waterfill } from './waterfill';

const TICKERS = ['A', 'B', 'C', 'D', 'E', 'F'];

const priceArb = fc.oneof(
  fc.double({ min: 1, max: 50, noNaN: true }),
  fc.double({ min: 50, max: 2000, noNaN: true }),
  fc.integer({ min: 1, max: 1000 }),
);

const categoryArb = (id: string) =>
  fc.record({
    targets: fc.subarray(TICKERS, { minLength: 0, maxLength: 4 }).chain((ts) =>
      fc.tuple(...ts.map(() => fc.integer({ min: 0, max: 100 }))).map((ps) => ts.map((ticker, i) => ({ ticker, percent: ps[i] }))),
    ),
    holdings: fc.dictionary(fc.constantFrom(...TICKERS), fc.oneof(fc.constant(0), fc.integer({ min: 0, max: 200 }), fc.double({ min: 0, max: 200, noNaN: true }))),
    budget: fc.oneof(fc.constant(0), fc.double({ min: 0, max: 50_000, noNaN: true }), fc.integer({ min: 0, max: 1_000_000 })),
  }).map(({ targets, holdings, budget }) => ({
    category: {
      id,
      name: id,
      color: '#000',
      targets,
      holdings,
      cashIls: 0,
      contribution: { kind: 'none' },
    } as Category,
    budget,
  }));

const inputArb: fc.Arbitrary<PlanInput> = fc
  .record({
    cats: fc.integer({ min: 1, max: 4 }).chain((n) => fc.tuple(...Array.from({ length: n }, (_, i) => categoryArb(`c${i}`)))),
    prices: fc.tuple(...TICKERS.map(() => priceArb)),
    usdIls: fc.double({ min: 2, max: 5, noNaN: true }),
    fxFeePercent: fc.oneof(fc.constant(0), fc.double({ min: 0, max: 1, noNaN: true })),
    wholeShares: fc.boolean(),
    minOrderUsd: fc.oneof(fc.constant(0), fc.integer({ min: 1, max: 3000 })),
    maxTickers: fc.oneof(fc.constant(null), fc.integer({ min: 1, max: 4 })),
  })
  .map((r) => ({
    categories: r.cats.map((c) => c.category),
    prices: Object.fromEntries(TICKERS.map((t, i) => [t, r.prices[i]])),
    usdIls: r.usdIls,
    fxFeePercent: r.fxFeePercent,
    budgetsIls: Object.fromEntries(r.cats.map((c) => [c.category.id, c.budget])),
    options: { wholeShares: r.wholeShares, minOrderUsd: r.minOrderUsd, maxTickers: r.maxTickers },
  }));

const buysOf = (plan: PlanResult) =>
  Object.fromEntries(plan.categories.map((c) => [c.categoryId, Object.fromEntries(c.buys.map((b) => [b.ticker, b.shares]))]));

const RUNS = { numRuns: 400 };

describe('planPurchase invariants', () => {
  it('never overspends, never sells, and keeps orders consistent with the categories', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const plan = planPurchase(input);
        expect(plan.errors).toEqual([]);
        const rate = input.usdIls * (1 + input.fxFeePercent / 100);

        for (const c of plan.categories) {
          const budgetUsd = (input.budgetsIls[c.categoryId] ?? 0) / rate;
          expect(c.spentUsd).toBeLessThanOrEqual(budgetUsd + 1e-6);
          expect(c.leftoverIls).toBeGreaterThanOrEqual(-1e-6);
          const category = input.categories.find((x) => x.id === c.categoryId)!;
          const targets = new Set(category.targets.filter((t) => t.percent > 0).map((t) => t.ticker));
          for (const b of c.buys) {
            expect(b.shares).toBeGreaterThan(0);
            expect(targets.has(b.ticker)).toBe(true);
          }
        }

        for (const o of plan.orders) {
          const attributed = plan.categories.reduce((s, c) => s + (c.buys.find((b) => b.ticker === o.ticker)?.shares ?? 0), 0);
          expect(Math.abs(attributed - o.shares)).toBeLessThan(1e-6);
          if (input.options.wholeShares) expect(Number.isInteger(o.shares)).toBe(true);
          expect(o.costUsd).toBeGreaterThanOrEqual(input.options.minOrderUsd - 1e-6);
        }
        if (input.options.maxTickers !== null) expect(plan.orders.length).toBeLessThanOrEqual(input.options.maxTickers);
        expect(Math.abs(plan.totals.spentUsd - plan.orders.reduce((s, o) => s + o.costUsd, 0))).toBeLessThan(1e-6);
      }),
      RUNS,
    );
  });

  it('never makes the balance worse than buying nothing', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const plan = planPurchase(input);
        const before = balanceObjective(input, {});
        const after = balanceObjective(input, buysOf(plan));
        expect(after).toBeLessThanOrEqual(before * (1 + 1e-9) + 1e-6);
      }),
      RUNS,
    );
  });

  it('invests the whole budget with fractional shares and no limits', () => {
    fc.assert(
      fc.property(inputArb, (raw) => {
        const input = { ...raw, options: { wholeShares: false, minOrderUsd: 0, maxTickers: null } };
        const plan = planPurchase(input);
        const rate = input.usdIls * (1 + input.fxFeePercent / 100);
        for (const c of plan.categories) {
          const category = input.categories.find((x) => x.id === c.categoryId)!;
          if (!category.targets.some((t) => t.percent > 0)) continue;
          const budgetUsd = (input.budgetsIls[c.categoryId] ?? 0) / rate;
          // Orders are floored to 1e-6 of a share, so allow that much per stock.
          expect(c.spentUsd).toBeGreaterThanOrEqual(budgetUsd - 6 * 1e-6 * 2000 - 1e-6);
        }
      }),
      RUNS,
    );
  });

  it('is deterministic', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        expect(planPurchase(input)).toEqual(planPurchase(input));
      }),
      { numRuns: 100 },
    );
  });
});

describe('waterfill optimality', () => {
  it('ends every bought position at the same level and leaves the others at or above it', () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.double({ min: 0, max: 1000, noNaN: true }), fc.double({ min: 0.01, max: 1, noNaN: true })), { minLength: 1, maxLength: 8 }),
        fc.double({ min: 0.01, max: 5000, noNaN: true }),
        (rows, budget) => {
          const values = rows.map((r) => r[0]);
          const weights = rows.map((r) => r[1]);
          const x = waterfill(values, weights, budget);
          expect(x.reduce((a, b) => a + b, 0)).toBeCloseTo(budget, 6);
          const bought = x.map((xi, i) => (xi > 1e-9 ? (values[i] + xi) / weights[i] : null)).filter((r): r is number => r !== null);
          const level = Math.max(...bought);
          for (const r of bought) expect(r).toBeCloseTo(level, 6);
          x.forEach((xi, i) => {
            if (xi <= 1e-9) expect(values[i] / weights[i]).toBeGreaterThanOrEqual(level - 1e-6);
          });
        },
      ),
      RUNS,
    );
  });
});

describe('ledger round trip', () => {
  it('apply then revert restores holdings and cash', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const plan = planPurchase(input);
        const tx = transactionFromPlan(
          plan,
          {
            orders: plan.orders.map((o) => ({ ticker: o.ticker, shares: o.shares, priceUsd: o.priceUsd })),
            usdIls: input.usdIls,
            fxFeePercent: input.fxFeePercent,
            date: '2026-01-01T00:00:00.000Z',
            newMoneyIls: input.budgetsIls,
          },
          'tx',
        );
        for (const o of tx.orders) {
          const total = tx.allocations.filter((a) => a.ticker === o.ticker).reduce((s, a) => s + a.shares, 0);
          expect(Math.abs(total - o.shares)).toBeLessThan(1e-9);
        }
        const back = revertTransaction(applyTransaction(input.categories, tx), tx);
        back.forEach((c, i) => {
          const original = input.categories[i];
          expect(c.cashIls).toBeCloseTo(original.cashIls, 5);
          for (const t of TICKERS) expect(c.holdings[t] ?? 0).toBeCloseTo(original.holdings[t] ?? 0, 6);
        });
      }),
      { numRuns: 200 },
    );
  });
});

describe('splitContribution invariants', () => {
  it('always adds up to the total', () => {
    const ruleArb = fc.oneof(
      fc.record({ kind: fc.constant('fixed' as const), amountIls: fc.double({ min: 0, max: 20_000, noNaN: true }) }),
      fc.record({ kind: fc.constant('percent' as const), percent: fc.double({ min: 0, max: 100, noNaN: true }) }),
      fc.constant({ kind: 'remainder' as const }),
      fc.constant({ kind: 'none' as const }),
    );
    fc.assert(
      fc.property(fc.array(ruleArb, { maxLength: 6 }), fc.double({ min: 0, max: 1_000_000, noNaN: true }), (rules, total) => {
        const cats = rules.map((contribution, i) => ({ id: `c${i}`, name: `c${i}`, contribution }));
        const r = splitContribution(total, cats);
        const sum = Object.values(r.amounts).reduce((a, b) => a + b, 0) + r.unassignedIls;
        expect(sum).toBeCloseTo(Math.round(total * 100) / 100, 6);
        for (const v of Object.values(r.amounts)) expect(v).toBeGreaterThanOrEqual(0);
      }),
      RUNS,
    );
  });
});

describe('performance', () => {
  it('plans 10 categories × 30 stocks with a huge budget quickly', () => {
    const tickers = Array.from({ length: 30 }, (_, i) => `T${i}`);
    const categories: Category[] = Array.from({ length: 10 }, (_, c) => ({
      id: `c${c}`,
      name: `c${c}`,
      color: '#000',
      targets: tickers.map((ticker) => ({ ticker, percent: 100 / 30 })),
      holdings: Object.fromEntries(tickers.map((t, i) => [t, (i * 7 + c * 3) % 50])),
      cashIls: 0,
      contribution: { kind: 'none' },
    }));
    const prices = Object.fromEntries(tickers.map((t, i) => [t, 5 + i * 13.7]));
    const start = performance.now();
    const plan = planPurchase({
      categories,
      prices,
      usdIls: 3.7,
      fxFeePercent: 0,
      budgetsIls: Object.fromEntries(categories.map((c) => [c.id, 1_000_000])),
      options: { wholeShares: true, minOrderUsd: 0, maxTickers: null },
    });
    const ms = performance.now() - start;
    expect(plan.orders.length).toBeGreaterThan(0);
    expect(ms).toBeLessThan(1000);
  });
});
