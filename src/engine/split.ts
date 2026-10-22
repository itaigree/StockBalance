import type { Category } from '../types';
import type { SplitResult } from './types';

/** Split a total ILS amount between categories by their contribution rules. See docs/DESIGN.md. */
export function splitContribution(
  totalIls: number,
  categories: Pick<Category, 'id' | 'name' | 'contribution'>[],
): SplitResult {
  void totalIls;
  void categories;
  throw new Error('not implemented');
}
