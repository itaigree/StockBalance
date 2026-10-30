import { act, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppData } from '../types';
import { emptyData } from '../data/schema';
import { saveData } from '../data/storage';
import { sample, saveFromOtherCopy, savedData } from '../test-utils';
import { AppStateProvider, useApp, type AppContextValue } from './AppState';

/** Answers Yahoo chart requests: 3.7 for the exchange rate, 100 for any stock. */
function fakeMarket() {
  const calls: string[] = [];
  const fn = vi.fn(async (url: string) => {
    calls.push(url);
    const fx = url.includes('ILS');
    const body = { chart: { result: [{ meta: { currency: fx ? 'ILS' : 'USD', regularMarketPrice: fx ? 3.7 : 100 } }], error: null } };
    return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  });
  return { fn, calls };
}

/** Render the provider loading from storage (like the real app) and expose its state. */
function renderProvider() {
  const ref: { current: AppContextValue | null } = { current: null };
  function Probe() {
    ref.current = useApp();
    return null;
  }
  render(
    <AppStateProvider>
      <Probe />
    </AppStateProvider>,
  );
  return ref;
}

afterEach(() => vi.unstubAllGlobals());

describe('AppStateProvider', () => {
  it('fetches prices and the exchange rate again for data that replaces everything', async () => {
    const market = fakeMarket();
    vi.stubGlobal('fetch', market.fn);
    const first = sample();
    first.prices = {};
    first.fx = null;
    saveData(first);
    const app = renderProvider();
    await waitFor(() => expect(app.current!.data.prices.VOO?.priceUsd).toBe(100));

    // Delete all data, then start again with a stock that was priced before.
    act(() => app.current!.actions.startOver(emptyData()));
    expect(app.current!.data.fx).toBeNull();
    act(() =>
      app.current!.actions.upsertCategory({
        id: 'k',
        name: 'Kids',
        color: '#000',
        targets: [{ ticker: 'VOO', percent: 100 }],
        holdings: { VOO: 2 },
        cashIls: 0,
        contribution: { kind: 'remainder' },
      }),
    );
    await waitFor(() => expect(app.current!.data.prices.VOO?.priceUsd).toBe(100));
    await waitFor(() => expect(app.current!.data.fx?.usdIls).toBe(3.7));
  });

  it('fetches again after restoring a backup of the same stocks with old prices', async () => {
    const market = fakeMarket();
    vi.stubGlobal('fetch', market.fn);
    saveData(sample());
    const app = renderProvider();
    await waitFor(() => expect(app.current!.data.prices.VOO?.priceUsd).toBe(100));
    await waitFor(() => expect(app.current!.market.loading).toBe(false));
    const calls = market.calls.length;

    const backup = sample();
    backup.prices.VOO = { ...backup.prices.VOO, priceUsd: 560 };
    backup.fx = { usdIls: 3.0, asOf: '2026-09-01T10:00:00.000Z', source: 'manual' };
    act(() => app.current!.actions.startOver(backup));
    await waitFor(() => expect(market.calls.length).toBeGreaterThan(calls));
    await waitFor(() => expect(app.current!.data.prices.VOO?.priceUsd).toBe(100));
    await waitFor(() => expect(app.current!.data.fx?.usdIls).toBe(3.7));
  });

  it('after editing the data (merge, split, import) only prices new stocks, keeping typed prices', async () => {
    const market = fakeMarket();
    vi.stubGlobal('fetch', market.fn);
    saveData(sample());
    const app = renderProvider();
    await waitFor(() => expect(app.current!.data.prices.VOO?.priceUsd).toBe(100));
    await waitFor(() => expect(app.current!.market.loading).toBe(false));
    act(() => app.current!.actions.setManualPrice('VOO', 999));
    act(() => app.current!.actions.setManualFx(3.5));
    const calls = market.calls.length;

    const d = app.current!.data;
    act(() =>
      app.current!.actions.replaceData({
        ...d,
        categories: [...d.categories, { ...d.categories[0], id: 'extra', name: 'Extra', targets: [{ ticker: 'IAU', percent: 100 }], holdings: {} }],
      }),
    );
    await waitFor(() => expect(app.current!.data.prices.IAU?.priceUsd).toBe(100));
    expect(market.calls.slice(calls).map((u) => decodeURIComponent(u).match(/chart\/([^?]+)/)?.[1])).toEqual(['IAU']);
    expect(app.current!.data.prices.VOO).toMatchObject({ priceUsd: 999, source: 'manual' });
    expect(app.current!.data.fx).toMatchObject({ usdIls: 3.5, source: 'manual' });
  });

  it('takes newer data saved by another copy of the app instead of saving over it later', async () => {
    vi.stubGlobal('fetch', fakeMarket().fn);
    saveData(sample());
    const app = renderProvider();

    // Another tab records a purchase and saves.
    const newer: AppData = { ...sample(), categories: sample().categories.map((c) => (c.id === 'sample-kids' ? { ...c, cashIls: 999 } : c)) };
    act(() => {
      window.localStorage.setItem('stockbalance:data', JSON.stringify(newer));
      window.dispatchEvent(new StorageEvent('storage', { key: 'stockbalance:data', newValue: JSON.stringify(newer) }));
    });
    expect(app.current!.data.categories.find((c) => c.id === 'sample-kids')!.cashIls).toBe(999);

    // A later change in this tab keeps the other tab's change.
    act(() => app.current!.actions.updateSettings({ fxFeePercent: 0.5 }));
    await waitFor(() => expect(savedData().settings.fxFeePercent).toBe(0.5));
    expect(savedData().categories.find((c) => c.id === 'sample-kids')!.cashIls).toBe(999);
  });
});

describe('a saved copy that could not be read', () => {
  it('stops saying so once the user restores a backup or starts anew', () => {
    window.localStorage.setItem('stockbalance:data', '{not json');
    const app = renderProvider();
    expect(app.current!.loadError).toMatch(/couldn't be read/);
    act(() => app.current!.actions.startOver(sample()));
    expect(app.current!.loadError).toBeNull();
  });

  it('stops saying so when another copy starts over, even with the same (empty) data', () => {
    window.localStorage.setItem('stockbalance:data', '{not json');
    const app = renderProvider();
    expect(app.current!.loadError).toMatch(/couldn't be read/);
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'stockbalance:started-over', newValue: '2026-10-30T10:00:00.000Z' }));
    });
    expect(app.current!.loadError).toBeNull();
    // And starting over here tells the other copies.
    window.localStorage.removeItem('stockbalance:started-over');
    act(() => app.current!.actions.startOver(emptyData()));
    expect(window.localStorage.getItem('stockbalance:started-over')).not.toBeNull();
  });

  it('stops saying so once another copy saves data that can be read', () => {
    window.localStorage.setItem('stockbalance:data', '{not json');
    const app = renderProvider();
    expect(app.current!.loadError).toMatch(/couldn't be read/);
    saveFromOtherCopy(sample());
    expect(app.current!.loadError).toBeNull();
    expect(app.current!.data.categories).toHaveLength(3);
  });
});
