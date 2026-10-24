import type { Category } from '../types';
import { CATEGORY_COLORS, newId } from '../lib/ids';

/** Holdings found in an imported file, grouped by portfolio name. */
export interface ImportedPortfolio {
  name: string;
  /** Net shares per ticker (buys minus sells), only tickers with shares left. */
  holdings: Record<string, number>;
}

export type ImportResult =
  | { ok: true; portfolios: ImportedPortfolio[]; warnings: string[] }
  | { ok: false; error: string };

/** Split CSV text into rows of fields (handles quotes, "" escapes and CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/**
 * Read a Yahoo Finance portfolio export (columns Symbol, Portfolio, Currency, Shares Owned, Type…).
 * Each portfolio becomes a category; shares are buys minus sells. Rows in other currencies are
 * skipped (the app handles USD stocks only).
 */
export function parseYahooPortfolioCsv(text: string): ImportResult {
  const rows = parseCsv(text.replace(/^﻿/, ''));
  const header = rows[0]?.map((h) => h.trim().toLowerCase()) ?? [];
  const col = (name: string) => header.indexOf(name);
  const iSymbol = col('symbol');
  const iPortfolio = col('portfolio');
  const iShares = col('shares owned');
  const iType = col('type');
  const iCurrency = col('currency');
  if (iSymbol < 0 || iShares < 0) {
    return {
      ok: false,
      error: 'This file doesn\'t look like a Yahoo Finance portfolio export (it needs "Symbol" and "Shares Owned" columns).',
    };
  }

  const warnings: string[] = [];
  const totals = new Map<string, Map<string, number>>();
  const otherCurrency = new Set<string>();
  const unknownTypes = new Set<string>();

  for (const r of rows.slice(1)) {
    const ticker = (r[iSymbol] ?? '').trim().toUpperCase();
    const sharesText = (r[iShares] ?? '').trim();
    if (!ticker || !sharesText) continue; // blank lines and per-stock summary rows
    const shares = Number(sharesText);
    if (!Number.isFinite(shares) || shares < 0) {
      warnings.push(`${ticker}: couldn't read the number of shares "${sharesText}"; that row was skipped.`);
      continue;
    }
    const currency = iCurrency >= 0 ? (r[iCurrency] ?? '').trim().toUpperCase() : '';
    if (currency && currency !== 'USD') {
      otherCurrency.add(`${ticker} (${currency})`);
      continue;
    }
    const type = iType >= 0 ? (r[iType] ?? '').trim().toLowerCase() : 'buy';
    const sign = type === 'sell' ? -1 : type === 'buy' || type === '' ? 1 : 0;
    if (sign === 0) {
      unknownTypes.add(r[iType].trim());
      continue;
    }
    const portfolio = (iPortfolio >= 0 ? (r[iPortfolio] ?? '').trim() : '') || 'Imported';
    const holdings = totals.get(portfolio) ?? new Map<string, number>();
    holdings.set(ticker, (holdings.get(ticker) ?? 0) + sign * shares);
    totals.set(portfolio, holdings);
  }

  if (otherCurrency.size > 0) {
    warnings.push(`Skipped stocks not in USD (only USD stocks are supported): ${[...otherCurrency].join(', ')}.`);
  }
  if (unknownTypes.size > 0) warnings.push(`Skipped rows of type: ${[...unknownTypes].join(', ')}.`);

  const portfolios: ImportedPortfolio[] = [];
  for (const [name, holdings] of totals) {
    const kept: Record<string, number> = {};
    for (const [ticker, raw] of [...holdings].sort((a, b) => a[0].localeCompare(b[0]))) {
      const shares = Math.round(raw * 1e6) / 1e6;
      if (shares > 0) kept[ticker] = shares;
      else if (shares < 0) warnings.push(`${name}: more ${ticker} was sold than bought; it was left out.`);
    }
    if (Object.keys(kept).length > 0) portfolios.push({ name, holdings: kept });
  }
  if (portfolios.length === 0) return { ok: false, error: 'No holdings were found in this file.' };
  return { ok: true, portfolios, warnings };
}

/**
 * Put imported holdings into the categories: a portfolio whose name matches a category
 * (ignoring case) replaces that category's holdings; any other portfolio becomes a new category
 * with no targets yet. Targets, rules and cash of existing categories are kept.
 */
export function applyImport(categories: Category[], portfolios: ImportedPortfolio[]): Category[] {
  const result = categories.map((c) => {
    const p = portfolios.find((x) => x.name.toLowerCase() === c.name.trim().toLowerCase());
    return p ? { ...c, holdings: { ...p.holdings } } : c;
  });
  for (const p of portfolios) {
    if (result.some((c) => c.name.trim().toLowerCase() === p.name.toLowerCase())) continue;
    const color = CATEGORY_COLORS.find((col) => !result.some((c) => c.color === col)) ?? CATEGORY_COLORS[result.length % CATEGORY_COLORS.length];
    result.push({
      id: newId(),
      name: p.name,
      color,
      targets: [],
      holdings: { ...p.holdings },
      cashIls: 0,
      contribution: { kind: 'none' },
    });
  }
  return result;
}
