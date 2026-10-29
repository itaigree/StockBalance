import { useEffect, useMemo, useRef, useState } from 'react';
import type { BuyStrategy, Category } from '../types';
import { planPurchase, splitContribution, transactionFromPlan, type PlanOptions } from '../engine';
import { priceMap, useApp } from '../state/AppState';
import { navigateTo } from '../lib/router';
import { fmtAgo, fmtDateTime, fmtIls, fmtRate, fmtUsd, isZeroMoney } from '../lib/format';
import { newId } from '../lib/ids';
import {
  categoriesKey,
  clearDraft,
  loadDraft,
  planStillFits,
  saveDraft,
  usableDraft,
  type InvestInputs,
  type SavedPlan,
} from '../lib/investDraft';
import { describeRule } from '../lib/rules';
import { MarketBar } from '../components/MarketBar';
import { NumberField } from '../components/NumberField';
import { PlanResultView } from '../components/PlanResultView';
import { RecordPurchaseModal } from '../components/RecordPurchaseModal';
import { BuyStrategyChoice } from '../components/BuyStrategyChoice';
import { UndoModal } from '../components/AllPurchases';
import { useBackup } from '../components/Backup';
import './InvestPage.css';

export function InvestPage() {
  const { data, actions } = useApp();
  const { categories, settings } = data;

  // A plan saved earlier (e.g. before placing the orders and reloading) is restored as it was.
  const latestTxId = data.transactions.at(-1)?.id ?? null;
  const [draft] = useState(() => usableDraft(loadDraft(), latestTxId));
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
  /** Stocks unticked in the orders list: skipped this time, their money goes to the other stocks. */
  const [excluded, setExcluded] = useState<string[]>(restored?.excluded ?? []);
  const [strategy, setStrategy] = useState<BuyStrategy>(restored?.strategy ?? settings.buyStrategy);
  /**
   * The restored plan, shown instead of recalculating until the user changes something — only if
   * the categories are still as they were when it was made.
   */
  const catsKey = categoriesKey(categories);
  const [frozen, setFrozen] = useState<SavedPlan | null>(() =>
    draft && planStillFits(draft.saved, categories) ? draft.saved : null,
  );
  /** The plan being recorded, as it was when "I made a purchase" was pressed (prices may change meanwhile). */
  const [recording, setRecording] = useState<SavedPlan | null>(null);
  /** What this page just recorded, for the banner and its Undo. */
  const [recorded, setRecorded] = useState<{ kind: 'purchase' | 'cash'; txId: string } | null>(null);
  const [undoing, setUndoing] = useState(false);
  const recordedTx = recorded ? data.transactions.find((t) => t.id === recorded.txId) : undefined;

  // A purchase recorded or undone elsewhere (e.g. in another tab) while this page is open: start
  // over, so the same money isn't planned — and recorded — twice.
  const seenTxId = useRef(latestTxId);
  useEffect(() => {
    if (seenTxId.current === latestTxId) return;
    seenTxId.current = latestTxId;
    setFrozen(null);
    setTotal(null);
    setOverrides({});
    setRestId(null);
    setExcluded([]);
    setRecording(null);
    clearDraft();
    // The banner's Undo is for the purchase recorded here, while it is still the newest one.
    if (recorded?.txId !== latestTxId) {
      setRecorded(null);
      setUndoing(false);
    }
    // Only a change of the newest purchase matters here.
  }, [latestTxId]);
  /**
   * Number fields whose text can't be read ("total", "amount:<category id>", "minOrder", "maxTickers",
   * "rate", "fee"): nothing is planned until they're fixed, instead of reading them as empty.
   */
  const [unreadable, setUnreadable] = useState<Set<string>>(new Set());
  const trackReadable = (id: string) => (valid: boolean) =>
    setUnreadable((s) => {
      if (valid !== s.has(id)) return s;
      const next = new Set(s);
      if (valid) next.delete(id);
      else next.add(id);
      return next;
    });
  const backup = useBackup();
  const [backedUp, setBackedUp] = useState(false);

  const inputs: InvestInputs = {
    total,
    overrides,
    restId,
    useCash,
    wholeShares,
    minOrder,
    maxTickers,
    feePercent,
    rateOverride,
    excluded,
    strategy,
  };
  // Any change to the inputs or the categories means planning again.
  const inputsKey = JSON.stringify(inputs) + catsKey;
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
  // Started with new money, or with an amount typed (even 0) when there is cash from before to invest.
  const started =
    (total ?? 0) > 0 ||
    Object.values(overrides).some((v) => (v ?? 0) > 0) ||
    ((total !== null || edited) && Object.values(budgets).some((b) => b > 0));
  /** Fields still shown whose text can't be read (a category's amount is hidden while it gets the rest). */
  const unreadableShown = [...unreadable].filter((id) => {
    if (!id.startsWith('amount:')) return true;
    const cid = id.slice('amount:'.length);
    return cid !== rest && categories.some((c) => c.id === cid);
  });
  const unreadableOption = unreadableShown.some((id) => ['minOrder', 'maxTickers', 'rate', 'fee'].includes(id));
  const unreadableAmount = unreadableShown.some((id) => id === 'total' || id.startsWith('amount:'));

  const options: PlanOptions = {
    wholeShares,
    minOrderUsd: minOrder ?? 0,
    maxTickers: maxTickers === null ? null : maxTickers,
    excludeTickers: excluded,
    strategy,
  };
  // Empty means none: no minimum, no limit, no fee.
  const optionsValid =
    !unreadableOption &&
    (minOrder === null || minOrder >= 0) &&
    (maxTickers === null || (Number.isInteger(maxTickers) && maxTickers >= 1)) &&
    (feePercent === null || feePercent >= 0);
  const amountsValid = !unreadableAmount && Object.values(overrides).every((v) => v === null || v >= 0);

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
    started && usdIls !== null && usdIls > 0 && optionsValid && amountsValid && missingPrices.length === 0
      ? planPurchase({ categories, prices, usdIls, fxFeePercent: feePercent ?? 0, budgetsIls: budgets, options })
      : null;
  const shown: SavedPlan | null =
    frozen ??
    (livePlan && usdIls !== null
      ? { savedAt: '', plan: livePlan, newMoneyIls: newMoney, usdIls, fxFeePercent: feePercent ?? 0 }
      : null);
  const plan = shown?.plan ?? null;

  // Keep the latest plan so it survives a reload; forget it once there is nothing to plan. While an
  // amount or option is being corrected, the last good plan stays saved.
  const planKey = livePlan && shown ? JSON.stringify({ ...shown, savedAt: '' }) : '';
  const inputsOk = optionsValid && amountsValid;
  useEffect(() => {
    if (frozen) return;
    if (!started) {
      clearDraft();
      return;
    }
    if (!inputsOk) return;
    if (!shown || shown.plan.errors.length > 0 || shown.plan.orders.length === 0) {
      clearDraft();
      return;
    }
    saveDraft({
      inputs,
      saved: { ...shown, savedAt: new Date().toISOString(), categoriesKey: catsKey, lastTxId: latestTxId },
    });
    // `inputs`, `shown`, the categories and the purchases are fully described by these keys.
  }, [frozen, started, inputsOk, inputsKey, planKey, latestTxId]);

  const afterRecording = (kind: 'purchase' | 'cash', txId: string) => {
    setRecording(null);
    setRecorded({ kind, txId });
    setBackedUp(false);
    setFrozen(null);
    clearDraft();
    setTotal(null);
    setOverrides({});
    setRestId(null);
    setExcluded([]);
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
    afterRecording('cash', tx.id);
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
    (feePercent ?? 0) !== settings.fxFeePercent ||
    strategy !== settings.buyStrategy;

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Invest</h1>
          <p className="muted">Enter the money you have, and see exactly what to buy to keep every category balanced.</p>
        </div>
      </div>

      <MarketBar />

      {recorded && recordedTx && (
        <div className="banner info" role="status">
          {recorded.kind === 'purchase'
            ? "Purchase recorded. Your holdings and cash were updated; it's listed on each category's page."
            : "Saved. The money was added to each category's cash and will be included next time."}{' '}
          <button type="button" className="link-button" onClick={() => setUndoing(true)}>
            Undo
          </button>
          {' · '}
          {backedUp ? (
            'Backed up.'
          ) : (
            <button type="button" className="link-button" onClick={async () => setBackedUp(await backup.backUp())}>
              Back up now
            </button>
          )}
          {backup.error && <div className="error-text">{backup.error}</div>}
        </div>
      )}
      {undoing && recordedTx && (
        <UndoModal
          tx={recordedTx}
          categories={data.categories}
          onClose={() => setUndoing(false)}
          onConfirm={() => {
            actions.undoTransaction(recordedTx.id);
            setUndoing(false);
            setRecorded(null);
          }}
        />
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
            onValidityChange={trackReadable('total')}
          />
          {unreadable.has('total') && <span className="error-text">{UNREADABLE}</span>}
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
                  onValidityChange={trackReadable(`amount:${c.id}`)}
                  unreadable={unreadable.has(`amount:${c.id}`)}
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
            {strategy === 'fewest' ? 'Fewest orders' : 'Balance all stocks'} · {wholeShares ? 'whole shares' : 'fractional shares'} ·{' '}
            {minOrder ? `orders of at least ${fmtUsd(minOrder, true)}` : 'no minimum order'} ·{' '}
            {maxTickers ? `at most ${maxTickers} different stock${maxTickers === 1 ? '' : 's'}` : 'any number of stocks'} · rate{' '}
            {usdIls ? fmtRate(usdIls) : '—'}
            {feePercent ? ` + ${feePercent}% fee` : ''}
          </span>
        </summary>
        <BuyStrategyChoice name="strategy" value={strategy} onChange={setStrategy} />
        <div className="options-grid">
          <label className="checkbox">
            <input type="checkbox" checked={wholeShares} onChange={(e) => setWholeShares(e.target.checked)} />
            My broker only sells whole shares
          </label>
          <label className="field">
            Minimum order
            <NumberField
              value={minOrder}
              onChange={setMinOrder}
              prefix="$"
              placeholder="0"
              onValidityChange={trackReadable('minOrder')}
            />
            <span className="hint">Skip a stock if less than this would be bought this time.</span>
            {minOrder !== null && minOrder < 0 && <span className="error-text">0 or more (or empty).</span>}
            {unreadable.has('minOrder') && <span className="error-text">{UNREADABLE}</span>}
          </label>
          <label className="field">
            Max different stocks per purchase
            <NumberField
              value={maxTickers}
              onChange={setMaxTickers}
              placeholder="no limit"
              className="narrow"
              onValidityChange={trackReadable('maxTickers')}
            />
            <span className="hint">Fewer orders; the stocks that need it most go first.</span>
            {unreadable.has('maxTickers') && <span className="error-text">{UNREADABLE}</span>}
            {maxTickers !== null && !(Number.isInteger(maxTickers) && maxTickers >= 1) && (
              <span className="error-text">A whole number, 1 or more (or empty).</span>
            )}
          </label>
          <label className="field">
            USD/ILS rate for this purchase
            <NumberField
              // While the typed rate can't be read it stays as typed, not replaced by the latest rate.
              value={unreadable.has('rate') ? null : usdIls}
              onChange={(v) => setRateOverride(v)}
              className="narrow"
              onValidityChange={trackReadable('rate')}
            />
            {unreadable.has('rate') && <span className="error-text">{UNREADABLE}</span>}
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
            <NumberField
              value={feePercent}
              onChange={setFeePercent}
              suffix="%"
              placeholder="0"
              className="narrow"
              onValidityChange={trackReadable('fee')}
            />
            <span className="hint">What your broker charges on top of the rate.</span>
            {unreadable.has('fee') && <span className="error-text">{UNREADABLE}</span>}
            {feePercent !== null && feePercent < 0 && <span className="error-text">0 or more (or empty).</span>}
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
                buyStrategy: strategy,
              })
            }
          >
            Save these options as the default
          </button>
        )}
      </details>

      {started && (usdIls === null || !(usdIls > 0)) && <MissingRate />}
      {started && missingPrices.length > 0 && <MissingPrices tickers={missingPrices} />}
      {unreadableShown.length > 0 ? (
        <div className="banner warn" role="alert">
          Some numbers can't be read{unreadableOption ? ' (see the Options)' : ''}. Use digits and a dot for decimals, e.g.
          2.5, to see what to buy.
        </div>
      ) : (
        <>
          {started && !amountsValid && (
            <div className="banner warn" role="alert">
              A category’s amount is below 0. Enter 0 or more to see what to buy.
            </div>
          )}
          {started && amountsValid && !optionsValid && (
            <div className="banner warn" role="alert">
              Check the Options: the minimum order and the fee must be 0 or more, and max different stocks a whole number.
            </div>
          )}
        </>
      )}

      {!started && !unreadableAmount && (
        <>
          <p className="muted center">Enter an amount to see what to buy.</p>
          {hasCash && useCash && (
            <p className="muted center small-text">To invest only the cash left from earlier purchases, enter 0.</p>
          )}
        </>
      )}

      {frozen && (
        <div className="banner info" role="status">
          This is the plan you made {fmtAgo(frozen.savedAt)} ({fmtDateTime(frozen.savedAt)}), with the prices from then. If
          you already bought, press "I made a purchase" below.{' '}
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
          onRecord={() => setRecording(shown)}
          onKeepCash={Object.values(shown.newMoneyIls).some((v) => v > 0) ? keepAsCash : undefined}
          excluded={excluded}
          onToggleExclude={(t) => setExcluded((xs) => (xs.includes(t) ? xs.filter((x) => x !== t) : [...xs, t].sort()))}
        />
      )}

      {recording && (
        <RecordPurchaseModal
          plan={recording.plan}
          newMoneyIls={recording.newMoneyIls}
          usdIls={recording.usdIls}
          fxFeePercent={recording.fxFeePercent}
          onClose={() => setRecording(null)}
          onRecorded={(txId) => afterRecording('purchase', txId)}
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
  onValidityChange,
  unreadable,
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
  onValidityChange: (valid: boolean) => void;
  unreadable: boolean;
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
            <NumberField
              value={amount}
              onChange={onChange}
              prefix="₪"
              aria-label={`New money for ${category.name}`}
              onValidityChange={onValidityChange}
            />
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
        {amount < 0 && <div className="error-text">0 or more.</div>}
        {unreadable && !isRest && <div className="error-text">{UNREADABLE}</div>}
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

const UNREADABLE = 'Not a number: use digits and a dot for decimals (e.g. 2.5).';

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
