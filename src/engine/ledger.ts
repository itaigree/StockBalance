import type { Category, Transaction } from '../types';
import type { ExecutedPurchase, PlanResult } from './types';

/** Build a transaction from a plan and what was actually executed. See docs/DESIGN.md. */
export function transactionFromPlan(plan: PlanResult, executed: ExecutedPurchase, id: string): Transaction {
  void plan;
  void executed;
  void id;
  throw new Error('not implemented');
}

/** Add a transaction's shares and cash effect to the categories (returns new objects; input untouched). */
export function applyTransaction(categories: Category[], tx: Transaction): Category[] {
  void categories;
  void tx;
  throw new Error('not implemented');
}

/** Undo `applyTransaction`. Categories that no longer exist are skipped. */
export function revertTransaction(categories: Category[], tx: Transaction): Category[] {
  void categories;
  void tx;
  throw new Error('not implemented');
}
