import type { Category, Transaction } from '../types';
import { categoryPurchaseSummary } from '../engine';
import { fmtDate, fmtIls, fmtRate, fmtShares, fmtUsd } from '../lib/format';
import './CategoryPurchases.css';

/** One category's purchases as a table (one row per purchase) with totals, like a hand-kept spreadsheet. */
export function CategoryPurchases({ category, transactions }: { category: Category; transactions: Transaction[] }) {
  const s = categoryPurchaseSummary(category, transactions);
  const t = s.totals;

  if (s.rows.length === 0) {
    return (
      <section className="card empty">
        <p>No purchases recorded for {category.name} yet.</p>
      </section>
    );
  }

  return (
    <>
      <section className="card" aria-label={`${category.name} totals`}>
        <div className="grid category-totals-grid">
          <div>
            <div className="muted small-text">Money put in</div>
            <div className="big-number">{fmtIls(t.newMoneyIls, true)}</div>
            <div className="muted small-text">≈ {fmtUsd(t.newMoneyUsd)} at each purchase's rate</div>
          </div>
          <div>
            <div className="muted small-text">Spent on stocks</div>
            <div className="big-number">{fmtUsd(t.spentUsd, true)}</div>
            <div className="muted small-text">{fmtIls(t.spentIls, true)} with conversion</div>
          </div>
          <div>
            <div className="muted small-text">Shares bought</div>
            {s.tickers
              .filter((tk) => t.shares[tk] > 0)
              .map((tk) => (
                <div key={tk}>
                  <strong>{fmtShares(t.shares[tk])}</strong> <span className="ticker">{tk}</span>{' '}
                  <span className="muted small-text">avg {fmtUsd(t.avgPriceUsd[tk])}</span>
                </div>
              ))}
          </div>
          <div>
            <div className="muted small-text">Left over</div>
            <div className="big-number">{fmtIls(t.leftoverIls, true)}</div>
            <div className="muted small-text">≈ {fmtUsd(t.leftoverUsd)}</div>
            {Math.abs(category.cashIls - t.leftoverIls) >= 0.5 && (
              <div className="muted small-text">Cash now: {fmtIls(category.cashIls)} (includes money from before)</div>
            )}
          </div>
        </div>
      </section>

      <section className="card" aria-label={`${category.name} purchases`}>
        <div className="table-wrap">
          <table className="purchases-table">
            <thead>
              <tr>
                <th>Date</th>
                <th className="num">Money (₪)</th>
                <th className="num">Rate</th>
                <th className="num">Money ($)</th>
                {s.tickers.map((tk) => (
                  <th key={tk} className="num" colSpan={2}>
                    {tk} bought · price
                  </th>
                ))}
                <th className="num">Bought ($)</th>
                <th className="num">Bought (₪)</th>
              </tr>
            </thead>
            <tbody>
              {s.rows.map((r) => (
                <tr key={r.txId}>
                  <td className="date-cell">
                    {fmtDate(r.date)}
                    {r.note && <div className="muted small-text">{r.note}</div>}
                  </td>
                  <td className="num">{fmtIls(r.newMoneyIls)}</td>
                  <td className="num">{fmtRate(r.usdIls)}</td>
                  <td className="num">{fmtUsd(r.newMoneyUsd)}</td>
                  {s.tickers.map((tk) => {
                    const b = r.buys[tk];
                    return [
                      <td key={`${tk}-n`} className="num">
                        {b ? fmtShares(b.shares) : <span className="muted">0</span>}
                      </td>,
                      <td key={`${tk}-p`} className="num muted">
                        {b ? fmtUsd(b.priceUsd) : ''}
                      </td>,
                    ];
                  })}
                  <td className="num">{fmtUsd(r.spentUsd)}</td>
                  <td className="num">{fmtIls(r.spentIls)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>Total</td>
                <td className="num">{fmtIls(t.newMoneyIls)}</td>
                <td />
                <td className="num">{fmtUsd(t.newMoneyUsd)}</td>
                {s.tickers.map((tk) => [
                  <td key={`${tk}-n`} className="num">
                    {fmtShares(t.shares[tk])}
                  </td>,
                  <td key={`${tk}-p`} className="num muted small-text">
                    {t.avgPriceUsd[tk] !== undefined ? `avg ${fmtUsd(t.avgPriceUsd[tk])}` : ''}
                  </td>,
                ])}
                <td className="num">{fmtUsd(t.spentUsd)}</td>
                <td className="num">{fmtIls(t.spentIls)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="muted small-text">
          "Money" is the new money given to {category.name} in that purchase; "Bought" is what its share of the orders cost.
          The difference stays as {category.name}'s cash for the next purchase.
        </p>
      </section>
    </>
  );
}
