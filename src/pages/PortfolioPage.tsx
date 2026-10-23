import { useMemo, useState } from 'react';
import type { Category } from '../types';
import { valueCategory, type CategoryValuation } from '../engine';
import { sampleData } from '../data/sample';
import { allTickers, priceMap, useApp } from '../state/AppState';
import { navigateTo } from '../lib/router';
import { fmtAgo, fmtIls, fmtPercent, fmtPp, fmtShares, fmtUsd } from '../lib/format';
import { MarketBar } from '../components/MarketBar';
import { PriceEditModal } from '../components/PriceEditModal';
import { WeightBar } from '../components/WeightBar';
import './PortfolioPage.css';

export function PortfolioPage() {
  const { data } = useApp();
  const [editing, setEditing] = useState<string | null>(null);
  const prices = useMemo(() => priceMap(data.prices), [data.prices]);
  const valuations = useMemo(() => data.categories.map((c) => valueCategory(c, prices)), [data.categories, prices]);

  if (data.categories.length === 0) return <Welcome />;

  const rate = data.fx?.usdIls ?? null;
  const investedUsd = valuations.reduce((s, v) => s + v.investedUsd, 0);
  const cashIls = data.categories.reduce((s, c) => s + c.cashIls, 0);

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Portfolio</h1>
          <p className="muted">What you own, by category, compared with your targets.</p>
        </div>
        <button type="button" onClick={() => navigateTo('invest')}>
          Invest money
        </button>
      </div>

      <MarketBar />

      <section className="card summary" aria-label="Summary">
        <div className="grid">
          <div>
            <div className="muted small-text">Total value</div>
            <div className="big-number">{rate ? fmtIls(investedUsd * rate + cashIls, true) : fmtUsd(investedUsd, true)}</div>
            <div className="muted small-text">
              {rate ? `${fmtUsd(investedUsd, true)} in stocks` : 'Set the USD/ILS rate to see shekel values'}
              {cashIls !== 0 && ` + ${fmtIls(cashIls, true)} cash`}
            </div>
          </div>
          <div>
            <div className="muted small-text">In stocks</div>
            <div className="big-number">{fmtUsd(investedUsd, true)}</div>
            {rate && <div className="muted small-text">{fmtIls(investedUsd * rate, true)}</div>}
          </div>
          <div>
            <div className="muted small-text">Not invested yet</div>
            <div className={`big-number${cashIls < 0 ? ' bad-text' : ''}`}>{fmtIls(cashIls, true)}</div>
            <div className="muted small-text">Cash kept for each category</div>
          </div>
        </div>
        {investedUsd > 0 && <CategoryShareBar categories={data.categories} valuations={valuations} total={investedUsd} />}
      </section>

      {data.categories.map((c, i) => (
        <CategoryCard key={c.id} category={c} valuation={valuations[i]} rate={rate} onEditPrice={setEditing} />
      ))}

      <BrokerView categories={data.categories} prices={prices} onEditPrice={setEditing} />

      {editing && <PriceEditModal ticker={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function Welcome() {
  const { actions } = useApp();
  return (
    <section className="card empty">
      <h1>Welcome to StockBalance</h1>
      <p>
        Split your stocks into categories — for example pension, the kids' savings and investments — and set how much of
        each stock every category should hold.
      </p>
      <p>
        When you have money to invest, the app tells you exactly what to buy so every category stays balanced, combined
        into as few orders as possible.
      </p>
      <div className="row" style={{ justifyContent: 'center' }}>
        <button type="button" onClick={() => navigateTo('categories')}>
          Set up categories
        </button>
        <button
          type="button"
          className="secondary"
          onClick={() => {
            const sample = sampleData();
            actions.replaceData(sample);
            void actions.refreshMarket(allTickers(sample.categories));
          }}
        >
          Load sample data
        </button>
      </div>
      <p className="small-text" style={{ marginTop: '1rem' }}>
        Your data stays in this browser. Nothing is uploaded.
      </p>
    </section>
  );
}

function CategoryShareBar({ categories, valuations, total }: { categories: Category[]; valuations: CategoryValuation[]; total: number }) {
  return (
    <div className="category-share">
      <div className="stacked-bar" role="img" aria-label="Share of each category in the stocks you own">
        {categories.map((c, i) =>
          valuations[i].investedUsd > 0 ? (
            <div
              key={c.id}
              style={{ width: `${(valuations[i].investedUsd / total) * 100}%`, background: c.color }}
              title={`${c.name}: ${fmtPercent((valuations[i].investedUsd / total) * 100)}`}
            />
          ) : null,
        )}
      </div>
      <ul className="legend">
        {categories.map((c, i) => (
          <li key={c.id}>
            <span className="dot" style={{ background: c.color }} />
            {c.name} <span className="muted">{fmtPercent((valuations[i].investedUsd / total) * 100, 0)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function diffClass(diff: number | null): string {
  if (diff === null) return '';
  const d = Math.abs(diff);
  return d >= 5 ? 'bad-text' : d >= 2 ? 'warn-text' : '';
}

function CategoryCard({
  category,
  valuation,
  rate,
  onEditPrice,
}: {
  category: Category;
  valuation: CategoryValuation;
  rate: number | null;
  onEditPrice: (ticker: string) => void;
}) {
  const { data } = useApp();
  const hasTargets = category.targets.some((t) => t.percent > 0);

  return (
    <section className="card category-card" aria-labelledby={`cat-${category.id}`}>
      <div className="card-header">
        <h2 id={`cat-${category.id}`} className="row">
          <span className="dot" style={{ background: category.color }} />
          {category.name}
        </h2>
        <div className="category-totals">
          <span>
            <span className="muted">Stocks </span>
            <strong>{fmtUsd(valuation.investedUsd)}</strong>
            {rate && <span className="muted"> ({fmtIls(valuation.investedUsd * rate, true)})</span>}
          </span>
          {category.cashIls !== 0 && (
            <span>
              <span className="muted">Cash </span>
              <strong className={category.cashIls < 0 ? 'bad-text' : ''}>{fmtIls(category.cashIls)}</strong>
            </span>
          )}
        </div>
      </div>

      {!hasTargets && (
        <p className="banner info">
          This category has no target stocks yet.{' '}
          <button type="button" className="link-button" onClick={() => navigateTo('categories')}>
            Set its targets
          </button>
        </p>
      )}

      {valuation.positions.length > 0 ? (
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
              {valuation.positions.map((p) => {
                const quote = data.prices[p.ticker];
                const isTarget = p.targetPercent > 0;
                return (
                  <tr key={p.ticker}>
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
                          title={quote ? `${quote.source === 'manual' ? 'Entered manually' : `From ${quote.source}`}, ${fmtAgo(quote.asOf)}. Click to change.` : undefined}
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
                    <td className={`num ${diffClass(p.diffPercent)}`}>{p.diffPercent !== null ? fmtPp(p.diffPercent) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted">No stocks yet.</p>
      )}
    </section>
  );
}

function BrokerView({
  categories,
  prices,
  onEditPrice,
}: {
  categories: Category[];
  prices: Record<string, number>;
  onEditPrice: (ticker: string) => void;
}) {
  const rows = allTickers(categories)
    .map((ticker) => {
      const owners = categories
        .filter((c) => (c.holdings[ticker] ?? 0) > 0)
        .map((c) => ({ category: c, shares: c.holdings[ticker] }));
      const shares = owners.reduce((s, o) => s + o.shares, 0);
      const price = prices[ticker] ?? null;
      return { ticker, owners, shares, price, value: price !== null ? shares * price : null };
    })
    .filter((r) => r.shares > 0);
  const total = rows.reduce((s, r) => s + (r.value ?? 0), 0);

  return (
    <details className="card broker-view">
      <summary>
        <h2>Broker view</h2>
        <span className="muted small-text">Total shares of each stock across all categories</span>
      </summary>
      <p className="muted small-text">Compare these totals with your broker statement — they should match.</p>
      {rows.length === 0 ? (
        <p className="muted">You don't own any shares yet.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Stock</th>
                <th className="num">Total shares</th>
                <th className="num">Price</th>
                <th className="num">Value</th>
                <th>Owned by</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.ticker}>
                  <td className="ticker">{r.ticker}</td>
                  <td className="num">{fmtShares(r.shares)}</td>
                  <td className="num">
                    {r.price !== null ? (
                      fmtUsd(r.price)
                    ) : (
                      <button type="button" className="small warn-button" onClick={() => onEditPrice(r.ticker)}>
                        Enter price
                      </button>
                    )}
                  </td>
                  <td className="num">{r.value !== null ? fmtUsd(r.value) : '—'}</td>
                  <td>
                    <div className="owners">
                      {r.owners.map((o) => (
                        <span key={o.category.id} className="owner-chip">
                          <span className="dot" style={{ background: o.category.color }} />
                          {o.category.name} {fmtShares(o.shares)}
                        </span>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>Total</td>
                <td />
                <td />
                <td className="num">{fmtUsd(total)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </details>
  );
}
