import { useState } from 'react';
import type { Category } from '../types';
import type { CategoryPlan, PlanResult } from '../engine';
import { fmtIls, fmtOrderShares, fmtPercent, fmtShares, fmtUsd } from '../lib/format';
import { groupOf } from '../lib/targetGroups';
import { WeightBar } from './WeightBar';
import './PlanResultView.css';

interface Props {
  plan: PlanResult;
  categories: Category[];
  wholeShares: boolean;
  onRecord: () => void;
  /** When nothing can be bought: record the new money as cash in its categories. */
  onKeepCash?: () => void;
  /** Stocks the user unticked: not bought this time, their money goes to the other stocks. */
  excluded: string[];
  onToggleExclude: (ticker: string) => void;
}

/** The answer to "what should I buy": headline, consolidated orders, and per-category details. */
export function PlanResultView({ plan, categories, wholeShares, onRecord, onKeepCash, excluded, onToggleExclude }: Props) {
  const [copied, setCopied] = useState<'yes' | 'failed' | null>(null);
  const byId = new Map(categories.map((c) => [c.id, c]));
  const funded = plan.categories.filter((c) => c.budgetIls > 0);

  const copy = async () => {
    const lines = [
      `Convert about ${fmtIls(plan.totals.spentIls)} to USD`,
      ...plan.orders.map((o) => `BUY ${fmtOrderShares(o.shares)} ${o.ticker} (~${fmtUsd(o.costUsd)})`),
    ];
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setCopied('yes');
    } catch {
      setCopied('failed');
    }
    setTimeout(() => setCopied(null), 2500);
  };

  return (
    <>
      {plan.errors.length > 0 && (
        <div className="banner error" role="alert">
          <strong>Can't calculate yet:</strong>
          <ul>
            {plan.errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}
      {plan.warnings.length > 0 && (
        <div className="banner warn">
          <ul>
            {plan.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {plan.errors.length === 0 && (
        <>
          <section className="card plan-headline" aria-label="What to do">
            {plan.orders.length > 0 ? (
              <>
                <div className="headline-items">
                  <div>
                    <div className="muted small-text">1. Convert</div>
                    <div className="big-number">{fmtIls(plan.totals.spentIls, true)}</div>
                    <div className="muted small-text">to about {fmtUsd(plan.totals.spentUsd)}</div>
                  </div>
                  <div>
                    <div className="muted small-text">2. Place</div>
                    <div className="big-number">
                      {plan.orders.length} order{plan.orders.length === 1 ? '' : 's'}
                    </div>
                    <div className="muted small-text">listed below</div>
                  </div>
                  {plan.totals.leftoverIls >= 0.5 && (
                    <div>
                      <div className="muted small-text">Stays as cash</div>
                      <div className="big-number">{fmtIls(plan.totals.leftoverIls, true)}</div>
                      <div className="muted small-text">kept for next time</div>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <>
                <p className="muted">
                  Nothing to buy with these amounts this time. Keep the money as cash in its categories, and it will be
                  added to what you invest next time.
                </p>
                {onKeepCash && (
                  <button type="button" onClick={onKeepCash}>
                    Keep the money as cash for next time
                  </button>
                )}
              </>
            )}
          </section>

          {(plan.orders.length > 0 || excluded.length > 0) && (
            <section className="card" aria-labelledby="orders-title">
              <div className="card-header">
                <h2 id="orders-title">Orders to place</h2>
                <button type="button" className="secondary small" onClick={copy}>
                  {copied === 'yes' ? 'Copied!' : copied === 'failed' ? "Couldn't copy" : 'Copy list'}
                </button>
              </div>
              <div className="table-wrap">
                <table className="orders">
                  <thead>
                    <tr>
                      <th className="check-col">
                        <span className="visually-hidden">Include</span>
                      </th>
                      <th>Buy</th>
                      <th className="num">Shares</th>
                      <th className="num">About</th>
                      <th className="num">Cost</th>
                      <th className="hide-sm">For</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plan.orders.map((o) => (
                      <tr key={o.ticker}>
                        <td className="check-col">
                          <input
                            type="checkbox"
                            checked
                            aria-label={`Buy ${o.ticker}`}
                            title="Untick to skip this stock; its money goes to the other stocks"
                            onChange={() => onToggleExclude(o.ticker)}
                          />
                        </td>
                        <td className="ticker">{o.ticker}</td>
                        <td className="num order-shares">{fmtOrderShares(o.shares)}</td>
                        <td className="num">{fmtUsd(o.priceUsd)}</td>
                        <td className="num">{fmtUsd(o.costUsd)}</td>
                        <td className="hide-sm">
                          <div className="for-chips">
                            {plan.categories
                              .filter((c) => c.buys.some((b) => b.ticker === o.ticker))
                              .map((c) => {
                                const cat = byId.get(c.categoryId);
                                const b = c.buys.find((x) => x.ticker === o.ticker)!;
                                return (
                                  <span key={c.categoryId} className="owner-chip">
                                    <span className="dot" style={{ background: cat?.color }} />
                                    {cat?.name} {fmtShares(b.shares)}
                                  </span>
                                );
                              })}
                          </div>
                        </td>
                      </tr>
                    ))}
                    {excluded.map((t) => (
                      <tr key={t} className="excluded-row">
                        <td className="check-col">
                          <input type="checkbox" checked={false} aria-label={`Buy ${t}`} onChange={() => onToggleExclude(t)} />
                        </td>
                        <td className="ticker">{t}</td>
                        <td colSpan={4} className="muted small-text">
                          Skipped this time — its money goes to the other stocks
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td />
                      <td>Total</td>
                      <td />
                      <td />
                      <td className="num">{fmtUsd(plan.totals.spentUsd)}</td>
                      <td className="hide-sm" />
                    </tr>
                  </tfoot>
                </table>
              </div>
              <p className="muted small-text">
                Prices are the latest known ones; the real price when you buy may be a little different. After buying,
                press "I made a purchase" and record what you actually bought, so your holdings stay correct.
              </p>
              {plan.orders.length > 0 && (
                <button type="button" onClick={onRecord}>
                  I made a purchase
                </button>
              )}
            </section>
          )}

          {funded.length > 0 && (
            <section aria-labelledby="per-category-title">
              <h2 id="per-category-title" className="section-title">
                Per category
              </h2>
              {wholeShares && plan.orders.length > 0 && (
                <p className="muted small-text">
                  Because all categories share one broker account, one order can be split between categories, so a
                  category may get part of a share.
                </p>
              )}
              {funded.map((c) => (
                <CategoryPlanCard key={c.categoryId} plan={c} category={byId.get(c.categoryId)} />
              ))}
            </section>
          )}
        </>
      )}
    </>
  );
}

function CategoryPlanCard({ plan, category }: { plan: CategoryPlan; category: Category | undefined }) {
  const color = category?.color ?? 'var(--accent)';
  const buyOf = new Map(plan.buys.map((b) => [b.ticker, b]));
  const beforeOf = new Map(plan.before.positions.map((p) => [p.ticker, p]));

  return (
    <section className="card" aria-label={`${category?.name ?? 'Category'} plan`}>
      <div className="card-header">
        <h3 className="row">
          <span className="dot" style={{ background: color }} />
          {category?.name ?? '(deleted category)'}
        </h3>
        <div className="plan-money small-text">
          <span>
            <span className="muted">Budget </span>
            {fmtIls(plan.budgetIls)}
          </span>
          <span>
            <span className="muted">Buying </span>
            {fmtIls(plan.spentIls)}
          </span>
          <span>
            <span className="muted">Left as cash </span>
            {fmtIls(plan.leftoverIls)}
          </span>
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Stock</th>
              <th className="num">Buy</th>
              <th className="num hide-sm">Cost</th>
              <th className="bar-col hide-sm">Before → after</th>
              <th className="num">Now</th>
              <th className="num">After</th>
              <th className="num">Target</th>
            </tr>
          </thead>
          <tbody>
            {plan.after.positions.map((p) => {
              const b = buyOf.get(p.ticker);
              const before = beforeOf.get(p.ticker);
              return (
                <tr key={p.ticker} className={b ? 'buying' : undefined}>
                  <td>
                    <span className="ticker">{p.ticker}</span>
                    {category && groupOf(category, p.ticker) && <div className="muted small-text">{groupOf(category, p.ticker)}</div>}
                  </td>
                  <td className="num">{b ? fmtShares(b.shares) : <span className="muted">—</span>}</td>
                  <td className="num hide-sm">{b ? fmtUsd(b.costUsd) : ''}</td>
                  <td className="bar-col hide-sm">
                    <WeightBar current={before?.weightPercent ?? 0} after={p.weightPercent} target={p.targetPercent} color={color} />
                  </td>
                  <td className="num">{before?.weightPercent != null ? fmtPercent(before.weightPercent) : '—'}</td>
                  <td className="num">
                    <strong>{p.weightPercent !== null ? fmtPercent(p.weightPercent) : '—'}</strong>
                  </td>
                  <td className="num">{p.targetPercent > 0 ? fmtPercent(p.targetPercent) : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
