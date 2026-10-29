import type { BuyStrategy } from '../types';
import type { PlanResult } from '../engine';

const KEY = 'stockbalance:invest-draft';

/** What the user entered on the Invest page. */
export interface InvestInputs {
  total: number | null;
  overrides: Record<string, number | null>;
  /** Category that gets whatever is left of the total (optional: older drafts don't have it). */
  restId?: string | null;
  useCash: boolean;
  wholeShares: boolean;
  minOrder: number | null;
  maxTickers: number | null;
  feePercent: number | null;
  rateOverride: number | null;
  /** Stocks the user unticked for this purchase (optional: older drafts don't have it). */
  excluded?: string[];
  /** How each category's money is spread (optional: older drafts don't have it). */
  strategy?: BuyStrategy;
}

/** A plan as it was shown, with what is needed to record it later. */
export interface SavedPlan {
  savedAt: string;
  plan: PlanResult;
  newMoneyIls: Record<string, number>;
  usdIls: number;
  fxFeePercent: number;
}

export interface InvestDraft {
  inputs: InvestInputs;
  saved: SavedPlan;
}

/**
 * The last plan shown on the Invest page, kept in this browser so that after a reload (which also
 * refreshes prices) the user still sees — and records — the plan they actually placed.
 */
export function loadDraft(storage: Storage | null = safeStorage()): InvestDraft | null {
  try {
    const raw = storage?.getItem(KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as InvestDraft;
    const p = d?.saved?.plan;
    const looksValid =
      typeof d.saved.savedAt === 'string' &&
      typeof d.saved.usdIls === 'number' &&
      typeof d.saved.fxFeePercent === 'number' &&
      typeof d.saved.newMoneyIls === 'object' &&
      Array.isArray(p?.orders) &&
      Array.isArray(p?.categories) &&
      p.categories.every((c) => Array.isArray(c.buys) && Array.isArray(c.before?.positions) && Array.isArray(c.after?.positions)) &&
      typeof d.inputs === 'object' &&
      d.inputs !== null;
    return looksValid ? d : null;
  } catch {
    return null;
  }
}

export function saveDraft(draft: InvestDraft, storage: Storage | null = safeStorage()): void {
  try {
    storage?.setItem(KEY, JSON.stringify(draft));
  } catch {
    // Only a convenience; ignore storage problems.
  }
}

export function clearDraft(storage: Storage | null = safeStorage()): void {
  try {
    storage?.removeItem(KEY);
  } catch {
    // Ignore.
  }
}

function safeStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
