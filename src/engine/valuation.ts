import type { Category } from '../types';
import { mergedTargets, validPrice } from './targets';
import type { CategoryValuation, PositionView } from './types';

/** Value a category's holdings at the given USD prices. See docs/DESIGN.md. */
export function valueCategory(category: Category, prices: Record<string, number>): CategoryValuation {
  const targets = mergedTargets(category);
  const sum = targets.reduce((a, t) => a + t.percent, 0);
  const scale = sum > 0 && Math.abs(sum - 100) > 1e-9 ? 100 / sum : 1;
  const targetTickers = new Set(targets.map((t) => t.ticker));

  const rows: { ticker: string; targetPercent: number }[] = [
    ...targets.map((t) => ({ ticker: t.ticker, targetPercent: t.percent * scale })),
    ...Object.entries(category.holdings)
      .filter(([t, shares]) => !targetTickers.has(t) && shares !== 0)
      .map(([t]) => t)
      .sort()
      .map((ticker) => ({ ticker, targetPercent: 0 })),
  ];

  const missingPrices: string[] = [];
  const partial = rows.map(({ ticker, targetPercent }) => {
    const shares = category.holdings[ticker] ?? 0;
    const priceUsd = validPrice(prices, ticker);
    if (priceUsd === null && (shares > 0 || targetPercent > 0)) missingPrices.push(ticker);
    return { ticker, shares, priceUsd, valueUsd: priceUsd === null ? null : shares * priceUsd, targetPercent };
  });
  const investedUsd = partial.reduce((a, p) => a + (p.valueUsd ?? 0), 0);

  const positions: PositionView[] = partial.map((p) => {
    const weightPercent = p.valueUsd === null ? null : investedUsd > 0 ? (p.valueUsd / investedUsd) * 100 : 0;
    return { ...p, weightPercent, diffPercent: weightPercent === null ? null : weightPercent - p.targetPercent };
  });

  return { categoryId: category.id, investedUsd, cashIls: category.cashIls, positions, missingPrices };
}
