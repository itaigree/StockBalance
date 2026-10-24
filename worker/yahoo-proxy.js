// StockBalance price forwarder — a Cloudflare Worker (free plan).
//
// Browsers can't call Yahoo Finance directly from a web page, so the app asks this Worker, which
// fetches the price from Yahoo and passes the answer back. Only Yahoo's chart API is forwarded,
// nothing else. Setup steps: see README.md, "Prices for every exchange (free price forwarder)".

const YAHOO = 'https://query1.finance.yahoo.com';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const url = new URL(request.url);
    if (request.method !== 'GET' || !url.pathname.startsWith('/v8/finance/chart/')) {
      return new Response('Not found', { status: 404, headers: CORS });
    }
    const upstream = await fetch(YAHOO + url.pathname + url.search, {
      headers: { 'User-Agent': 'Mozilla/5.0 (StockBalance price forwarder)', Accept: 'application/json' },
      // Let Cloudflare reuse an answer for a minute.
      cf: { cacheTtl: 60, cacheEverything: true },
    });
    return new Response(upstream.body, {
      status: upstream.status,
      headers: { ...CORS, 'Content-Type': upstream.headers.get('Content-Type') ?? 'application/json' },
    });
  },
};
