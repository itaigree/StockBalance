import { describe, expect, it } from 'vitest';
import type { Category, Transaction } from '../types';
import { mergeCategories, splitCategory } from './categoryOps';
import { applyTransaction, revertTransaction } from './ledger';
import { categoryPurchaseSummary } from './summary';

const cat = (id: string, holdings: Record<string, number>, cashIls: number, extra: Partial<Category> = {}): Category => ({
  id,
  name: id,
  color: '#000',
  targets: [{ ticker: 'VT', percent: 100 }],
  holdings,
  cashIls,
  contribution: { kind: 'none' },
  ...extra,
});

const eitan = cat('Eitan', { VT: 18, VTI: 6 }, 180.77, { targets: [{ ticker: 'VT', percent: 50 }, { ticker: 'VTI', percent: 50 }] });
const naveh = cat('Naveh', { VT: 6, VTI: 2 }, 170.2, { contribution: { kind: 'fixed', amountIls: 800 } });
const galit = cat('Galit', { AMZN: 480 }, 0);

// One purchase that gave shares and cash to both kids.
const tx: Transaction = {
  id: 'tx',
  date: '2026-10-22T12:00:00.000Z',
  usdIls: 3.11,
  fxFeePercent: 0,
  orders: [{ ticker: 'VTI', shares: 1, priceUsd: 373.9 }],
  allocations: [
    { categoryId: 'Eitan', ticker: 'VTI', shares: 0.5357, costUsd: 0.5357 * 373.9 },
    { categoryId: 'Naveh', ticker: 'VTI', shares: 0.4643, costUsd: 0.4643 * 373.9 },
  ],
  cash: [
    { categoryId: 'Eitan', newMoneyIls: 800, spentIls: 622.9 },
    { categoryId: 'Naveh', newMoneyIls: 800, spentIls: 539.89 },
  ],
};

describe('mergeCategories', () => {
  it('adds holdings and cash, keeps the chosen settings and removes the other category', () => {
    const r = mergeCategories([eitan, naveh, galit], [tx], { keepId: 'Eitan', absorbId: 'Naveh', name: 'Kids' });
    expect(r.categories.map((c) => c.name)).toEqual(['Kids', 'Galit']);
    expect(r.categories[0]).toEqual({ ...eitan, name: 'Kids', holdings: { VT: 24, VTI: 8 }, cashIls: 350.97 });
  });

  it('moves the absorbed category’s past purchases to the merged one', () => {
    const r = mergeCategories([eitan, naveh], [tx], { keepId: 'Eitan', absorbId: 'Naveh' });
    const t = r.transactions[0];
    expect(t.allocations).toHaveLength(1);
    expect(t.allocations[0]).toMatchObject({ categoryId: 'Eitan', ticker: 'VTI', shares: 1 });
    expect(t.allocations[0].costUsd).toBeCloseTo(373.9, 9);
    expect(t.cash).toEqual([{ categoryId: 'Eitan', newMoneyIls: 1600, spentIls: 1162.79 }]);
    const s = categoryPurchaseSummary(r.categories[0], r.transactions);
    expect(s.totals.shares.VTI).toBeCloseTo(1, 9);
    expect(s.totals.newMoneyIls).toBe(1600);
  });

  it('keeps undo working after a merge', () => {
    const before = [cat('A', { VT: 1 }, 10), cat('B', { VT: 2 }, 20)];
    const t: Transaction = {
      ...tx,
      allocations: [
        { categoryId: 'A', ticker: 'VT', shares: 1, costUsd: 100 },
        { categoryId: 'B', ticker: 'VT', shares: 3, costUsd: 300 },
      ],
      cash: [
        { categoryId: 'A', newMoneyIls: 400, spentIls: 311 },
        { categoryId: 'B', newMoneyIls: 1000, spentIls: 933 },
      ],
    };
    const applied = applyTransaction(before, t);
    const merged = mergeCategories(applied, [t], { keepId: 'A', absorbId: 'B' });
    const undone = revertTransaction(merged.categories, merged.transactions[0]);
    expect(undone[0].holdings).toEqual({ VT: 3 });
    expect(undone[0].cashIls).toBeCloseTo(30, 6);
  });

  it('rejects merging a category with itself or a missing one', () => {
    expect(() => mergeCategories([eitan], [], { keepId: 'Eitan', absorbId: 'Eitan' })).toThrow();
    expect(() => mergeCategories([eitan], [], { keepId: 'Eitan', absorbId: 'nope' })).toThrow();
  });
});

describe('splitCategory', () => {
  const newCategory = { id: 'new', name: 'Naveh', color: '#111', targets: eitan.targets, contribution: { kind: 'none' as const } };

  it('moves the chosen shares and cash to a new category right after the original', () => {
    const r = splitCategory([eitan, galit], { sourceId: 'Eitan', newCategory, moveShares: { VT: 6, VTI: 2 }, moveCashIls: 80.77 });
    expect(r.map((c) => c.name)).toEqual(['Eitan', 'Naveh', 'Galit']);
    expect(r[0].holdings).toEqual({ VT: 12, VTI: 4 });
    expect(r[0].cashIls).toBe(100);
    expect(r[1]).toMatchObject({ id: 'new', holdings: { VT: 6, VTI: 2 }, cashIls: 80.77, targets: eitan.targets });
    expect(r[1].targets).not.toBe(eitan.targets);
  });

  it('can move everything of a stock and nothing of another', () => {
    const r = splitCategory([eitan], { sourceId: 'Eitan', newCategory, moveShares: { VT: 18, VTI: 0 }, moveCashIls: 0 });
    expect(r[0].holdings).toEqual({ VTI: 6 });
    expect(r[1].holdings).toEqual({ VT: 18 });
  });

  it('refuses to move more than there is, or a duplicate name', () => {
    expect(() => splitCategory([eitan], { sourceId: 'Eitan', newCategory, moveShares: { VT: 19 }, moveCashIls: 0 })).toThrow(/only 18 VT/);
    expect(() => splitCategory([eitan], { sourceId: 'Eitan', newCategory, moveShares: {}, moveCashIls: 500 })).toThrow(/cash/);
    expect(() => splitCategory([eitan], { sourceId: 'Eitan', newCategory: { ...newCategory, name: 'eitan' }, moveShares: {}, moveCashIls: 0 })).toThrow(
      /already has this name/,
    );
  });
});
