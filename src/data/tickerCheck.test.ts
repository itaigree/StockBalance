// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { Settings } from '../types';
import type { FetchFn } from './http';
import { DEFAULT_SETTINGS } from './schema';
import { checkTicker, closeSpellings, distance, suggestTickers } from './tickerCheck';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const yahooPrice = (price: number, currency = 'USD') =>
  json({ chart: { result: [{ meta: { currency, regularMarketPrice: price } }], error: null } });
const yahooNotFound = () =>
  json(
    { chart: { result: null, error: { code: 'Not Found', description: 'No data found, symbol may be delisted' } } },
    404,
  );
const yahooSearch = (quotes: { symbol: string; quoteType: string; exchange: string; shortname?: string }[]) =>
  json({ quotes });

const settings = (patch: Partial<Settings> = {}): Settings => ({ ...DEFAULT_SETTINGS, ...patch });

/** A fake fetch answering by URL pattern; records requested URLs. */
function router(routes: [RegExp, (url: string) => Response][]) {
  const calls: string[] = [];
  const fn: FetchFn = vi.fn(async (url: string) => {
    calls.push(url);
    for (const [re, respond] of routes) if (re.test(url)) return respond(url);
    throw new TypeError('Failed to fetch');
  });
  return { fn, calls };
}

describe('checkTicker', () => {
  it('gives the price of a ticker a source knows', async () => {
    const { fn } = router([[/chart\/SCHD\?/, () => yahooPrice(27.5)]]);
    expect(await checkTicker('schd', settings(), [], fn)).toEqual({ status: 'ok', priceUsd: 27.5 });
  });

  it('says when no source knows a ticker, and suggests US stocks and funds, the closest first', async () => {
    const { fn, calls } = router([
      [/chart\/APPL\?/, yahooNotFound],
      [
        /search\?q=APPL/,
        () =>
          yahooSearch([
            { symbol: 'APLE', quoteType: 'EQUITY', exchange: 'NYQ', shortname: 'Apple Hospitality REIT' },
            { symbol: 'AAPL', quoteType: 'EQUITY', exchange: 'NMS', shortname: 'Apple Inc.' },
            { symbol: 'APP', quoteType: 'EQUITY', exchange: 'NMS', shortname: 'AppLovin' },
            { symbol: 'APC.F', quoteType: 'EQUITY', exchange: 'FRA', shortname: 'Apple (Frankfurt)' },
            { symbol: 'APPL-USD', quoteType: 'CRYPTOCURRENCY', exchange: 'CCC' },
          ]),
      ],
    ]);
    const r = await checkTicker('APPL', settings(), [], fn);
    expect(r).toEqual({
      status: 'notFound',
      reason: 'No price found for APPL.',
      // One slip away first (in the search's order), then two (APLE).
      suggestions: [
        { ticker: 'AAPL', name: 'Apple Inc.' },
        { ticker: 'APP', name: 'AppLovin' },
        { ticker: 'APLE', name: 'Apple Hospitality REIT' },
      ],
    });
    expect(calls.some((u) => u.startsWith('/api/yahoo/v1/finance/search?q=APPL&'))).toBe(true);
  });

  it('suggests close spellings when the search can not be asked (e.g. an older forwarder)', async () => {
    const { fn, calls } = router([
      [/fwd\.example\.workers\.dev\/v8\/finance\/chart\/VTII\?/, yahooNotFound],
      [/fwd\.example\.workers\.dev\/v1\/finance\/search/, () => new Response('Not found', { status: 404 })],
    ]);
    const r = await checkTicker('VTII', settings({ yahooProxyUrl: 'https://fwd.example.workers.dev' }), ['VTIP'], fn);
    expect(r.status).toBe('notFound');
    // The user's own tickers first, then well-known ones.
    expect(r.status === 'notFound' && r.suggestions.map((s) => s.ticker)).toEqual(['VTIP', 'VTI']);
    expect(calls).toHaveLength(2);
  });

  it('says a stock is listed only in another currency, with suggestions', async () => {
    const { fn } = router([
      [/chart\/VUSA\.L\?/, () => yahooPrice(90, 'GBp')],
      [
        /search\?q=VUSA\.L/,
        () => yahooSearch([{ symbol: 'VOO', quoteType: 'ETF', exchange: 'PCX', shortname: 'Vanguard S&P 500 ETF' }]),
      ],
    ]);
    const r = await checkTicker('VUSA.L', settings(), [], fn);
    expect(r).toMatchObject({
      status: 'notFound',
      reason: expect.stringMatching(/in GBp; only USD/),
      suggestions: [{ ticker: 'VOO' }],
    });
  });

  it('uses Finnhub, and its search, when that is the price source', async () => {
    const { fn } = router([
      [
        /finnhub\.io\/api\/v1\/quote\?symbol=MSTF&/,
        () => json({ c: 0, d: null, dp: null, h: 0, l: 0, o: 0, pc: 0, t: 0 }),
      ],
      [
        /finnhub\.io\/api\/v1\/search\?q=MSTF&exchange=US&token=k/,
        () =>
          json({
            count: 2,
            result: [
              { symbol: 'MSFT', description: 'MICROSOFT CORP' },
              { symbol: 'MSTR', description: 'STRATEGY INC' },
            ],
          }),
      ],
    ]);
    const r = await checkTicker('MSTF', settings({ priceProvider: 'finnhub', finnhubApiKey: 'k' }), [], fn);
    expect(r).toMatchObject({
      status: 'notFound',
      suggestions: [
        { ticker: 'MSFT', name: 'MICROSOFT CORP' },
        { ticker: 'MSTR', name: 'STRATEGY INC' },
      ],
    });
  });

  it("can't tell when no source can be asked, or prices are manual", async () => {
    const { fn } = router([
      [/api\/yahoo/, () => new Response('<!doctype html>', { headers: { 'content-type': 'text/html' } })],
    ]);
    const offline = await checkTicker('APPL', settings(), [], fn);
    expect(offline).toMatchObject({ status: 'unchecked', reason: expect.stringMatching(/Couldn't reach Yahoo/) });
    const busy = router([[/chart/, () => new Response('Too Many Requests', { status: 429 })]]);
    expect(await checkTicker('APPL', settings({ priceProvider: 'yahoo' }), [], busy.fn)).toMatchObject({
      status: 'unchecked',
    });
    const manual = router([]);
    expect(await checkTicker('APPL', settings({ priceProvider: 'manual' }), [], manual.fn)).toEqual({
      status: 'unchecked',
      reason: 'Prices are set to manual in Settings.',
    });
    expect(manual.calls).toHaveLength(0);
  });
});

describe('suggestions', () => {
  it('finds close spellings among the user’s and well-known tickers', () => {
    expect(closeSpellings('APPL').map((s) => s.ticker)).toContain('AAPL');
    expect(closeSpellings('APPL').find((s) => s.ticker === 'AAPL')).toEqual({ ticker: 'AAPL', name: 'Apple' });
    expect(closeSpellings('BRKB').map((s) => s.ticker)).toContain('BRK.B');
    expect(closeSpellings('QQQQ').map((s) => s.ticker)).toContain('QQQ');
    expect(closeSpellings('MXWOL', ['MXWO.L']).map((s) => s.ticker)).toEqual(['MXWO.L']);
    // Tickers of up to 4 letters allow one slip only, so they don't match half the list.
    expect(closeSpellings('VOX').every((s) => distance('VOX', s.ticker) <= 1)).toBe(true);
    expect(closeSpellings('APPL').map((s) => s.ticker)).not.toContain('PYPL');
    expect(closeSpellings('GOOGLE').map((s) => s.ticker)).toEqual(expect.arrayContaining(['GOOGL', 'GOOG']));
    expect(closeSpellings('ZZZZZZ')).toEqual([]);
  });

  it('counts a swap of two neighbouring letters as one slip', () => {
    expect(distance('APPL', 'AAPL')).toBe(1);
    expect(distance('MSTF', 'MSFT')).toBe(1);
    expect(distance('VOO', 'VOO')).toBe(0);
    expect(distance('VTI', 'VXUS')).toBe(3);
  });

  it('gives at most four, without the ticker typed', async () => {
    const { fn } = router([
      [
        /search/,
        () =>
          yahooSearch(
            ['VOO', 'VO', 'VOOG', 'VOOV', 'VOT', 'VOE'].map((symbol) => ({
              symbol,
              quoteType: 'ETF',
              exchange: 'PCX',
            })),
          ),
      ],
    ]);
    const s = await suggestTickers('VOO', settings(), [], fn);
    expect(s).toHaveLength(4);
    expect(s.map((x) => x.ticker)).not.toContain('VOO');
  });
});
