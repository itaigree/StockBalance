// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from './yahoo-proxy.js';

afterEach(() => vi.unstubAllGlobals());

describe('price forwarder worker', () => {
  it('forwards chart requests to Yahoo and allows browser access', async () => {
    const upstream = vi.fn(async () => new Response('{"chart":{}}', { headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', upstream);
    const res = await worker.fetch(new Request('https://x.workers.dev/v8/finance/chart/MXWO.L?interval=1d&range=1d'));
    expect(upstream.mock.calls[0][0]).toBe('https://query1.finance.yahoo.com/v8/finance/chart/MXWO.L?interval=1d&range=1d');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(await res.text()).toBe('{"chart":{}}');
  });

  it('forwards searches for a ticker (to suggest one that was mistyped)', async () => {
    const upstream = vi.fn(async () => new Response('{"quotes":[]}', { headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', upstream);
    const res = await worker.fetch(new Request('https://x.workers.dev/v1/finance/search?q=APPL&quotesCount=8'));
    expect(upstream.mock.calls[0][0]).toBe('https://query1.finance.yahoo.com/v1/finance/search?q=APPL&quotesCount=8');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(await res.text()).toBe('{"quotes":[]}');
  });

  it('forwards nothing else', async () => {
    const upstream = vi.fn();
    vi.stubGlobal('fetch', upstream);
    expect((await worker.fetch(new Request('https://x.workers.dev/v7/finance/quote?symbols=A'))).status).toBe(404);
    expect((await worker.fetch(new Request('https://x.workers.dev/v1/finance/search/more'))).status).toBe(404);
    expect((await worker.fetch(new Request('https://x.workers.dev/v8/finance/chart/A', { method: 'POST' }))).status).toBe(404);
    expect(upstream).not.toHaveBeenCalled();
    expect((await worker.fetch(new Request('https://x.workers.dev/', { method: 'OPTIONS' }))).status).toBe(204);
  });
});
