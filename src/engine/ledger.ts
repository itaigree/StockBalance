import type { Category, Transaction, TransactionAllocation, TransactionCategoryCash } from '../types';
import { apportion } from './apportion';
import type { ExecutedPurchase, PlanResult } from './types';

const SHARE_DECIMALS = 6;

/** Build a transaction from a plan and what was actually executed. See docs/DESIGN.md. */
export function transactionFromPlan(plan: PlanResult, executed: ExecutedPurchase, id: string): Transaction {
  if (!(Number.isFinite(executed.usdIls) && executed.usdIls > 0)) throw new Error('The exchange rate must be more than 0.');
  if (!(Number.isFinite(executed.fxFeePercent) && executed.fxFeePercent >= 0)) {
    throw new Error('The conversion fee must be 0 or more.');
  }
  const rate = executed.usdIls * (1 + executed.fxFeePercent / 100);
  const planned = new Set(plan.orders.map((o) => o.ticker));

  const orders: Transaction['orders'] = [];
  const allocations: TransactionAllocation[] = [];
  for (const o of executed.orders) {
    const ticker = o.ticker.trim().toUpperCase();
    if (!planned.has(ticker)) throw new Error(`${ticker} is not part of this plan.`);
    if (!(Number.isFinite(o.shares) && o.shares >= 0)) throw new Error(`${ticker}: the number of shares must be 0 or more.`);
    if (o.shares === 0) continue;
    if (!(Number.isFinite(o.priceUsd) && o.priceUsd > 0)) throw new Error(`${ticker}: the price must be more than 0.`);

    const owners = plan.categories
      .map((c) => ({ id: c.categoryId, shares: c.buys.find((b) => b.ticker === ticker)?.shares ?? 0 }))
      .filter((c) => c.shares > 0);
    if (owners.length === 0) throw new Error(`${ticker}: no category planned to buy it.`);
    const split = apportion(o.shares, owners.map((c) => c.shares), SHARE_DECIMALS);
    owners.forEach((c, i) => {
      if (split[i] > 0) {
        allocations.push({ categoryId: c.id, ticker, shares: split[i], costUsd: split[i] * o.priceUsd });
      }
    });
    orders.push({ ticker, shares: o.shares, priceUsd: o.priceUsd });
  }

  const ids = [...new Set([...plan.categories.map((c) => c.categoryId), ...Object.keys(executed.newMoneyIls)])];
  const cash: TransactionCategoryCash[] = [];
  for (const categoryId of ids) {
    const newMoneyIls = executed.newMoneyIls[categoryId] ?? 0;
    if (!Number.isFinite(newMoneyIls)) throw new Error('A category amount is invalid.');
    const spentUsd = allocations.filter((a) => a.categoryId === categoryId).reduce((s, a) => s + a.costUsd, 0);
    // Money is kept in whole agorot, so a category that spends its whole budget ends at exactly 0.
    const spentIls = roundTo(spentUsd * rate, 2);
    if (newMoneyIls !== 0 || spentIls !== 0) cash.push({ categoryId, newMoneyIls, spentIls });
  }

  const note = executed.note?.trim();
  return {
    id,
    date: executed.date,
    usdIls: executed.usdIls,
    fxFeePercent: executed.fxFeePercent,
    orders,
    allocations,
    cash,
    ...(note ? { note } : {}),
  };
}

/** Add a transaction's shares and cash effect to the categories (returns new objects; input untouched). */
export function applyTransaction(categories: Category[], tx: Transaction): Category[] {
  return update(categories, tx, 1);
}

/** Undo `applyTransaction`. Categories that no longer exist are skipped. */
export function revertTransaction(categories: Category[], tx: Transaction): Category[] {
  return update(categories, tx, -1);
}

function update(categories: Category[], tx: Transaction, sign: 1 | -1): Category[] {
  return categories.map((c) => {
    const allocations = tx.allocations.filter((a) => a.categoryId === c.id);
    const cash = tx.cash.filter((x) => x.categoryId === c.id);
    if (allocations.length === 0 && cash.length === 0) return c;

    const holdings = { ...c.holdings };
    for (const a of allocations) {
      const next = roundTo((holdings[a.ticker] ?? 0) + sign * a.shares, 9);
      // Shares can't go negative (e.g. the holding was edited by hand after the purchase).
      if (next <= 0) delete holdings[a.ticker];
      else holdings[a.ticker] = next;
    }
    const cashDelta = roundTo(cash.reduce((s, x) => s + x.newMoneyIls - x.spentIls, 0), 2);
    return { ...c, holdings, cashIls: roundTo(c.cashIls + sign * cashDelta, 2) };
  });
}

function roundTo(n: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}
