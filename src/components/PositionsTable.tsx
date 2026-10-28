import { Fragment } from 'react';
import type { Category } from '../types';
import type { CategoryValuation } from '../engine';
import { useApp } from '../state/AppState';
import { groupOf } from '../lib/targetGroups';
import { fmtAgo, fmtPercent, fmtPp, fmtShares, fmtUsd } from '../lib/format';
import { WeightBar } from './WeightBar';

/** A category's stocks: shares, price, value and weight now vs target, with a summary row per group. */
export function PositionsTable({
  category,
  valuation,
  onEditPrice,
}: {
  category: Category;
  valuation: CategoryValuation;
  onEditPrice: (ticker: string) => void;
}) {
  const { data } = useApp();
  return (
    <div className="table-wrap">
      <table className="positions">
        <thead>
          <tr>
            <th>Stock</th>
            <th className="num">Shares</th>
            <th className="num hide-sm">Price</th>
            <th className="num hide-sm">Value</th>
            <th className="bar-col hide-sm">Now vs target</th>
            <th className="num">Now</th>
            <th className="num">Target</th>
            <th className="num">Difference</th>
          </tr>
        </thead>
        <tbody>
          {valuation.positions.map((p, idx) => {
            const quote = data.prices[p.ticker];
            const isTarget = p.targetPercent > 0;
            const group = isTarget ? groupOf(category, p.ticker) : undefined;
            const firstOfGroup =
              group !== undefined &&
              !valuation.positions.slice(0, idx).some((x) => groupOf(category, x.ticker) === group);
            return (
              <Fragment key={p.ticker}>
                {firstOfGroup && <GroupRow name={group} category={category} valuation={valuation} />}
                <tr className={group ? 'member-row' : undefined}>
                  <td>
                    <span className="ticker">{p.ticker}</span>
                    {!isTarget && (
                      <>
                        {' '}
                        <span className="badge" title="Kept, but never bought by this category">
                          not a target
                        </span>
                      </>
                    )}
                    {p.priceUsd === null && (
                      <>
                        {' '}
                        <button type="button" className="link-button show-sm" onClick={() => onEditPrice(p.ticker)}>
                          enter price
                        </button>
                      </>
                    )}
                  </td>
                  <td className="num">{fmtShares(p.shares)}</td>
                  <td className="num hide-sm">
                    {p.priceUsd !== null ? (
                      <button
                        type="button"
                        className="price-button"
                        onClick={() => onEditPrice(p.ticker)}
                        title={
                          quote
                            ? `${quote.source === 'manual' ? 'Entered manually' : `From ${quote.source}`}, ${fmtAgo(quote.asOf)}. Click to change.`
                            : undefined
                        }
                      >
                        {fmtUsd(p.priceUsd)}
                        {quote?.source === 'manual' && <span className="badge">manual</span>}
                      </button>
                    ) : (
                      <button type="button" className="small warn-button" onClick={() => onEditPrice(p.ticker)}>
                        Enter price
                      </button>
                    )}
                  </td>
                  <td className="num hide-sm">{p.valueUsd !== null ? fmtUsd(p.valueUsd) : '—'}</td>
                  <td className="bar-col hide-sm">
                    <WeightBar current={p.weightPercent} target={p.targetPercent} color={category.color} />
                  </td>
                  <td className="num">{p.weightPercent !== null ? fmtPercent(p.weightPercent) : '—'}</td>
                  <td className="num">{isTarget ? fmtPercent(p.targetPercent) : '—'}</td>
                  <td className={`num ${diffClass(p.diffPercent)}`}>
                    {p.diffPercent !== null ? fmtPp(p.diffPercent) : '—'}
                  </td>
                </tr>
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function diffClass(diff: number | null): string {
  if (diff === null) return '';
  const d = Math.abs(diff);
  return d >= 5 ? 'bad-text' : d >= 2 ? 'warn-text' : '';
}

/** Summary row for a group of stocks sharing one target: combined value and weight. */
function GroupRow({ name, category, valuation }: { name: string; category: Category; valuation: CategoryValuation }) {
  const members = valuation.positions.filter((p) => p.targetPercent > 0 && groupOf(category, p.ticker) === name);
  const value = members.reduce((s, p) => s + (p.valueUsd ?? 0), 0);
  const weight = members.every((p) => p.weightPercent !== null)
    ? members.reduce((s, p) => s + (p.weightPercent ?? 0), 0)
    : null;
  const target = members.reduce((s, p) => s + p.targetPercent, 0);
  const diff = weight === null ? null : weight - target;
  return (
    <tr className="group-row">
      <td>
        <strong>{name}</strong> <span className="badge">group</span>
      </td>
      <td />
      <td className="hide-sm" />
      <td className="num hide-sm">{fmtUsd(value)}</td>
      <td className="bar-col hide-sm">
        <WeightBar current={weight} target={target} color={category.color} />
      </td>
      <td className="num">
        <strong>{weight !== null ? fmtPercent(weight) : '—'}</strong>
      </td>
      <td className="num">
        <strong>{fmtPercent(target)}</strong>
      </td>
      <td className={`num ${diffClass(diff)}`}>{diff !== null ? fmtPp(diff) : '—'}</td>
    </tr>
  );
}
