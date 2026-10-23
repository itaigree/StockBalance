export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

export const defaultFetch: FetchFn = (input, init) => fetch(input, init);

export const DEFAULT_TIMEOUT_MS = 10_000;

export type JsonResult =
  | { ok: true; status: number; json: unknown }
  /** network: no response; timeout: no answer in time; not-json: e.g. an HTML page. */
  | { ok: false; kind: 'network' | 'timeout' | 'not-json'; status?: number };

/** GET a URL and parse the body as JSON, whatever the HTTP status. Never throws. */
export async function getJson(fetchImpl: FetchFn, url: string, timeoutMs: number): Promise<JsonResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { signal: controller.signal });
    const text = await res.text();
    const type = res.headers.get('content-type') ?? '';
    if (type.includes('text/html')) return { ok: false, kind: 'not-json', status: res.status };
    try {
      return { ok: true, status: res.status, json: JSON.parse(text) };
    } catch {
      return { ok: false, kind: 'not-json', status: res.status };
    }
  } catch {
    return { ok: false, kind: controller.signal.aborted ? 'timeout' : 'network' };
  } finally {
    clearTimeout(timer);
  }
}

/** Run `fn` over `items` with at most `limit` running at once; results keep the input order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** Safely read a nested property path from unknown JSON. */
export function pick(json: unknown, ...path: (string | number)[]): unknown {
  let cur: unknown = json;
  for (const key of path) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string | number, unknown>)[key];
  }
  return cur;
}

export function positiveNumber(x: unknown): number | null {
  return typeof x === 'number' && Number.isFinite(x) && x > 0 ? x : null;
}
