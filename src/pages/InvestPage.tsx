import { useMemo, useState } from 'react';
import type { Category } from '../types';
import { planPurchase, splitContribution, type PlanOptions } from '../engine';
import { priceMap, useApp } from '../state/AppState';
import { navigateTo } from '../lib/router';
import { fmtIls, fmtRate, fmtUsd, isZeroMoney } from '../lib/format';
import { describeRule } from '../lib/rules';
import { MarketBar } from '../components/MarketBar';
import { NumberField } from '../components/NumberField';
import { PlanResultView } from '../components/PlanResultView';
import { RecordPurchaseModal } from '../components/RecordPurchaseModal';
import './InvestPage.css';

export function InvestPage() {
  const { data, actions } = useApp();
  const { categories, settings } = data;

  const [total, setTotal] = useState<number | null>(null);
  /** Amounts the user typed for this purchase (category id → ILS). */
  const [overrides, setOverrides] = useState<Record<string, number | null>>({});
  const [useCash, setUseCash] = useState(true);
  const [wholeShares, setWholeShares] = useState(settings.wholeShares);
  const [minOrder, setMinOrder] = useState<number | null>(settings.minOrderUsd);
  const [maxTickers, setMaxTickers] = useState<number | null>(settings.maxTickersPerPurchase);
  const [feePercent, setFeePercent] = useState<number | null>(settings.fxFeePercent);
  const [rateOverride, setRateOverride] = useState<number | null>(null);
  const [recording, setRecording] = useState(false);
  const [recorded, setRecorded] = useState(false);

  const usdIls = rateOverride ?? data.fx?.usdIls ?? null;
  const split = useMemo(() => splitContribution(total ?? 0, categories), [total, categories]);
  const newMoney: Record<string, number> = {};
  const budgets: Record<string, number> = {};
  for (const c of categories) {
    newMoney[c.id] = c.id in overrides ? (overrides[c.id] ?? 0) : (split.amounts[c.id] ?? 0);
    budgets[c.id] = newMoney[c.id] + (useCash ? Math.max(0, c.cashIls) : 0);
  }
  const sumNew = Object.values(newMoney).reduce((a, b) => a + b, 0);
  const hasCash = categories.some((c) => !isZeroMoney(c.cashIls));
  const edited = Object.keys(overrides).length > 0;
  const started = (total ?? 0) > 0 || Object.values(overrides).some((v) => (v ?? 0) > 0);

  const options: PlanOptions = {
    wholeShares,
    minOrderUsd: minOrder ?? 0,
    maxTickers: maxTickers === null ? null : maxTickers,
  };
  const optionsValid =
    (minOrder === null || minOrder >= 0) &&
    (maxTickers === null || (Number.isInteger(maxTickers) && maxTickers >= 1)) &&
    feePercent !== null &&
    feePercent >= 0;

  const prices = useMemo(() => priceMap(data.prices), [data.prices]);
  // Planning takes a few milliseconds, so it simply runs on every change.
  const missingPrices = [
    ...new Set(
      categories
        .filter((c) => budgets[c.id] > 0)
        .flatMap((c) => [
          ...c.targets.filter((t) => t.percent > 0).map((t) => t.ticker),
          ...Object.keys(c.holdings).filter((t) => c.holdings[t] > 0),
        ])
        .filter((t) => !(t in prices)),
    ),
  ].sort();
  const plan =
    started && usdIls !== null && usdIls > 0 && optionsValid && missingPrices.length === 0
      ? planPurchase({ categories, prices, usdIls, fxFeePercent: feePercent ?? 0, budgetsIls: budgets, options })
      : null;

  if (categories.length === 0) {
    return (
      <>
        <h1>Invest</h1>
        <section className="card empty">
          <p>Set up your categories first: what each part of your money is for and which stocks it should hold.</p>
          <button type="button" onClick={() => navigateTo('categories')}>
            Set up categories
          </button>
        </section>
      </>
    );
  }

  const settingsDiffer =
    wholeShares !== settings.wholeShares ||
    (minOrder ?? 0) !== settings.minOrderUsd ||
    maxTickers !== settings.maxTickersPerPurchase ||
    (feePercent ?? 0) !== settings.fxFeePercent;

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Invest</h1>
          <p className="muted">Enter the money you have, and see exactly what to buy to keep every category balanced.</p>
        </div>
      </div>

      <MarketBar />

      {recorded && (
        <div className="banner info" role="status">
          Purchase recorded. Your holdings and cash were updated.{' '}
          <button type="button" className="link-button" onClick={() => navigateTo('history')}>
            See it in History
          </button>
        </div>
      )}

      <section className="card" aria-labelledby="amount-title">
        <label className="field amount-field">
          <h2 id="amount-title">How much money do you have to invest now?</h2>
          <NumberField
            className="big"
            value={total}
            onChange={(v) => {
              setTotal(v);
              setRecorded(false);
            }}
            prefix="₪"
            placeholder="10,000"
            aria-label="Amount to invest in ILS"
            autoFocus
          />
        </label>
      </section>

      <section className="card" aria-labelledby="split-title">
        <div className="card-header">
          <h2 id="split-title">Split between categories</h2>
          {edited && (
            <button type="button" className="secondary small" onClick={() => setOverrides({})}>
              Reset to rules
            </button>
          )}
        </div>
        <div className="table-wrap">
          <table className="split-table">
            <thead>
              <tr>
                <th>Category</th>
                <th className="num">New money</th>
                {hasCash && <th className="num hide-sm">Cash from before</th>}
                <th className="num">To invest now</th>
              </tr>
            </thead>
            <tbody>
              {categories.map((c) => (
                <SplitRow
                  key={c.id}
                  category={c}
                  amount={newMoney[c.id]}
                  overridden={c.id in overrides}
                  showCash={hasCash}
                  cashUsed={useCash ? Math.max(0, c.cashIls) : 0}
                  budget={budgets[c.id]}
                  onChange={(v) => setOverrides((o) => ({ ...o, [c.id]: v }))}
                />
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>Total</td>
                <td className="num">{fmtIls(sumNew)}</td>
                {hasCash && (
                  <td className="num hide-sm">{fmtIls(categories.reduce((s, c) => s + (useCash ? Math.max(0, c.cashIls) : 0), 0))}</td>
                )}
                <td className="num">{fmtIls(Object.values(budgets).reduce((a, b) => a + b, 0))}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        {hasCash && (
          <label className="checkbox">
            <input type="checkbox" checked={useCash} onChange={(e) => setUseCash(e.target.checked)} />
            Also invest cash left over from earlier purchases
          </label>
        )}
        {!edited && split.warnings.length > 0 && (
          <div className="banner warn">
            {split.warnings.map((w) => (
              <div key={w}>{w}</div>
            ))}
          </div>
        )}
        {edited && total !== null && Math.abs(sumNew - total) >= 0.01 && (
          <div className="banner warn">
            {sumNew < total
              ? `${fmtIls(total - sumNew)} of the ${fmtIls(total)} isn't assigned to any category.`
              : `The amounts add up to ${fmtIls(sumNew)}, which is more than the ${fmtIls(total)} you entered.`}
          </div>
        )}
      </section>

      <details className="card options">
        <summary>
          <h2>Options</h2>
          <span className="muted small-text">
            {wholeShares ? 'Whole shares' : 'Fractional shares'} ·{' '}
            {minOrder ? `orders of at least ${fmtUsd(minOrder, true)}` : 'no minimum order'} ·{' '}
            {maxTickers ? `at most ${maxTickers} different stock${maxTickers === 1 ? '' : 's'}` : 'any number of stocks'} · rate{' '}
            {usdIls ? fmtRate(usdIls) : '—'}
            {feePercent ? ` + ${feePercent}% fee` : ''}
          </span>
        </summary>
        <div className="options-grid">
          <label className="checkbox">
            <input type="checkbox" checked={wholeShares} onChange={(e) => setWholeShares(e.target.checked)} />
            My broker only sells whole shares
          </label>
          <label className="field">
            Minimum order
            <NumberField value={minOrder} onChange={setMinOrder} prefix="$" placeholder="0" />
            <span className="hint">Skip a stock if less than this would be bought this time.</span>
          </label>
          <label className="field">
            Max different stocks per purchase
            <NumberField value={maxTickers} onChange={setMaxTickers} placeholder="no limit" className="narrow" />
            <span className="hint">Fewer orders; the stocks that need it most go first.</span>
            {maxTickers !== null && !(Number.isInteger(maxTickers) && maxTickers >= 1) && (
              <span className="error-text">A whole number, 1 or more (or empty).</span>
            )}
          </label>
          <label className="field">
            USD/ILS rate for this purchase
            <NumberField value={usdIls} onChange={(v) => setRateOverride(v)} className="narrow" />
            <span className="hint">
              {rateOverride !== null ? (
                <button type="button" className="link-button" onClick={() => setRateOverride(null)}>
                  Use the latest rate
                </button>
              ) : (
                'The latest known rate.'
              )}
            </span>
          </label>
          <label className="field">
            Currency conversion fee
            <NumberField value={feePercent} onChange={setFeePercent} suffix="%" className="narrow" />
            <span className="hint">What your broker charges on top of the rate.</span>
          </label>
        </div>
        {settingsDiffer && optionsValid && (
          <button
            type="button"
            className="link-button"
            onClick={() =>
              actions.updateSettings({
                wholeShares,
                minOrderUsd: minOrder ?? 0,
                maxTickersPerPurchase: maxTickers,
                fxFeePercent: feePercent ?? 0,
              })
            }
          >
            Save these options as the default
          </button>
        )}
      </details>

      {started && (usdIls === null || !(usdIls > 0)) && <MissingRate />}
      {started && missingPrices.length > 0 && <MissingPrices tickers={missingPrices} />}

      {!started && <p className="muted center">Enter an amount to see what to buy.</p>}

      {plan && (
        <PlanResultView
          plan={plan}
          categories={categories}
          wholeShares={wholeShares}
          onRecord={() => setRecording(true)}
        />
      )}

      {recording && plan && usdIls !== null && (
        <RecordPurchaseModal
          plan={plan}
          newMoneyIls={newMoney}
          usdIls={usdIls}
          fxFeePercent={feePercent ?? 0}
          onClose={() => setRecording(false)}
          onRecorded={() => {
            setRecording(false);
            setRecorded(true);
            setTotal(null);
            setOverrides({});
            window.scrollTo?.(0, 0);
          }}
        />
      )}
    </>
  );
}

function SplitRow({
  category,
  amount,
  overridden,
  showCash,
  cashUsed,
  budget,
  onChange,
}: {
  category: Category;
  amount: number;
  overridden: boolean;
  showCash: boolean;
  cashUsed: number;
  budget: number;
  onChange: (v: number | null) => void;
}) {
  return (
    <tr>
      <td>
        <div className="row nowrap">
          <span className="dot" style={{ background: category.color }} />
          <strong>{category.name}</strong>
          {overridden && <span className="badge">edited</span>}
        </div>
        <div className="muted small-text">{describeRule(category.contribution)}</div>
      </td>
      <td className="num">
        <NumberField value={amount} onChange={onChange} prefix="₪" aria-label={`New money for ${category.name}`} />
      </td>
      {showCash && (
        <td className={`num hide-sm${category.cashIls < 0 && !isZeroMoney(category.cashIls) ? ' bad-text' : ''}`}>
          {isZeroMoney(category.cashIls) ? '—' : cashUsed > 0 ? fmtIls(cashUsed) : fmtIls(category.cashIls)}
        </td>
      )}
      <td className="num">
        <strong>{fmtIls(budget)}</strong>
      </td>
    </tr>
  );
}

function MissingRate() {
  const { actions } = useApp();
  const [rate, setRate] = useState<number | null>(null);
  return (
    <section className="banner error" role="alert">
      <strong>The USD/ILS exchange rate is missing.</strong> Refresh prices above, or type it in:{' '}
      <form
        className="inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (rate !== null && rate > 0) actions.setManualFx(rate);
        }}
      >
        <NumberField value={rate} onChange={setRate} className="narrow" aria-label="USD/ILS rate" placeholder="3.70" />
        <button type="submit" className="small" disabled={rate === null || !(rate > 0)}>
          Use this rate
        </button>
      </form>
    </section>
  );
}

function MissingPrices({ tickers }: { tickers: string[] }) {
  return (
    <section className="banner error" role="alert">
      <strong>Some prices are missing.</strong> Refresh prices above, or type them in:
      <div className="missing-prices">
        {tickers.map((t) => (
          <MissingPriceRow key={t} ticker={t} />
        ))}
      </div>
    </section>
  );
}

function MissingPriceRow({ ticker }: { ticker: string }) {
  const { actions } = useApp();
  const [price, setPrice] = useState<number | null>(null);
  return (
    <form
      className="inline-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (price !== null && price > 0) actions.setManualPrice(ticker, price);
      }}
    >
      <span className="ticker">{ticker}</span>
      <NumberField value={price} onChange={setPrice} prefix="$" className="narrow" aria-label={`Price of ${ticker} in USD`} />
      <button type="submit" className="small" disabled={price === null || !(price > 0)}>
        Use this price
      </button>
    </form>
  );
}
