import type { Category } from '../types';
import { fmtIls, fmtPercent } from '../lib/format';
import { apportion } from './apportion';
import type { SplitResult } from './types';

/** Split a total ILS amount between categories by their contribution rules. See docs/DESIGN.md. */
export function splitContribution(
  totalIls: number,
  categories: Pick<Category, 'id' | 'name' | 'contribution'>[],
): SplitResult {
  const amounts: Record<string, number> = {};
  for (const c of categories) amounts[c.id] = 0;
  const warnings: string[] = [];

  if (!Number.isFinite(totalIls) || totalIls < 0) {
    warnings.push('The amount to invest must be a positive number.');
    return { amounts, unassignedIls: 0, warnings };
  }
  if (totalIls === 0) return { amounts, unassignedIls: 0, warnings };

  const raw = new Map<string, number>(categories.map((c) => [c.id, 0]));
  const valid = (n: number, c: Pick<Category, 'name'>, what: string) => {
    if (Number.isFinite(n) && n >= 0) return n;
    warnings.push(`${c.name}: the ${what} is invalid, so it was ignored.`);
    return 0;
  };

  // 1. Fixed amounts first.
  const fixed = categories.flatMap((c) =>
    c.contribution.kind === 'fixed' ? [{ id: c.id, amount: valid(c.contribution.amountIls, c, 'fixed amount') }] : [],
  );
  const fixedSum = fixed.reduce((a, f) => a + f.amount, 0);
  const fixedScale = fixedSum > totalIls ? totalIls / fixedSum : 1;
  if (fixedScale < 1) {
    warnings.push(
      `The fixed amounts (${fmtIls(fixedSum)}) are more than the total (${fmtIls(totalIls)}), so they were scaled down.`,
    );
  }
  for (const f of fixed) raw.set(f.id, f.amount * fixedScale);
  const afterFixed = Math.max(0, totalIls - fixedSum * fixedScale);

  // 2. Percentages of what is left.
  const percent = categories.flatMap((c) =>
    c.contribution.kind === 'percent' ? [{ id: c.id, percent: valid(c.contribution.percent, c, 'percentage') }] : [],
  );
  const percentSum = percent.reduce((a, p) => a + p.percent, 0);
  const percentScale = percentSum > 100 ? 100 / percentSum : 1;
  if (percentScale < 1) {
    warnings.push(`The percentages add up to ${fmtPercent(percentSum)}, so they were scaled down to 100%.`);
  }
  let percentTotal = 0;
  for (const p of percent) {
    const amount = (afterFixed * p.percent * percentScale) / 100;
    raw.set(p.id, amount);
    percentTotal += amount;
  }
  const rest = Math.max(0, afterFixed - percentTotal);

  // 3. The rest goes equally to "remainder" categories.
  const remainder = categories.filter((c) => c.contribution.kind === 'remainder');
  let unassigned = 0;
  if (remainder.length > 0) {
    for (const c of remainder) raw.set(c.id, rest / remainder.length);
  } else {
    unassigned = rest;
    if (rest >= 0.005) {
      warnings.push(
        `${fmtIls(rest)} isn't assigned to any category (no category is set to get "whatever is left").`,
      );
    }
  }

  // Round to agorot so that everything adds up exactly to the total.
  const ids = categories.map((c) => c.id);
  const rounded = apportion(totalIls, [...ids.map((id) => raw.get(id) ?? 0), unassigned], 2);
  ids.forEach((id, i) => (amounts[id] = rounded[i]));
  return { amounts, unassignedIls: rounded[ids.length], warnings };
}
