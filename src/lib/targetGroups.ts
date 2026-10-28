import type { Category } from '../types';

/** A category's targets as shown to the user: single stocks and groups of stocks, in order. */
export type TargetItem =
  | { kind: 'stock'; ticker: string; percent: number }
  | { kind: 'group'; name: string; percent: number; tickers: string[] };

export function targetItems(category: Pick<Category, 'targets'>): TargetItem[] {
  const items: TargetItem[] = [];
  for (const t of category.targets) {
    if (!t.group) {
      items.push({ kind: 'stock', ticker: t.ticker, percent: t.percent });
      continue;
    }
    const g = items.find((i): i is Extract<TargetItem, { kind: 'group' }> => i.kind === 'group' && i.name === t.group);
    if (g) {
      g.percent += t.percent;
      g.tickers.push(t.ticker);
    } else items.push({ kind: 'group', name: t.group, percent: t.percent, tickers: [t.ticker] });
  }
  return items;
}

/** Group name of a target ticker, if it is in a group. */
export function groupOf(category: Pick<Category, 'targets'>, ticker: string): string | undefined {
  return category.targets.find((t) => t.ticker === ticker)?.group;
}
