import { z } from 'zod';
import type { AppData, Category, PriceQuote, Settings } from '../types';
import { normalizeTicker } from '../lib/format';

export const DEFAULT_SETTINGS: Settings = {
  priceProvider: 'auto',
  finnhubApiKey: '',
  yahooProxyUrl: '',
  fxFeePercent: 0,
  wholeShares: true,
  minOrderUsd: 0,
  maxTickersPerPurchase: null,
  buyStrategy: 'balance',
};

export function emptyData(): AppData {
  return { version: 1, categories: [], prices: {}, fx: null, settings: { ...DEFAULT_SETTINGS }, transactions: [] };
}

export type ParseResult = { ok: true; data: AppData } | { ok: false; error: string };

export const CURRENT_VERSION = 1;

const ticker = z
  .string()
  .trim()
  .min(1, 'the ticker is empty')
  .max(20, 'the ticker is too long')
  // Saved before share classes were written one way (BRK-B), they load as the app writes them (BRK.B).
  .transform((s) => normalizeTicker(s));

const contribution = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('fixed'), amountIls: z.number().nonnegative() }),
  z.object({ kind: z.literal('percent'), percent: z.number().min(0).max(100) }),
  z.object({ kind: z.literal('remainder') }),
  z.object({ kind: z.literal('none') }),
]);

const category = z.object({
  id: z.string().min(1, 'the id is empty'),
  name: z.string().trim().min(1, 'the name is empty'),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{3,8}$/)
    .catch('#2563eb'),
  targets: z
    .array(z.object({ ticker, percent: z.number().min(0).max(100), group: z.string().trim().min(1).optional() }))
    .default([]),
  holdings: z.record(z.string(), z.number().nonnegative()).default({}),
  cashIls: z.number().default(0),
  contribution: contribution.default({ kind: 'none' }),
  notes: z.string().optional(),
});

// Prices and the FX rate are only a cache: invalid entries are dropped instead of rejecting the data.
const priceQuote = z.object({
  priceUsd: z.number().positive(),
  asOf: z.string(),
  source: z.enum(['yahoo', 'finnhub', 'manual']),
});

const fxQuote = z.object({
  usdIls: z.number().positive(),
  asOf: z.string(),
  source: z.enum(['yahoo', 'frankfurter', 'open-er-api', 'manual']),
});

// Settings are preferences: a missing or invalid value falls back to its default.
const settings = z.object({
  priceProvider: z.enum(['auto', 'yahoo', 'finnhub', 'manual']).catch(DEFAULT_SETTINGS.priceProvider),
  finnhubApiKey: z.string().trim().catch(DEFAULT_SETTINGS.finnhubApiKey),
  yahooProxyUrl: z.string().trim().catch(DEFAULT_SETTINGS.yahooProxyUrl),
  fxFeePercent: z.number().min(0).max(100).catch(DEFAULT_SETTINGS.fxFeePercent),
  wholeShares: z.boolean().catch(DEFAULT_SETTINGS.wholeShares),
  minOrderUsd: z.number().min(0).catch(DEFAULT_SETTINGS.minOrderUsd),
  maxTickersPerPurchase: z.number().int().min(1).nullable().catch(DEFAULT_SETTINGS.maxTickersPerPurchase),
  buyStrategy: z.enum(['balance', 'fewest']).catch(DEFAULT_SETTINGS.buyStrategy),
});

const transaction = z.object({
  id: z.string().min(1, 'the id is empty'),
  date: z.string(),
  usdIls: z.number().positive(),
  fxFeePercent: z.number().nonnegative(),
  orders: z.array(z.object({ ticker, shares: z.number().nonnegative(), priceUsd: z.number().positive() })),
  allocations: z.array(
    z.object({ categoryId: z.string(), ticker, shares: z.number().nonnegative(), costUsd: z.number().nonnegative() }),
  ),
  cash: z.array(z.object({ categoryId: z.string(), newMoneyIls: z.number(), spentIls: z.number() })),
  note: z.string().optional(),
});

const appData = z.object({
  version: z.literal(CURRENT_VERSION),
  categories: z.array(category).default([]),
  prices: z.record(z.string(), z.unknown()).default({}),
  fx: z.unknown().optional(),
  settings: z.preprocess((v) => v ?? {}, settings),
  transactions: z.array(transaction).default([]),
});

/**
 * Validate (and, for older versions, migrate) untrusted data — from localStorage or an imported
 * backup file — into AppData. Missing optional fields get defaults; tickers are normalised to
 * upper case. Returns a human-readable error when the data can't be used.
 */
export function parseAppData(raw: unknown): ParseResult {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, error: 'This is not StockBalance data.' };
  }
  const version = (raw as { version?: unknown }).version;
  if (version === undefined) return { ok: false, error: 'This is not StockBalance data (no version number).' };
  if (typeof version === 'number' && version > CURRENT_VERSION) {
    return { ok: false, error: 'This data was made by a newer version of StockBalance. Update the app first.' };
  }
  // Future: migrate older versions here before validating.

  const parsed = appData.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: `Invalid data at ${formatPath(issue.path)}: ${issue.message}` };
  }
  const d = parsed.data;

  const ids = new Set<string>();
  for (const [i, c] of d.categories.entries()) {
    if (ids.has(c.id)) return { ok: false, error: `Invalid data at categories[${i}].id: the id "${c.id}" is used twice.` };
    ids.add(c.id);
  }
  const txIds = new Set<string>();
  for (const [i, t] of d.transactions.entries()) {
    if (txIds.has(t.id)) return { ok: false, error: `Invalid data at transactions[${i}].id: the id "${t.id}" is used twice.` };
    txIds.add(t.id);
  }

  const categories: Category[] = d.categories.map((c) => ({
    id: c.id,
    name: c.name,
    color: c.color,
    targets: mergeTargets(c.targets),
    holdings: normaliseHoldings(c.holdings),
    cashIls: c.cashIls,
    contribution: c.contribution,
    ...(c.notes !== undefined ? { notes: c.notes } : {}),
  }));

  const prices: Record<string, PriceQuote> = {};
  for (const [key, value] of Object.entries(d.prices)) {
    const q = priceQuote.safeParse(value);
    const t = normalizeTicker(key);
    if (q.success && t) prices[t] = q.data;
  }

  const fx = fxQuote.safeParse(d.fx);

  return {
    ok: true,
    data: {
      version: 1,
      categories,
      prices,
      fx: fx.success ? fx.data : null,
      settings: d.settings,
      transactions: d.transactions.map((t) => {
        const { note, ...rest } = t;
        return note !== undefined ? { ...rest, note } : rest;
      }),
    },
  };
}

function mergeTargets(targets: { ticker: string; percent: number; group?: string }[]) {
  const merged = new Map<string, { percent: number; group?: string }>();
  for (const t of targets) {
    const m = merged.get(t.ticker);
    if (m) m.percent += t.percent;
    else merged.set(t.ticker, { percent: t.percent, ...(t.group ? { group: t.group } : {}) });
  }
  return [...merged].map(([ticker, m]) => ({ ticker, ...m }));
}

function normaliseHoldings(holdings: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, shares] of Object.entries(holdings)) {
    const t = normalizeTicker(key);
    if (t && shares > 0) out[t] = (out[t] ?? 0) + shares;
  }
  return out;
}

function formatPath(path: PropertyKey[]): string {
  if (path.length === 0) return 'the top level';
  return path
    .map((p, i) => (typeof p === 'number' ? `[${p}]` : i === 0 ? String(p) : `.${String(p)}`))
    .join('');
}
