import type { Category, Transaction, TransactionAllocation, TransactionCategoryCash } from '../types';

const round = (n: number, decimals: number) => Math.round(n * 10 ** decimals) / 10 ** decimals;

export interface MergeOptions {
  /** The category whose targets, rules, color and place in the list are kept. */
  keepId: string;
  /** The category that is merged into it and disappears. */
  absorbId: string;
  /** Name of the merged category (defaults to the kept category's name). */
  name?: string;
}

/**
 * Merge two categories: holdings and cash are added together, the kept category's settings stay,
 * and past purchases of the absorbed category are moved to the kept one (so its history and undo
 * keep working). Returns new arrays; the inputs are not changed.
 */
export function mergeCategories(
  categories: Category[],
  transactions: Transaction[],
  { keepId, absorbId, name }: MergeOptions,
): { categories: Category[]; transactions: Transaction[] } {
  const keep = categories.find((c) => c.id === keepId);
  const absorb = categories.find((c) => c.id === absorbId);
  if (!keep || !absorb || keepId === absorbId) throw new Error('Choose two different categories to merge.');

  const holdings = { ...keep.holdings };
  for (const [t, n] of Object.entries(absorb.holdings)) holdings[t] = round((holdings[t] ?? 0) + n, 9);
  const merged: Category = {
    ...keep,
    name: name?.trim() || keep.name,
    holdings,
    cashIls: round(keep.cashIls + absorb.cashIls, 2),
  };

  return {
    categories: categories.filter((c) => c.id !== absorbId).map((c) => (c.id === keepId ? merged : c)),
    transactions: transactions.map((tx) => repoint(tx, absorbId, keepId)),
  };
}

/** Move a transaction's entries from one category id to another, combining entries that now collide. */
function repoint(tx: Transaction, from: string, to: string): Transaction {
  if (!tx.allocations.some((a) => a.categoryId === from) && !tx.cash.some((c) => c.categoryId === from)) return tx;

  const allocations: TransactionAllocation[] = [];
  for (const a of tx.allocations) {
    const categoryId = a.categoryId === from ? to : a.categoryId;
    const same = allocations.find((x) => x.categoryId === categoryId && x.ticker === a.ticker);
    if (same) {
      same.shares = round(same.shares + a.shares, 9);
      same.costUsd += a.costUsd;
    } else allocations.push({ ...a, categoryId });
  }
  const cash: TransactionCategoryCash[] = [];
  for (const c of tx.cash) {
    const categoryId = c.categoryId === from ? to : c.categoryId;
    const same = cash.find((x) => x.categoryId === categoryId);
    if (same) {
      same.newMoneyIls = round(same.newMoneyIls + c.newMoneyIls, 2);
      same.spentIls = round(same.spentIls + c.spentIls, 2);
    } else cash.push({ ...c, categoryId });
  }
  return { ...tx, allocations, cash };
}

export interface SplitOptions {
  sourceId: string;
  /** The new category (its holdings and cash are set from what is moved). */
  newCategory: Pick<Category, 'id' | 'name' | 'color' | 'targets' | 'contribution'>;
  /** Shares to move per ticker. */
  moveShares: Record<string, number>;
  /** Cash to move (ILS). */
  moveCashIls: number;
}

/**
 * Split part of a category off into a new one, placed right after it. Past purchases stay with the
 * original category. Throws when asked to move more than the category has.
 */
export function splitCategory(categories: Category[], { sourceId, newCategory, moveShares, moveCashIls }: SplitOptions): Category[] {
  const source = categories.find((c) => c.id === sourceId);
  if (!source) throw new Error('That category no longer exists.');
  const name = newCategory.name.trim();
  if (!name) throw new Error('Give the new category a name.');
  if (categories.some((c) => c.name.trim().toLowerCase() === name.toLowerCase())) {
    throw new Error('Another category already has this name.');
  }
  if (!(Number.isFinite(moveCashIls) && moveCashIls >= 0)) throw new Error('The cash to move must be 0 or more.');
  if (moveCashIls > Math.max(0, source.cashIls) + 0.005) throw new Error(`${source.name} has only ${source.cashIls} ₪ of cash.`);

  const remaining = { ...source.holdings };
  const moved: Record<string, number> = {};
  for (const [t, n] of Object.entries(moveShares)) {
    if (!(Number.isFinite(n) && n >= 0)) throw new Error(`${t}: the number of shares to move is invalid.`);
    if (n === 0) continue;
    const have = source.holdings[t] ?? 0;
    if (n > have + 1e-9) throw new Error(`${source.name} has only ${have} ${t}.`);
    const left = round(have - n, 9);
    if (left <= 0) delete remaining[t];
    else remaining[t] = left;
    moved[t] = round(Math.min(n, have), 9);
  }

  const updatedSource: Category = { ...source, holdings: remaining, cashIls: round(source.cashIls - moveCashIls, 2) };
  const created: Category = {
    ...newCategory,
    name,
    targets: newCategory.targets.map((t) => ({ ...t })),
    holdings: moved,
    cashIls: round(moveCashIls, 2),
  };
  const i = categories.findIndex((c) => c.id === sourceId);
  return [...categories.slice(0, i), updatedSource, created, ...categories.slice(i + 1)];
}
