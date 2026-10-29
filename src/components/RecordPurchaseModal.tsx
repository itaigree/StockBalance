import { useState } from 'react';
import type { Id } from '../types';
import { transactionFromPlan, type PlanResult } from '../engine';
import { useApp } from '../state/AppState';
import { newId } from '../lib/ids';
import { fmtIls, fmtOrderShares, fmtRate, fmtUsd, isTicker, normalizeTicker } from '../lib/format';
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

/** A stock bought that wasn't in the plan; it goes entirely to one category. */
interface ExtraRow {
  key: string;
  ticker: string;
  shares: number | null;
  price: number | null;
  categoryId: string;
}


function todayLocal(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Record the purchase: exactly as recommended, or with what was actually bought instead. */
export function RecordPurchaseModal({ plan, newMoneyIls, usdIls, fxFeePercent, onClose, onRecorded }: Props) {
  const { data, actions } = useApp();
  const [mode, setMode] = useState<'exact' | 'different'>('exact');
  const [rows, setRows] = useState(() =>
    plan.orders.map((o) => ({ ticker: o.ticker, planned: o.shares, shares: o.shares as number | null, price: o.priceUsd as number | null })),
  );
  const [extras, setExtras] = useState<ExtraRow[]>([]);
  const [rate, setRate] = useState<number | null>(usdIls);
  const [fee, setFee] = useState<number | null>(fxFeePercent);
  const [date, setDate] = useState(todayLocal());
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const exact = mode === 'exact';
  const knownPrice = (t: string) => data.prices[normalizeTicker(t)]?.priceUsd ?? null;
  const extraPrice = (x: ExtraRow) => x.price ?? knownPrice(x.ticker);
  const extraError = (x: ExtraRow): string | null => {
    const t = normalizeTicker(x.ticker);
    if (!t) return 'Enter the ticker.';
    if (!isTicker(t)) return 'Use letters, digits, "." or "-".';
    if (!(x.shares !== null && x.shares > 0)) return 'Enter the shares bought.';
    const p = extraPrice(x);
    if (!(p !== null && p > 0)) return 'Enter the price paid.';
    if (!data.categories.some((c) => c.id === x.categoryId)) return 'Choose the category.';
    return null;
  };

  const rowsValid = exact || rows.every((r) => r.shares !== null && r.shares >= 0 && (r.shares === 0 || (r.price !== null && r.price > 0)));
  const extrasValid = exact || extras.every((x) => !extraError(x));
  const anyBought = exact ? plan.orders.length > 0 : rows.some((r) => (r.shares ?? 0) > 0) || extras.length > 0;
  const rateValid = exact || (rate !== null && rate > 0);
  const feeValid = exact || (fee !== null && fee >= 0);
  const dateValid = /^\d{4}-\d{2}-\d{2}$/.test(date);
  const valid = rowsValid && extrasValid && anyBought && rateValid && feeValid && dateValid;

  const usedRate = exact ? usdIls : (rate ?? 0);
  const usedFee = exact ? fxFeePercent : (fee ?? 0);
  const totalUsd = exact
    ? plan.orders.reduce((s, o) => s + o.costUsd, 0)
    : rows.reduce((s, r) => s + (r.shares ?? 0) * (r.price ?? 0), 0) +
      extras.reduce((s, x) => s + (x.shares ?? 0) * (extraPrice(x) ?? 0), 0);
  const totalIls = usedRate > 0 && usedFee >= 0 ? totalUsd * usedRate * (1 + usedFee / 100) : null;

  const record = () => {
    if (!valid) return;
    const [y, m, d] = date.split('-').map(Number);
    const orders = exact
      ? plan.orders.map((o) => ({ ticker: o.ticker, shares: o.shares, priceUsd: o.priceUsd }))
      : [
          ...rows.map((r) => ({ ticker: r.ticker, shares: r.shares!, priceUsd: r.price ?? 0 })),
          ...extras.map((x) => ({ ticker: normalizeTicker(x.ticker), shares: x.shares!, priceUsd: extraPrice(x)!, categoryId: x.categoryId })),
        ];
    try {
      const tx = transactionFromPlan(
        plan,
        { orders, usdIls: usedRate, fxFeePercent: usedFee, date: new Date(y, m - 1, d, 12).toISOString(), newMoneyIls, note },
        newId(),
      );
      actions.recordTransaction(tx);
      onRecorded();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const updateExtra = (key: string, patch: Partial<ExtraRow>) => setExtras((xs) => xs.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  const defaultCategory = plan.categories.find((c) => c.budgetIls > 0)?.categoryId ?? data.categories[0]?.id ?? '';

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
        <fieldset className="plain-fieldset record-mode">
          <legend className="visually-hidden">What did you buy?</legend>
          <label className="checkbox">
            <input type="radio" name="record-mode" checked={exact} onChange={() => setMode('exact')} />
            I bought exactly what was recommended
          </label>
          <label className="checkbox">
            <input type="radio" name="record-mode" checked={!exact} onChange={() => setMode('different')} />
            I bought something different
          </label>
        </fieldset>

        {error && (
          <div className="banner error" role="alert">
            {error}
          </div>
        )}

        {exact ? (
          <div className="banner info">
            <ul className="exact-list">
              {plan.orders.map((o) => (
                <li key={o.ticker}>
                  {fmtOrderShares(o.shares)} × <span className="ticker">{o.ticker}</span> @ {fmtUsd(o.priceUsd)}
                </li>
              ))}
            </ul>
            <div>
              Total {fmtUsd(totalUsd)}
              {totalIls !== null && ` · ${fmtIls(totalIls)} at ${fmtRate(usedRate)}`}
              {usedFee > 0 && ` + ${usedFee}% fee`}
            </div>
          </div>
        ) : (
          <>
            <p className="muted">
              Correct the shares and prices to what your broker executed (0 if you didn't buy a stock), and add any stock you
              bought instead. Recommended stocks are split between the categories as planned; an added stock goes to the
              category you choose.
            </p>
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
                      <td className="num muted">{fmtOrderShares(r.planned)}</td>
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
              </table>
            </div>
            {!rowsValid && <p className="error-text">Enter the shares bought (0 if none) and a price above 0 for each stock.</p>}

            {extras.length > 0 && (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Added stock</th>
                      <th>For</th>
                      <th className="num">Shares</th>
                      <th className="num">Price (USD)</th>
                      <th>
                        <span className="visually-hidden">Remove</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {extras.map((x, i) => {
                      const err = extraError(x);
                      const known = knownPrice(x.ticker);
                      return (
                        <tr key={x.key}>
                          <td>
                            <input
                              type="text"
                              className="ticker-input"
                              value={x.ticker}
                              placeholder="AMZN"
                              aria-label={`Added stock ${i + 1}`}
                              autoCapitalize="characters"
                              spellCheck={false}
                              onChange={(e) => updateExtra(x.key, { ticker: e.target.value.toUpperCase() })}
                            />
                            {err && <div className="error-text">{err}</div>}
                          </td>
                          <td>
                            <select
                              value={x.categoryId}
                              aria-label={`Category for added stock ${i + 1}`}
                              onChange={(e) => updateExtra(x.key, { categoryId: e.target.value })}
                            >
                              {data.categories.map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.name}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="num">
                            <NumberField
                              className="narrow"
                              value={x.shares}
                              aria-label={`Shares of added stock ${i + 1}`}
                              onChange={(v) => updateExtra(x.key, { shares: v })}
                            />
                          </td>
                          <td className="num">
                            <NumberField
                              className="narrow"
                              prefix="$"
                              value={x.price}
                              placeholder={known !== null ? String(known) : ''}
                              aria-label={`Price of added stock ${i + 1}`}
                              onChange={(v) => updateExtra(x.key, { price: v })}
                            />
                          </td>
                          <td>
                            <button
                              type="button"
                              className="icon-button"
                              aria-label={`Remove added stock ${i + 1}`}
                              onClick={() => setExtras((xs) => xs.filter((y) => y.key !== x.key))}
                            >
                              ×
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <div>
              <button
                type="button"
                className="secondary small"
                onClick={() =>
                  setExtras((xs) => [...xs, { key: newId(), ticker: '', shares: null, price: null, categoryId: defaultCategory }])
                }
              >
                + Add a stock I bought instead
              </button>
            </div>
            <p className="muted">
              Total {fmtUsd(totalUsd)}
              {totalIls !== null && ` · ${fmtIls(totalIls)}`}
            </p>
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
            </div>
          </>
        )}

        <div className="row align-start">
          <label className="field">
            Date
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className="field grow">
            Note (optional)
            <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. monthly deposit" />
          </label>
        </div>
      </form>
    </Modal>
  );
}
