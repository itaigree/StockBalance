import type { Category, Id } from '../types';

export interface SplitResult {
  /** ILS amount per category id (every category in the input has an entry). */
  amounts: Record<Id, number>;
  /** Money not assigned to any category (ILS). */
  unassignedIls: number;
  warnings: string[];
}

/** One ticker inside a category, valued at current prices. */
export interface PositionView {
  ticker: string;
  shares: number;
  /** null when the price is unknown. */
  priceUsd: number | null;
  valueUsd: number | null;
  /** Share of the category's invested value, 0..100; null when it can't be computed. */
  weightPercent: number | null;
  /** Target weight 0..100 (0 for held tickers that are not targets). */
  targetPercent: number;
  /** weightPercent − targetPercent, in percentage points; null when weight is unknown. */
  diffPercent: number | null;
}

export interface CategoryValuation {
  categoryId: Id;
  /** Σ shares × price of tickers with a known price (USD). */
  investedUsd: number;
  cashIls: number;
  /** Positions: target tickers first (in target order), then other held tickers alphabetically. */
  positions: PositionView[];
  /** Held or target tickers with no valid price. */
  missingPrices: string[];
}

export interface PlanOptions {
  wholeShares: boolean;
  /** 0 = no minimum. */
  minOrderUsd: number;
  /** null = no limit. */
  maxTickers: number | null;
}

export interface PlanInput {
  categories: Category[];
  /** USD price per ticker. */
  prices: Record<string, number>;
  /** ILS per USD. */
  usdIls: number;
  fxFeePercent: number;
  /** Money (ILS) each category may spend now. Missing id = 0. */
  budgetsIls: Record<Id, number>;
  options: PlanOptions;
}

export interface PlannedOrder {
  ticker: string;
  shares: number;
  priceUsd: number;
  costUsd: number;
}

export interface PlannedBuy {
  ticker: string;
  /** May be fractional (a category's part of a whole-share order). */
  shares: number;
  costUsd: number;
}

export interface CategoryPlan {
  categoryId: Id;
  budgetIls: number;
  budgetUsd: number;
  buys: PlannedBuy[];
  spentUsd: number;
  /** Including the FX fee. */
  spentIls: number;
  leftoverIls: number;
  before: CategoryValuation;
  after: CategoryValuation;
}

export interface PlanResult {
  orders: PlannedOrder[];
  categories: CategoryPlan[];
  totals: {
    budgetIls: number;
    spentUsd: number;
    /** ILS to convert to USD for the orders (including fee). */
    spentIls: number;
    leftoverIls: number;
  };
  warnings: string[];
  /** Blocking problems; when non-empty, `orders` is empty. */
  errors: string[];
}

export interface ExecutedPurchase {
  /** What was actually bought, one entry per planned ticker (shares may be 0 = not bought). */
  orders: { ticker: string; shares: number; priceUsd: number }[];
  usdIls: number;
  fxFeePercent: number;
  /** ISO timestamp. */
  date: string;
  /** New money given to each category in this purchase (ILS). */
  newMoneyIls: Record<Id, number>;
  note?: string;
}
