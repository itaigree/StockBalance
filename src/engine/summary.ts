import type { Category, Transaction } from '../types';

/** What one recorded purchase meant for one category. */
export interface CategoryPurchaseRow {
  txId: string;
  /** ISO timestamp of the purchase. */
  date: string;
  note?: string;
  /** New money given to the category (ILS). */
  newMoneyIls: number;
  /** USD/ILS rate of the purchase. */
  usdIls: number;
  /** The new money in dollars at that rate (no fee). */
  newMoneyUsd: number;
  /** Shares this category got of each ticker, with the price paid. */
  buys: Record<string, { shares: number; priceUsd: number; costUsd: number }>;
  spentUsd: number;
  /** Including the conversion fee. */
  spentIls: number;
}

export interface CategoryPurchaseSummary {
  /** Columns: the category's target tickers first, then any other ticker it bought. */
  tickers: string[];
  /** Oldest first. */
  rows: CategoryPurchaseRow[];
  totals: {
    newMoneyIls: number;
    newMoneyUsd: number;
    shares: Record<string, number>;
    /** Average price paid per ticker (USD). */
    avgPriceUsd: Record<string, number>;
    spentUsd: number;
    spentIls: number;
    /** New money not spent on these purchases (ILS / USD). */
    leftoverIls: number;
    leftoverUsd: number;
  };
}

/** A category's purchase history in spreadsheet form: one row per recorded purchase, plus totals. */
export function categoryPurchaseSummary(category: Category, transactions: Transaction[]): CategoryPurchaseSummary {
  const rows: CategoryPurchaseRow[] = [];
  for (const tx of transactions) {
    const allocations = tx.allocations.filter((a) => a.categoryId === category.id);
    const cash = tx.cash.find((c) => c.categoryId === category.id);
    if (allocations.length === 0 && !cash) continue;

    const buys: CategoryPurchaseRow['buys'] = {};
    for (const a of allocations) {
      const b = (buys[a.ticker] ??= { shares: 0, priceUsd: 0, costUsd: 0 });
      b.shares += a.shares;
      b.costUsd += a.costUsd;
      b.priceUsd = b.shares > 0 ? b.costUsd / b.shares : 0;
    }
    const newMoneyIls = cash?.newMoneyIls ?? 0;
    rows.push({
      txId: tx.id,
      date: tx.date,
      ...(tx.note ? { note: tx.note } : {}),
      newMoneyIls,
      usdIls: tx.usdIls,
      newMoneyUsd: newMoneyIls / tx.usdIls,
      buys,
      spentUsd: allocations.reduce((s, a) => s + a.costUsd, 0),
      spentIls: cash?.spentIls ?? 0,
    });
  }
  // Stable sort: purchases on the same day stay in the order they were recorded.
  rows.sort((a, b) => a.date.localeCompare(b.date));

  const bought = new Set(rows.flatMap((r) => Object.keys(r.buys)));
  const targetTickers = category.targets.map((t) => t.ticker);
  const tickers = [...targetTickers, ...[...bought].filter((t) => !targetTickers.includes(t)).sort()];

  const shares: Record<string, number> = {};
  const avgPriceUsd: Record<string, number> = {};
  for (const t of tickers) {
    const n = rows.reduce((s, r) => s + (r.buys[t]?.shares ?? 0), 0);
    const cost = rows.reduce((s, r) => s + (r.buys[t]?.costUsd ?? 0), 0);
    shares[t] = n;
    if (n > 0) avgPriceUsd[t] = cost / n;
  }
  const sum = (f: (r: CategoryPurchaseRow) => number) => rows.reduce((s, r) => s + f(r), 0);
  const newMoneyIls = sum((r) => r.newMoneyIls);
  const newMoneyUsd = sum((r) => r.newMoneyUsd);
  const spentUsd = sum((r) => r.spentUsd);
  const spentIls = sum((r) => r.spentIls);

  return {
    tickers,
    rows,
    totals: {
      newMoneyIls,
      newMoneyUsd,
      shares,
      avgPriceUsd,
      spentUsd,
      spentIls,
      leftoverIls: newMoneyIls - spentIls,
      leftoverUsd: newMoneyUsd - spentUsd,
    },
  };
}
