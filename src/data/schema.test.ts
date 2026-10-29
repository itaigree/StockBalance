import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, emptyData, parseAppData } from './schema';
import { sampleData } from './sample';

const minimalCategory = { id: 'c1', name: 'Pension', color: '#123456', targets: [], holdings: {}, cashIls: 0, contribution: { kind: 'none' } };

describe('parseAppData', () => {
  it('accepts empty and sample data unchanged', () => {
    expect(parseAppData(emptyData())).toEqual({ ok: true, data: emptyData() });
    const sample = sampleData(new Date('2026-10-23T10:00:00Z'));
    expect(parseAppData(JSON.parse(JSON.stringify(sample)))).toEqual({ ok: true, data: sample });
  });

  it('fills in missing optional parts with defaults', () => {
    const r = parseAppData({ version: 1, categories: [{ id: 'c1', name: 'Kids' }] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.settings).toEqual(DEFAULT_SETTINGS);
    expect(r.data.prices).toEqual({});
    expect(r.data.fx).toBeNull();
    expect(r.data.transactions).toEqual([]);
    expect(r.data.categories[0]).toMatchObject({ targets: [], holdings: {}, cashIls: 0, contribution: { kind: 'none' } });
  });

  it('normalises tickers and merges duplicates', () => {
    const r = parseAppData({
      version: 1,
      categories: [
        {
          ...minimalCategory,
          targets: [
            { ticker: ' voo ', percent: 50 },
            { ticker: 'VOO', percent: 10 },
            { ticker: 'bnd', percent: 40 },
          ],
          holdings: { voo: 1, VOO: 2, bnd: 0 },
        },
      ],
      prices: { voo: { priceUsd: 500, asOf: 'x', source: 'yahoo' } },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.categories[0].targets).toEqual([
      { ticker: 'VOO', percent: 60 },
      { ticker: 'BND', percent: 40 },
    ]);
    expect(r.data.categories[0].holdings).toEqual({ VOO: 3 });
    expect(Object.keys(r.data.prices)).toEqual(['VOO']);
  });

  it('keeps target groups', () => {
    const r = parseAppData({
      version: 1,
      categories: [{ ...minimalCategory, targets: [{ ticker: 'amzn', percent: 5, group: ' Corporates ' }, { ticker: 'VOO', percent: 95 }] }],
    });
    expect(r.ok && r.data.categories[0].targets).toEqual([
      { ticker: 'AMZN', percent: 5, group: 'Corporates' },
      { ticker: 'VOO', percent: 95 },
    ]);
  });

  it('drops invalid cached prices and FX instead of failing', () => {
    const r = parseAppData({
      version: 1,
      prices: { A: { priceUsd: -1, asOf: 'x', source: 'yahoo' }, B: { priceUsd: 2, asOf: 'x', source: 'manual' } },
      fx: { usdIls: 'abc' },
    });
    expect(r.ok && Object.keys(r.data.prices)).toEqual(['B']);
    expect(r.ok && r.data.fx).toBeNull();
  });

  it('falls back to defaults for invalid settings', () => {
    const r = parseAppData({
      version: 1,
      settings: { priceProvider: 'bogus', minOrderUsd: -5, maxTickersPerPurchase: 0, wholeShares: false, buyStrategy: 'cheapest' },
    });
    expect(r.ok && r.data.settings).toEqual({ ...DEFAULT_SETTINGS, wholeShares: false });
    const fewest = parseAppData({ version: 1, settings: { buyStrategy: 'fewest' } });
    expect(fewest.ok && fewest.data.settings.buyStrategy).toBe('fewest');
  });

  it('rejects bad data with a message that says where', () => {
    const bad = (categories: unknown[]) => parseAppData({ version: 1, categories });
    expect(bad([{ ...minimalCategory, targets: [{ ticker: 'A', percent: 150 }] }])).toMatchObject({
      ok: false,
      error: expect.stringContaining('categories[0].targets[0].percent'),
    });
    expect(bad([{ ...minimalCategory, holdings: { A: -1 } }])).toMatchObject({ ok: false, error: expect.stringContaining('categories[0].holdings.A') });
    expect(bad([{ ...minimalCategory, name: '  ' }])).toMatchObject({ ok: false, error: expect.stringContaining('name is empty') });
    expect(bad([{ ...minimalCategory, holdings: { A: Infinity } }]).ok).toBe(false);
    expect(bad([minimalCategory, minimalCategory])).toMatchObject({ ok: false, error: expect.stringContaining('used twice') });
    const tx = { id: 'dup', date: 'd', usdIls: 3.7, fxFeePercent: 0, orders: [], allocations: [], cash: [] };
    expect(parseAppData({ version: 1, transactions: [tx, tx] })).toMatchObject({
      ok: false,
      error: expect.stringContaining('transactions[1].id'),
    });
    expect(bad([{ ...minimalCategory, contribution: { kind: 'fixed', amountIls: -1 } }]).ok).toBe(false);
  });

  it('rejects things that are not StockBalance data', () => {
    expect(parseAppData(null).ok).toBe(false);
    expect(parseAppData([]).ok).toBe(false);
    expect(parseAppData({ hello: 1 })).toMatchObject({ ok: false, error: expect.stringContaining('no version') });
    expect(parseAppData({ version: 2 })).toMatchObject({ ok: false, error: expect.stringContaining('newer version') });
  });
});
