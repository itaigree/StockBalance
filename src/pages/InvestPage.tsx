import { useEffect, useMemo, useRef, useState } from 'react';
import type { Category } from '../types';
import { planPurchase, splitContribution, transactionFromPlan, type PlanOptions } from '../engine';
import { priceMap, useApp } from '../state/AppState';
import { navigateTo } from '../lib/router';
import { fmtAgo, fmtDateTime, fmtIls, fmtRate, fmtUsd, isZeroMoney } from '../lib/format';
import { newId } from '../lib/ids';
import { clearDraft, loadDraft, saveDraft, type InvestInputs, type SavedPlan } from '../lib/investDraft';
import { describeRule } from '../lib/rules';
import { MarketBar } from '../components/MarketBar';
import { NumberField } from '../components/NumberField';
import { PlanResultView } from '../components/PlanResultView';
import { RecordPurchaseModal } from '../components/RecordPurchaseModal';
import './InvestPage.css';

export function InvestPage() {
  const { data, actions } = useApp();
  const { categories, settings } = data;

  // A plan saved earlier (e.g. before placing the orders and reloading) is restored as it was.
  const [draft] = useState(() => loadDraft());
  const restored = draft?.inputs;
  const [total, setTotal] = useState<number | null>(restored?.total ?? null);
  /** Amounts the user typed for this purchase (category id → ILS). */
  const [overrides, setOverrides] = useState<Record<string, number | null>>(restored?.overrides ?? {});
  /** The category that gets "all the rest": the total minus every other category's amount. */
  const [restId, setRestId] = useState<string | null>(restored?.restId ?? null);
  const [useCash, setUseCash] = useState(restored?.useCash ?? true);
  const [wholeShares, setWholeShares] = useState(restored?.wholeShares ?? settings.wholeShares);
  const [minOrder, setMinOrder] = useState<number | null>(restored ? restored.minOrder : settings.minOrderUsd);
  const [maxTickers, setMaxTickers] = useState<number | null>(restored ? restored.maxTickers : settings.maxTickersPerPurchase);
  const [feePercent, setFeePercent] = useState<number | null>(restored ? restored.feePercent : settings.fxFeePercent);
  const [rateOverride, setRateOverride] = useState<number | null>(restored?.rateOverride ?? null);
  /** The restored plan, shown instead of recalculating until the user changes something. */
  const [frozen, setFrozen] = useState<SavedPlan | null>(draft?.saved ?? null);
  const [recording, setRecording] = useState(false);
  const [recorded, setRecorded] = useState<'purchase' | 'cash' | null>(null);

  const inputs: InvestInputs = { total, overrides, restId, useCash, wholeShares, minOrder, maxTickers, feePercent, rateOverride };
  const inputsKey = JSON.stringify(inputs);
  const lastInputsKey = useRef(inputsKey);
  useEffect(() => {
    if (lastInputsKey.current === inputsKey) return;
    lastInputsKey.current = inputsKey;
    setFrozen(null);
  }, [inputsKey]);

  const usdIls = rateOverride ?? data.fx?.usdIls ?? null;
  const split = useMemo(() => splitContribution(total ?? 0, categories), [total, categories]);
  const newMoney: Record<string, number> = {};
  const budgets: Record<string, number> = {};
  for (const c of categories) {
    newMoney[c.id] = c.id in overrides ? (overrides[c.id] ?? 0) : (split.amounts[c.id] ?? 0);
  }
  const rest = restId !== null && categories.some((c) => c.id === restId) ? restId : null;
  if (rest !== null) {
    const others = categories.reduce((s, c) => (c.id === rest ? s : s + newMoney[c.id]), 0);
    newMoney[rest] = Math.max(0, Math.round(((total ?? 0) - others) * 100) / 100);
  }
  for (const c of categories) {
    // Carried-over cash counts both ways: leftovers add to the budget, an earlier overspend reduces it.
    budgets[c.id] = Math.max(0, newMoney[c.id] + (useCash ? c.cashIls : 0));
  }
  const sumNew = Object.values(newMoney).reduce((a, b) => a + b, 0);
  const hasCash = categories.some((c) => !isZeroMoney(c.cashIls));
  const edited = Object.keys(overrides).length > 0 || rest !== null;
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
  const livePlan =
    started && usdIls !== null && usdIls > 0 && optionsValid && missingPrices.length === 0
      ? planPurchase({ categories, prices, usdIls, fxFeePercent: feePercent ?? 0, budgetsIls: budgets, options })
      : null;
  const shown: SavedPlan | null =
    frozen ??
    (livePlan && usdIls !== null
      ? { savedAt: '', plan: livePlan, newMoneyIls: newMoney, usdIls, fxFeePercent: feePercent ?? 0 }
      : null);
  const plan = shown?.plan ?? null;

  // Keep the latest plan so it survives a reload; forget it once there is nothing to plan.
  const planKey = livePlan ? JSON.stringify([livePlan.orders, livePlan.categories.map((c) => c.buys)]) : '';
  useEffect(() => {
    if (frozen) return;
    if (!shown || shown.plan.errors.length > 0 || shown.plan.orders.length === 0) {
      clearDraft();
      return;
    }
    saveDraft({ inputs, saved: { ...shown, savedAt: new Date().toISOString() } });
    // `inputs` and `shown` are fully described by these keys.
  }, [frozen, inputsKey, planKey]);

  const afterRecording = (kind: 'purchase' | 'cash') => {
    setRecording(false);
    setRecorded(kind);
    setFrozen(null);
    clearDraft();
    setTotal(null);
    setOverrides({});
    setRestId(null);
    window.scrollTo?.(0, 0);
  };

  const keepAsCash = () => {
    if (!shown) return;
    const tx = transactionFromPlan(
      shown.plan,
      { orders: [], usdIls: shown.usdIls, fxFeePercent: shown.fxFeePercent, date: new Date().toISOString(), newMoneyIls: shown.newMoneyIls },
      newId(),
    );
    actions.recordTransaction(tx);
    afterRecording('cash');
  };

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
          {recorded === 'purchase'
            ? 'Purchase recorded. Your holdings and cash were updated.'
            : "Saved. The money was added to each category's cash and will be included next time."}{' '}
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
              setRecorded(null);
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
            <button
              type="button"
              className="secondary small"
              onClick={() => {
                setOverrides({});
                setRestId(null);
              }}
            >
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
                  isRest={c.id === rest}
                  showCash={hasCash}
                  useCash={useCash}
                  budget={budgets[c.id]}
                  onChange={(v) => setOverrides((o) => ({ ...o, [c.id]: v }))}
                  onToggleRest={() => {
                    if (c.id === rest) {
                      // Keep the amount it had, as a normal typed amount.
                      setOverrides((o) => ({ ...o, [c.id]: newMoney[c.id] }));
                      setRestId(null);
                    } else {
                      setOverrides((o) => {
                        const next = { ...o };
                        delete next[c.id];
                        return next;
                      });
                      setRestId(c.id);
                    }
                  }}
                />
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>Total</td>
                <td className="num">{fmtIls(sumNew)}</td>
                {hasCash && <td className="num hide-sm">{useCash ? fmtIls(categories.reduce((s, c) => s + c.cashIls, 0)) : '—'}</td>}
                <td className="num">{fmtIls(Object.values(budgets).reduce((a, b) => a + b, 0))}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        {hasCash && (
          <label className="checkbox">
            <input type="checkbox" checked={useCash} onChange={(e) => setUseCash(e.target.checked)} />
            Include cash left over (or overspent) from earlier purchases
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

      {frozen && (
        <div className="banner info" role="status">
          This is the plan you made {fmtAgo(frozen.savedAt)} ({fmtDateTime(frozen.savedAt)}), with the prices from then. If
          you already placed these orders, record them below.{' '}
          <button type="button" className="link-button" onClick={() => setFrozen(null)}>
            Recalculate with today's prices
          </button>
        </div>
      )}

      {plan && shown && (
        <PlanResultView
          plan={plan}
          categories={categories}
          wholeShares={wholeShares}
          onRecord={() => setRecording(true)}
          onKeepCash={Object.values(shown.newMoneyIls).some((v) => v > 0) ? keepAsCash : undefined}
        />
      )}

      {recording && shown && (
        <RecordPurchaseModal
          plan={shown.plan}
          newMoneyIls={shown.newMoneyIls}
          usdIls={shown.usdIls}
          fxFeePercent={shown.fxFeePercent}
          onClose={() => setRecording(false)}
          onRecorded={() => afterRecording('purchase')}
        />
      )}
    </>
  );
}

function SplitRow({
  category,
  amount,
  overridden,
  isRest,
  showCash,
  useCash,
  budget,
  onChange,
  onToggleRest,
}: {
  category: Category;
  amount: number;
  overridden: boolean;
  isRest: boolean;
  showCash: boolean;
  useCash: boolean;
  budget: number;
  onChange: (v: number | null) => void;
  onToggleRest: () => void;
}) {
  return (
    <tr>
      <td>
        <div className="row nowrap">
          <span className="dot" style={{ background: category.color }} />
          <strong>{category.name}</strong>
          {overridden && !isRest && <span className="badge">edited</span>}
          {isRest && <span className="badge good">all the rest</span>}
        </div>
        <div className="muted small-text hide-sm">{describeRule(category.contribution)}</div>
      </td>
      <td className="num">
        <div className="amount-cell">
          {isRest ? (
            <span className="rest-amount" aria-label={`New money for ${category.name}`}>
              {fmtIls(amount)}
            </span>
          ) : (
            <NumberField value={amount} onChange={onChange} prefix="₪" aria-label={`New money for ${category.name}`} />
          )}
          <button
            type="button"
            className={`small ${isRest ? '' : 'secondary'}`}
            aria-pressed={isRest}
            title={isRest ? 'Stop giving this category the rest' : 'Give this category whatever is left of the total'}
            aria-label={`All the rest to ${category.name}`}
            onClick={onToggleRest}
          >
            The rest
          </button>
        </div>
      </td>
      {showCash && (
        <td className={`num hide-sm${category.cashIls < 0 && !isZeroMoney(category.cashIls) ? ' bad-text' : ''}`}>
          {isZeroMoney(category.cashIls) ? '—' : useCash ? fmtIls(category.cashIls) : <span className="muted">not used</span>}
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
