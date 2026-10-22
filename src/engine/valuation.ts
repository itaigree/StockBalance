import type { Category } from '../types';
import type { CategoryValuation } from './types';

/** Value a category's holdings at the given USD prices. See docs/DESIGN.md. */
export function valueCategory(category: Category, prices: Record<string, number>): CategoryValuation {
  void category;
  void prices;
  throw new Error('not implemented');
}
