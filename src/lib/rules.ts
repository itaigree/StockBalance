import type { ContributionRule } from '../types';
import { fmtIls, fmtPercent } from './format';

/** One-line, plain-English description of a contribution rule. */
export function describeRule(rule: ContributionRule): string {
  switch (rule.kind) {
    case 'fixed':
      return `Gets ${fmtIls(rule.amountIls, true)} first`;
    case 'percent':
      return `Gets ${fmtPercent(rule.percent, rule.percent % 1 === 0 ? 0 : 1)} of what's left after fixed amounts`;
    case 'remainder':
      return 'Gets whatever is left';
    case 'none':
      return 'Gets nothing unless you type an amount';
  }
}

export const RULE_EXPLANATION =
  'When you invest, fixed amounts are taken first, then percentages of what is left, and whatever remains is shared equally by the "whatever is left" categories. You can always change the amounts before buying.';
