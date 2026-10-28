import { useState } from 'react';
import type { Category, Transaction } from '../types';
import { useApp } from '../state/AppState';
import { fmtDate, fmtIls, fmtRate, fmtShares, fmtUsd, isZeroMoney } from '../lib/format';
import { Modal } from './Modal';
import './AllPurchases.css';

/** Every recorded purchase, newest first, each with its orders, per-category details and Undo. */
export function AllPurchases() {
  const { data, actions } = useApp();
  const [undoing, setUndoing] = useState<Transaction | null>(null);
  const byId = new Map(data.categories.map((c) => [c.id, c]));
  const transactions = [...data.transactions].reverse();

  return (
    <details className="card all-purchases">
      <summary>
        <h2>All purchases</h2>
        <span className="muted small-text">
          {transactions.length === 0
            ? 'None recorded yet'
            : `${transactions.length} recorded, newest first — check them or undo a mistake`}
        </span>
      </summary>
      {transactions.length === 0 ? (
        <p className="muted">After you buy, record the purchase on the Invest page and it will show up here.</p>
      ) : (
        transactions.map((tx) => <TransactionCard key={tx.id} tx={tx} byId={byId} onUndo={() => setUndoing(tx)} />)
      )}

      {undoing && (
        <UndoModal
          tx={undoing}
          categories={data.categories}
          onClose={() => setUndoing(null)}
          onConfirm={() => {
            actions.undoTransaction(undoing.id);
            setUndoing(null);
          }}
        />
      )}
    </details>
  );
}

function TransactionCard({ tx, byId, onUndo }: { tx: Transaction; byId: Map<string, Category>; onUndo: () => void }) {
  const totalUsd = tx.orders.reduce((s, o) => s + o.shares * o.priceUsd, 0);
  const totalIls = totalUsd * tx.usdIls * (1 + tx.fxFeePercent / 100);
  const categoryIds = [...new Set([...tx.cash.map((c) => c.categoryId), ...tx.allocations.map((a) => a.categoryId)])];

  return (
    <article className="tx-card" aria-label={`Purchase on ${fmtDate(tx.date)}`}>
      <div className="card-header">
        <div>
          <h2>{fmtDate(tx.date)}</h2>
          <div className="muted small-text">
            {tx.orders.length === 0 ? (
              `${fmtIls(tx.cash.reduce((s, c) => s + c.newMoneyIls, 0))} kept as cash`
            ) : (
              <>
                {fmtUsd(totalUsd)} · {fmtIls(totalIls)} at {fmtRate(tx.usdIls)}
                {tx.fxFeePercent > 0 && ` + ${tx.fxFeePercent}% fee`}
              </>
            )}
          </div>
        </div>
        <button type="button" className="secondary small" onClick={onUndo}>
          Undo
        </button>
      </div>
      {tx.orders.length === 0 && <p className="muted">Nothing was bought; the money was added to the categories' cash.</p>}
      <ul className="tx-orders">
        {tx.orders.map((o) => (
          <li key={o.ticker}>
            {fmtShares(o.shares)} × <span className="ticker">{o.ticker}</span> @ {fmtUsd(o.priceUsd)}
          </li>
        ))}
      </ul>
      {tx.note && <p className="tx-note">{tx.note}</p>}
      <details>
        <summary>By category</summary>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Category</th>
                <th>Bought</th>
                <th className="num">New money</th>
                <th className="num">Spent</th>
                <th className="num">Cash change</th>
              </tr>
            </thead>
            <tbody>
              {categoryIds.map((id) => {
                const cat = byId.get(id);
                const cash = tx.cash.find((c) => c.categoryId === id);
                const allocations = tx.allocations.filter((a) => a.categoryId === id);
                const change = (cash?.newMoneyIls ?? 0) - (cash?.spentIls ?? 0);
                return (
                  <tr key={id}>
                    <td>
                      {cat ? (
                        <>
                          <span className="dot" style={{ background: cat.color }} />
                          {cat.name}
                        </>
                      ) : (
                        <span className="muted">(deleted category)</span>
                      )}
                    </td>
                    <td>
                      {allocations.length > 0
                        ? allocations.map((a) => `${fmtShares(a.shares)} ${a.ticker}`).join(', ')
                        : <span className="muted">—</span>}
                    </td>
                    <td className="num">{fmtIls(cash?.newMoneyIls ?? 0)}</td>
                    <td className="num">{fmtIls(cash?.spentIls ?? 0)}</td>
                    <td className={`num${change < 0 && !isZeroMoney(change) ? ' bad-text' : ''}`}>
                      {change >= 0 || isZeroMoney(change) ? '+' : '−'}
                      {fmtIls(Math.abs(change))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </details>
    </article>
  );
}

export function UndoModal({
  tx,
  categories,
  onClose,
  onConfirm,
}: {
  tx: Transaction;
  categories: Category[];
  onClose: () => void;
  onConfirm: () => void;
}) {
  // Holdings that were changed by hand since the purchase may hold fewer shares than it added.
  const short = tx.allocations.flatMap((a) => {
    const c = categories.find((x) => x.id === a.categoryId);
    if (!c) return [];
    const have = c.holdings[a.ticker] ?? 0;
    return have + 1e-9 < a.shares ? [`${c.name}: ${a.ticker} (has ${fmtShares(have)}, the purchase added ${fmtShares(a.shares)})`] : [];
  });
  const missing = new Set(tx.allocations.map((a) => a.categoryId).filter((id) => !categories.some((c) => c.id === id))).size;

  return (
    <Modal
      title="Undo this purchase?"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="danger" onClick={onConfirm}>
            Undo purchase
          </button>
        </>
      }
    >
      <p>
        The shares it added will be removed from your categories, its cash changes reversed, and it will be deleted from
        the list of purchases. Use this if you recorded something by mistake.
      </p>
      {short.length > 0 && (
        <div className="banner warn">
          These categories now own fewer shares than the purchase gave them, so they will be set to 0:
          <ul>
            {short.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </div>
      )}
      {missing > 0 && <p className="muted small-text">Categories that were deleted since are skipped.</p>}
    </Modal>
  );
}
