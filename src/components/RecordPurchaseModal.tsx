import { useState } from 'react';
import type { Id } from '../types';
import { transactionFromPlan, type PlanResult } from '../engine';
import { useApp } from '../state/AppState';
import { newId } from '../lib/ids';
import { fmtIls, fmtShares, fmtUsd } from '../lib/format';
import { Modal } from './Modal';
import { NumberField } from './NumberField';

interface Props {
  plan: PlanResult;
  /** New money given to each category in this purchase (carried-over cash not included). */
  newMoneyIls: Record<Id, number>;
  usdIls: number;
  fxFeePercent: number;
  onClose: () => void;
  onRecorded: () => void;
}

function todayLocal(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Confirm (and correct) what was actually bought, then record it. */
export function RecordPurchaseModal({ plan, newMoneyIls, usdIls, fxFeePercent, onClose, onRecorded }: Props) {
  const { actions } = useApp();
  const [rows, setRows] = useState(() =>
    plan.orders.map((o) => ({ ticker: o.ticker, planned: o.shares, shares: o.shares as number | null, price: o.priceUsd as number | null })),
  );
  const [rate, setRate] = useState<number | null>(usdIls);
  const [fee, setFee] = useState<number | null>(fxFeePercent);
  const [date, setDate] = useState(todayLocal());
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const rowsValid = rows.every((r) => r.shares !== null && r.shares >= 0 && (r.shares === 0 || (r.price !== null && r.price > 0)));
  const anyBought = rows.some((r) => (r.shares ?? 0) > 0);
  const rateValid = rate !== null && rate > 0;
  const feeValid = fee !== null && fee >= 0;
  const dateValid = /^\d{4}-\d{2}-\d{2}$/.test(date);
  const valid = rowsValid && anyBought && rateValid && feeValid && dateValid;

  const totalUsd = rows.reduce((s, r) => s + (r.shares ?? 0) * (r.price ?? 0), 0);
  const totalIls = rateValid && feeValid ? totalUsd * rate * (1 + fee / 100) : null;

  const record = () => {
    if (!valid) return;
    const [y, m, d] = date.split('-').map(Number);
    try {
      const tx = transactionFromPlan(
        plan,
        {
          orders: rows.map((r) => ({ ticker: r.ticker, shares: r.shares!, priceUsd: r.price ?? 0 })),
          usdIls: rate,
          fxFeePercent: fee,
          date: new Date(y, m - 1, d, 12).toISOString(),
          newMoneyIls,
          note,
        },
        newId(),
      );
      actions.recordTransaction(tx);
      onRecorded();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Modal
      wide
      title="Record the purchase"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="record-form" disabled={!valid}>
            Record purchase
          </button>
        </>
      }
    >
      <form
        id="record-form"
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          record();
        }}
      >
        <p className="muted">
          Check the numbers against what your broker actually executed and correct anything that's different. The shares
          are split between the categories as planned.
        </p>
        {error && (
          <div className="banner error" role="alert">
            {error}
          </div>
        )}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Stock</th>
                <th className="num">Planned</th>
                <th className="num">Shares bought</th>
                <th className="num">Price paid (USD)</th>
                <th className="num">Cost</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.ticker}>
                  <td className="ticker">{r.ticker}</td>
                  <td className="num muted">{fmtShares(r.planned)}</td>
                  <td className="num">
                    <NumberField
                      className="narrow"
                      value={r.shares}
                      aria-label={`Shares of ${r.ticker} bought`}
                      onChange={(v) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, shares: v } : x)))}
                    />
                  </td>
                  <td className="num">
                    <NumberField
                      className="narrow"
                      prefix="$"
                      value={r.price}
                      aria-label={`Price paid for ${r.ticker}`}
                      onChange={(v) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, price: v } : x)))}
                    />
                  </td>
                  <td className="num">{fmtUsd((r.shares ?? 0) * (r.price ?? 0))}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={4}>Total</td>
                <td className="num">
                  {fmtUsd(totalUsd)}
                  {totalIls !== null && <div className="muted small-text">{fmtIls(totalIls)}</div>}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
        {!rowsValid && <p className="error-text">Enter the shares bought (0 if none) and a price above 0 for each stock.</p>}
        {rowsValid && !anyBought && <p className="error-text">At least one stock must have shares bought.</p>}

        <div className="row align-start">
          <label className="field">
            USD/ILS rate you got
            <NumberField value={rate} onChange={setRate} aria-label="USD/ILS rate you got" />
            {!rateValid && <span className="error-text">Enter the rate.</span>}
          </label>
          <label className="field">
            Conversion fee
            <NumberField className="narrow" value={fee} onChange={setFee} suffix="%" aria-label="Conversion fee percent" />
            {!feeValid && <span className="error-text">0 or more.</span>}
          </label>
          <label className="field">
            Date
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
        </div>
        <label className="field">
          Note (optional)
          <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. monthly deposit" />
        </label>
      </form>
    </Modal>
  );
}
