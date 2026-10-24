// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { Settings } from '../types';
import { fetchUsdIls } from './fx';
import type { FetchFn } from './http';
import { fetchPrices } from './prices';
import { DEFAULT_SETTINGS } from './schema';

// Responses shaped like the real APIs (documented formats); the real services are not called.
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const html = (status = 200) => new Response('<!doctype html><html></html>', { status, headers: { 'content-type': 'text/html' } });
const yahooOk = (price: number, currency = 'USD') => json({ chart: { result: [{ meta: { currency, regularMarketPrice: price } }], error: null } });
const yahooNotFound = () =>
  json({ chart: { result: null, error: { code: 'Not Found', description: 'No data found, symbol may be delisted' } } }, 404);
const finnhubOk = (c: number) => json({ c, d: 0, dp: 0, h: c, l: c, o: c, pc: c, t: 1761148800 });

const settings = (patch: Partial<Settings> = {}): Settings => ({ ...DEFAULT_SETTINGS, ...patch });
const NOW = () => new Date('2026-10-23T10:00:00Z');

/** A fake fetch answering by URL pattern; records requested URLs. */
function router(routes: [RegExp, (url: string) => Response | Promise<Response>][]) {
  const calls: string[] = [];
  const fn: FetchFn = vi.fn(async (url: string) => {
    calls.push(url);
    for (const [re, respond] of routes) if (re.test(url)) return respond(url);
    throw new TypeError('Failed to fetch');
  });
  return { fn, calls };
}

describe('fetchPrices', () => {
  it('gets prices from Yahoo through the local proxy', async () => {
    const { fn, calls } = router([[/chart\/VOO/, () => yahooOk(561.2)], [/chart\/BRK-B/, () => yahooOk(470)]]);
    const r = await fetchPrices(['voo', 'BRK.B', 'VOO'], settings(), fn, NOW);
    expect(r.failures).toEqual({});
    expect(r.quotes).toEqual({
      VOO: { priceUsd: 561.2, asOf: '2026-10-23T10:00:00.000Z', source: 'yahoo' },
      'BRK.B': { priceUsd: 470, asOf: '2026-10-23T10:00:00.000Z', source: 'yahoo' },
    });
    expect(calls).toHaveLength(2);
    expect(calls[0]).toBe('/api/yahoo/v8/finance/chart/VOO?interval=1d&range=1d');
  });

  it('uses the price forwarder when one is set', async () => {
    const { fn, calls } = router([[/^https:\/\/fwd\.example\.workers\.dev\/v8\/finance\/chart\/MXWO\.L/, () => yahooOk(150.2)]]);
    const r = await fetchPrices(['MXWO.L'], settings({ yahooProxyUrl: 'https://fwd.example.workers.dev/' }), fn, NOW);
    expect(r.quotes['MXWO.L']).toMatchObject({ priceUsd: 150.2, source: 'yahoo' });
    expect(calls[0]).toBe('https://fwd.example.workers.dev/v8/finance/chart/MXWO.L?interval=1d&range=1d');

    const down = router([]);
    const r2 = await fetchPrices(['VOO'], settings({ yahooProxyUrl: 'https://fwd.example.workers.dev' }), down.fn, NOW);
    expect(r2.failures.VOO).toMatch(/price forwarder/);
  });

  it('reports unknown symbols and non-USD listings per ticker', async () => {
    const { fn } = router([[/chart\/XXXX/, yahooNotFound], [/chart\/TEVA/, () => yahooOk(60, 'ILA')], [/chart\/VOO/, () => yahooOk(500)]]);
    const r = await fetchPrices(['VOO', 'XXXX', 'TEVA'], settings({ priceProvider: 'yahoo' }), fn, NOW);
    expect(Object.keys(r.quotes)).toEqual(['VOO']);
    expect(r.failures.XXXX).toMatch(/symbol may be delisted/);
    expect(r.failures.TEVA).toMatch(/only USD/);
  });

  it('stops trying Yahoo after the first request when the proxy is missing (static hosting)', async () => {
    const { fn, calls } = router([[/api\/yahoo/, () => html()]]);
    const r = await fetchPrices(['A', 'B', 'C'], settings(), fn, NOW);
    expect(calls).toHaveLength(1);
    expect(Object.keys(r.failures)).toEqual(['A', 'B', 'C']);
    expect(r.failures.A).toMatch(/npm start/);
    expect(r.failures.A).toMatch(/Finnhub API key/);
  });

  it('falls back to Finnhub for what Yahoo could not price', async () => {
    const { fn, calls } = router([
      [/api\/yahoo/, () => new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } })],
      [/finnhub\.io.*symbol=A&/, () => finnhubOk(10.5)],
      [/finnhub\.io.*symbol=B&/, () => finnhubOk(0)],
    ]);
    const r = await fetchPrices(['A', 'B'], settings({ finnhubApiKey: 'k 1' }), fn, NOW);
    expect(r.quotes.A).toEqual({ priceUsd: 10.5, asOf: '2026-10-23T10:00:00.000Z', source: 'finnhub' });
    expect(r.failures.B).toMatch(/Finnhub doesn't know/);
    expect(calls.some((u) => u.includes('token=k%201'))).toBe(true);
  });

  it('explains Finnhub key and rate-limit problems', async () => {
    const rejected = router([[/finnhub/, () => json({ error: 'Invalid API key.' }, 401)]]);
    const r1 = await fetchPrices(['A', 'B', 'C', 'D', 'E', 'F'], settings({ priceProvider: 'finnhub', finnhubApiKey: 'bad' }), rejected.fn, NOW);
    expect(Object.values(r1.failures).every((f) => f === 'Finnhub rejected the API key.')).toBe(true);
    expect(rejected.calls.length).toBeLessThanOrEqual(4);

    const limited = router([[/finnhub/, () => json({ error: 'API limit reached.' }, 429)]]);
    const r2 = await fetchPrices(['A'], settings({ priceProvider: 'finnhub', finnhubApiKey: 'k' }), limited.fn, NOW);
    expect(r2.failures.A).toMatch(/rate limit/);

    const noKey = router([]);
    const r3 = await fetchPrices(['A'], settings({ priceProvider: 'finnhub' }), noKey.fn, NOW);
    expect(r3.failures.A).toMatch(/Set a Finnhub API key/);
    expect(noKey.calls).toHaveLength(0);
  });

  it('makes no requests in manual mode or for an empty list', async () => {
    const { fn, calls } = router([]);
    expect(await fetchPrices([], settings(), fn, NOW)).toEqual({ quotes: {}, failures: {} });
    const r = await fetchPrices(['A'], settings({ priceProvider: 'manual' }), fn, NOW);
    expect(r.failures.A).toMatch(/manual/);
    expect(calls).toHaveLength(0);
  });

  it('times out slow requests', async () => {
    const hang: FetchFn = (_url, init) =>
      new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
    const r = await fetchPrices(['A'], settings({ priceProvider: 'yahoo' }), hang, NOW, 20);
    expect(r.failures.A).toMatch(/in time/);
  });

  it('never runs more than 4 requests at once', async () => {
    let running = 0;
    let peak = 0;
    const fn: FetchFn = async () => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 5));
      running--;
      return yahooOk(1);
    };
    const tickers = Array.from({ length: 20 }, (_, i) => `T${i}`);
    const r = await fetchPrices(tickers, settings(), fn, NOW);
    expect(Object.keys(r.quotes)).toHaveLength(20);
    expect(peak).toBeLessThanOrEqual(4);
  });
});

describe('fetchUsdIls', () => {
  it('uses Yahoo first', async () => {
    const { fn } = router([[/chart\/ILS%3DX/, () => yahooOk(3.6512, 'ILS')]]);
    expect(await fetchUsdIls(settings(), fn, NOW)).toEqual({
      quote: { usdIls: 3.6512, asOf: '2026-10-23T10:00:00.000Z', source: 'yahoo' },
    });
  });

  it('gets the rate through the price forwarder when one is set', async () => {
    const { fn, calls } = router([[/fwd\.example\.workers\.dev\/v8\/finance\/chart\/ILS%3DX/, () => yahooOk(3.6, 'ILS')]]);
    expect(await fetchUsdIls(settings({ yahooProxyUrl: 'https://fwd.example.workers.dev' }), fn, NOW)).toMatchObject({
      quote: { usdIls: 3.6, source: 'yahoo' },
    });
    expect(calls).toHaveLength(1);
  });

  it('falls back to Frankfurter, then open.er-api', async () => {
    const one = router([[/frankfurter/, () => json({ amount: 1, base: 'USD', date: '2026-10-22', rates: { ILS: 3.66 } })]]);
    expect(await fetchUsdIls(settings(), one.fn, NOW)).toMatchObject({ quote: { usdIls: 3.66, source: 'frankfurter' } });

    const two = router([
      [/frankfurter/, () => json({ message: 'not found' }, 404)],
      [/open\.er-api/, () => json({ result: 'success', base_code: 'USD', rates: { ILS: 3.67 } })],
    ]);
    expect(await fetchUsdIls(settings(), two.fn, NOW)).toMatchObject({ quote: { usdIls: 3.67, source: 'open-er-api' } });
  });

  it('skips Yahoo when prices come from Finnhub or are manual', async () => {
    const { fn, calls } = router([[/frankfurter/, () => json({ rates: { ILS: 3.7 } })]]);
    await fetchUsdIls(settings({ priceProvider: 'finnhub' }), fn, NOW);
    expect(calls.some((u) => u.includes('yahoo'))).toBe(false);
  });

  it('rejects implausible rates and reports what was tried', async () => {
    const { fn } = router([
      [/yahoo/, () => yahooOk(365)],
      [/frankfurter/, () => json({ rates: { ILS: 0.27 } })],
      [/open\.er-api/, () => json({ result: 'error', 'error-type': 'unsupported-code' })],
    ]);
    const r = await fetchUsdIls(settings(), fn, NOW);
    expect(r).toEqual({ error: expect.stringContaining('Yahoo, Frankfurter, open.er-api.com') });
  });
});
