import { describe, expect, it } from 'vitest';
import type { Category, Transaction } from '../types';
import { categoryPurchaseSummary } from './summary';

const eitan: Category = {
  id: 'eitan',
  name: 'Eitan',
  color: '#000',
  targets: [
    { ticker: 'VTI', percent: 50 },
    { ticker: 'VT', percent: 50 },
  ],
  holdings: {},
  cashIls: 0,
  contribution: { kind: 'none' },
};

// Like the first rows of a hand-kept sheet: deposit, rate, shares and price per stock.
const txs: Transaction[] = [
  {
    id: 't2',
    date: '2025-05-04T12:00:00.000Z',
    usdIls: 3.7759,
    fxFeePercent: 0,
    orders: [{ ticker: 'VT', shares: 3, priceUsd: 103.12 }],
    allocations: [
      { categoryId: 'eitan', ticker: 'VT', shares: 1, costUsd: 103.12 },
      { categoryId: 'naveh', ticker: 'VT', shares: 2, costUsd: 206.24 },
    ],
    cash: [
      { categoryId: 'eitan', newMoneyIls: 800, spentIls: 389.37 },
      { categoryId: 'naveh', newMoneyIls: 800, spentIls: 778.74 },
    ],
    note: '4-5.25',
  },
  {
    id: 't1',
    date: '2025-03-13T12:00:00.000Z',
    usdIls: 3.6622,
    fxFeePercent: 0,
    orders: [{ ticker: 'VTI', shares: 6, priceUsd: 270.52 }],
    allocations: [{ categoryId: 'eitan', ticker: 'VTI', shares: 6, costUsd: 1623.12 }],
    cash: [{ categoryId: 'eitan', newMoneyIls: 5600, spentIls: 5944.19 }],
  },
  {
    id: 'other',
    date: '2025-06-01T12:00:00.000Z',
    usdIls: 3.5,
    fxFeePercent: 0,
    orders: [],
    allocations: [],
    cash: [{ categoryId: 'naveh', newMoneyIls: 100, spentIls: 0 }],
  },
];

describe('categoryPurchaseSummary', () => {
  it('lists the category’s purchases oldest first with totals', () => {
    const s = categoryPurchaseSummary(eitan, txs);
    expect(s.tickers).toEqual(['VTI', 'VT']);
    expect(s.rows.map((r) => r.txId)).toEqual(['t1', 't2']);
    expect(s.rows[0]).toMatchObject({ newMoneyIls: 5600, usdIls: 3.6622, spentUsd: 1623.12, buys: { VTI: { shares: 6, priceUsd: 270.52 } } });
    expect(s.rows[0].newMoneyUsd).toBeCloseTo(5600 / 3.6622, 9);
    expect(s.rows[1]).toMatchObject({ note: '4-5.25', buys: { VT: { shares: 1, priceUsd: 103.12 } } });

    expect(s.totals.newMoneyIls).toBe(6400);
    expect(s.totals.newMoneyUsd).toBeCloseTo(5600 / 3.6622 + 800 / 3.7759, 9);
    expect(s.totals.shares).toEqual({ VTI: 6, VT: 1 });
    expect(s.totals.avgPriceUsd).toEqual({ VTI: 270.52, VT: 103.12 });
    expect(s.totals.spentUsd).toBeCloseTo(1726.24, 9);
    expect(s.totals.leftoverUsd).toBeCloseTo(5600 / 3.6622 + 800 / 3.7759 - 1726.24, 9);
    expect(s.totals.leftoverIls).toBeCloseTo(6400 - 5944.19 - 389.37, 9);
  });

  it('includes money kept as cash and other tickers bought, and is empty without purchases', () => {
    const naveh = { ...eitan, id: 'naveh', targets: [{ ticker: 'VTI', percent: 100 }] };
    const s = categoryPurchaseSummary(naveh, txs);
    expect(s.tickers).toEqual(['VTI', 'VT']);
    expect(s.rows.map((r) => r.txId)).toEqual(['t2', 'other']);
    expect(s.rows[1]).toMatchObject({ newMoneyIls: 100, spentUsd: 0, buys: {} });
    expect(s.totals.shares).toEqual({ VTI: 0, VT: 2 });
    expect(s.totals.avgPriceUsd).toEqual({ VT: 103.12 });

    const none = categoryPurchaseSummary({ ...eitan, id: 'nobody' }, txs);
    expect(none.rows).toEqual([]);
    expect(none.totals.newMoneyIls).toBe(0);
  });

  it('keeps purchases made on the same day in the order they were recorded', () => {
    const sameDay = [txs[1], { ...txs[0], id: 'a-later', date: txs[1].date }];
    expect(categoryPurchaseSummary(eitan, sameDay).rows.map((r) => r.txId)).toEqual(['t1', 'a-later']);
  });

  it('counts the conversion fee in the dollar amounts, so nothing is left over when the cash is 0', () => {
    // ₪1,010 at 1 ILS/USD with a 1% fee buys exactly $1,000 of stock.
    const tx: Transaction = {
      id: 'fee',
      date: '2026-01-01T12:00:00.000Z',
      usdIls: 1,
      fxFeePercent: 1,
      orders: [{ ticker: 'VTI', shares: 10, priceUsd: 100 }],
      allocations: [{ categoryId: 'eitan', ticker: 'VTI', shares: 10, costUsd: 1000 }],
      cash: [{ categoryId: 'eitan', newMoneyIls: 1010, spentIls: 1010 }],
    };
    const s = categoryPurchaseSummary(eitan, [tx]);
    expect(s.rows[0].newMoneyUsd).toBeCloseTo(1000, 9);
    expect(s.totals.leftoverIls).toBe(0);
    expect(s.totals.leftoverUsd).toBeCloseTo(0, 9);
  });

  it('shows the price of the order a category got, when a stock was bought in two orders', () => {
    const tx: Transaction = {
      id: 'two',
      date: '2026-01-01T12:00:00.000Z',
      usdIls: 3.7,
      fxFeePercent: 0,
      orders: [
        { ticker: 'VT', shares: 1, priceUsd: 100 },
        { ticker: 'VT', shares: 3, priceUsd: 200 },
      ],
      allocations: [
        { categoryId: 'eitan', ticker: 'VT', shares: 1, costUsd: 100, priceUsd: 100 },
        { categoryId: 'naveh', ticker: 'VT', shares: 3, costUsd: 600, priceUsd: 200 },
      ],
      cash: [{ categoryId: 'eitan', newMoneyIls: 370, spentIls: 370 }],
    };
    expect(categoryPurchaseSummary(eitan, [tx]).rows[0].buys.VT.priceUsd).toBe(100);
    // Both parts in one category: the average of what it paid.
    const both = { ...tx, allocations: tx.allocations.map((a) => ({ ...a, categoryId: 'eitan' })) };
    expect(categoryPurchaseSummary(eitan, [both]).rows[0].buys.VT.priceUsd).toBe(175);
  });

  it('shows the price that was paid when a share is split between categories', () => {
    // One $3,000 share split three ways: a's part is rounded to 0.333334 shares but costs exactly $1,000.
    const tx: Transaction = {
      id: 'split',
      date: '2026-01-01T12:00:00.000Z',
      usdIls: 3.7,
      fxFeePercent: 0,
      orders: [{ ticker: 'VTI', shares: 1, priceUsd: 3000 }],
      allocations: [
        { categoryId: 'eitan', ticker: 'VTI', shares: 0.333334, costUsd: 1000 },
        { categoryId: 'b', ticker: 'VTI', shares: 0.333333, costUsd: 1000 },
        { categoryId: 'c', ticker: 'VTI', shares: 0.333333, costUsd: 1000 },
      ],
      cash: [{ categoryId: 'eitan', newMoneyIls: 3700, spentIls: 3700 }],
    };
    const s = categoryPurchaseSummary(eitan, [tx]);
    expect(s.rows[0].buys.VTI.priceUsd).toBe(3000);
    expect(s.totals.avgPriceUsd.VTI).toBeCloseTo(3000, 9);
    expect(s.totals.spentUsd).toBe(1000);
  });
});
