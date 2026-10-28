// Domain model for StockBalance.
//
// All stocks are priced in USD. Money to invest is entered in ILS and
// converted at the USD/ILS rate (ILS per 1 USD), optionally plus a broker
// conversion fee. Categories are *virtual* sub-accounts of a single broker
// account: the same ticker can be owned by several categories, and a category
// may own a fractional number of shares even when the broker only trades whole
// shares (the whole shares bought in one order are split between categories).

export type Id = string;

/** How much of the money being invested a category receives by default. */
export type ContributionRule =
  /** A fixed amount in ILS, taken first. */
  | { kind: 'fixed'; amountIls: number }
  /** A percentage of what is left after all fixed amounts. */
  | { kind: 'percent'; percent: number }
  /** Splits (equally with other "remainder" categories) whatever is left after fixed and percent amounts. */
  | { kind: 'remainder' }
  /** Receives nothing unless the amount is typed in manually in the planner. */
  | { kind: 'none' };

export interface TargetWeight {
  /** Upper-case ticker symbol, e.g. "VOO". */
  ticker: string;
  /** Desired share of the category's invested value, 0..100. A category's targets should sum to 100. */
  percent: number;
  /**
   * Name of the group this stock belongs to (e.g. "Corporates"). A group's stocks share its target
   * equally; each stock's `percent` is its part of it. Only used for display and editing.
   */
  group?: string;
}

export interface Category {
  id: Id;
  name: string;
  /** CSS hex color used to tag the category in the UI. */
  color: string;
  targets: TargetWeight[];
  /**
   * Shares owned by this category, by ticker. May include tickers that are not
   * in `targets` (they count toward the category's value but are never bought).
   */
  holdings: Record<string, number>;
  /**
   * Money assigned to this category that is not invested yet (ILS), e.g. a
   * leftover from an earlier purchase. Can be negative if a purchase cost more
   * than planned.
   */
  cashIls: number;
  contribution: ContributionRule;
  notes?: string;
}

export type PriceSource = 'yahoo' | 'finnhub' | 'manual';

export interface PriceQuote {
  priceUsd: number;
  /** ISO timestamp of when the price was fetched or entered. */
  asOf: string;
  source: PriceSource;
}

export type FxSource = 'yahoo' | 'frankfurter' | 'open-er-api' | 'manual';

export interface FxQuote {
  /** ILS per 1 USD, e.g. 3.65. */
  usdIls: number;
  asOf: string;
  source: FxSource;
}

/** Where prices come from. "auto" tries Yahoo (via the local dev server proxy), then Finnhub if a key is set. */
export type PriceProviderSetting = 'auto' | 'yahoo' | 'finnhub' | 'manual';

export interface Settings {
  priceProvider: PriceProviderSetting;
  /** Free API key from finnhub.io; empty string when not set. */
  finnhubApiKey: string;
  /**
   * Address of the user's own price forwarder (Cloudflare Worker, see worker/yahoo-proxy.js) for
   * Yahoo prices on a hosted copy; empty string = use the local dev server's /api/yahoo.
   */
  yahooProxyUrl: string;
  /** Broker currency conversion fee/spread in percent (0.3 means converting costs 0.3% extra). */
  fxFeePercent: number;
  /** When true, broker orders are for whole shares only. */
  wholeShares: boolean;
  /** Skip buying a stock if its order would be smaller than this (USD). 0 = no minimum. */
  minOrderUsd: number;
  /** Buy at most this many different stocks in one purchase. null = no limit. */
  maxTickersPerPurchase: number | null;
}

/** One executed broker order (all categories combined). */
export interface TransactionOrder {
  ticker: string;
  shares: number;
  priceUsd: number;
}

/** The part of an order that belongs to one category. */
export interface TransactionAllocation {
  categoryId: Id;
  ticker: string;
  shares: number;
  costUsd: number;
}

/** Cash effect of a transaction on one category: cashIls += newMoneyIls - spentIls. */
export interface TransactionCategoryCash {
  categoryId: Id;
  /** New money given to the category in this purchase (ILS). */
  newMoneyIls: number;
  /** What the category's buys cost, converted to ILS including the conversion fee. */
  spentIls: number;
}

export interface Transaction {
  id: Id;
  /** ISO timestamp. */
  date: string;
  usdIls: number;
  fxFeePercent: number;
  orders: TransactionOrder[];
  allocations: TransactionAllocation[];
  cash: TransactionCategoryCash[];
  note?: string;
}

export interface AppData {
  version: 1;
  categories: Category[];
  /** Latest known price per ticker. */
  prices: Record<string, PriceQuote>;
  fx: FxQuote | null;
  settings: Settings;
  /** Purchase history, oldest first. */
  transactions: Transaction[];
}
