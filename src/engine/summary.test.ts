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
});

