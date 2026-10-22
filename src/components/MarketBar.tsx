import { useState } from 'react';
import { allTickers, useApp } from '../state/AppState';
import { fmtAgo, fmtRate } from '../lib/format';
import { NumberField } from './NumberField';

const FX_SOURCE_LABEL = { yahoo: 'Yahoo', frankfurter: 'Frankfurter (ECB)', 'open-er-api': 'open.er-api', manual: 'entered manually' };

/**
 * Shows the USD/ILS rate and price freshness, with a refresh button and a way to type the rate
 * manually. Used at the top of the Portfolio and Invest pages.
 */
export function MarketBar() {
  const { data, actions, market } = useApp();
  const [editingFx, setEditingFx] = useState(false);
  const [fxDraft, setFxDraft] = useState<number | null>(data.fx?.usdIls ?? null);

  const tickers = allTickers(data.categories);
  const missing = tickers.filter((t) => !(data.prices[t]?.priceUsd > 0));
  const failures = Object.entries(market.priceFailures).filter(([t]) => tickers.includes(t));
  const oldest = tickers
    .map((t) => data.prices[t]?.asOf)
    .filter((x): x is string => !!x)
    .sort()[0];

  return (
    <section className="market-bar" aria-label="Market data">
      <div className="market-item">
        <span className="muted">USD/ILS</span>{' '}
        {editingFx ? (
          <form
            className="inline-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (fxDraft !== null && fxDraft > 0) {
                actions.setManualFx(fxDraft);
                setEditingFx(false);
              }
            }}
          >
            <NumberField value={fxDraft} onChange={setFxDraft} aria-label="USD/ILS rate" className="narrow" autoFocus />
            <button type="submit" className="small" disabled={fxDraft === null || fxDraft <= 0}>
              Save
            </button>
            <button type="button" className="small secondary" onClick={() => setEditingFx(false)}>
              Cancel
            </button>
          </form>
        ) : (
          <>
            <strong>{data.fx ? fmtRate(data.fx.usdIls) : '—'}</strong>{' '}
            {data.fx && (
              <span className="muted small-text">
                ({FX_SOURCE_LABEL[data.fx.source]}, {fmtAgo(data.fx.asOf)})
              </span>
            )}{' '}
            <button
              type="button"
              className="link-button"
              onClick={() => {
                setFxDraft(data.fx?.usdIls ?? null);
                setEditingFx(true);
              }}
            >
              edit
            </button>
          </>
        )}
      </div>
      <div className="market-item">
        <span className="muted">Prices</span>{' '}
        {tickers.length === 0 ? (
          <span className="muted">no stocks yet</span>
        ) : missing.length > 0 ? (
          <span className="warn-text">{missing.length} missing ({missing.join(', ')})</span>
        ) : (
          <span>{oldest ? `oldest from ${fmtAgo(oldest)}` : 'ok'}</span>
        )}
        {failures.length > 0 && (
          <details className="failures">
            <summary className="warn-text">{failures.length} couldn't be fetched</summary>
            <ul>
              {failures.map(([t, why]) => (
                <li key={t}>
                  <strong>{t}</strong>: {why}
                </li>
              ))}
            </ul>
          </details>
        )}
        {market.fxError && <div className="warn-text small-text">Exchange rate: {market.fxError}</div>}
      </div>
      <button
        type="button"
        className="secondary"
        onClick={() => void actions.refreshMarket()}
        disabled={market.loading}
        title={data.settings.priceProvider === 'manual' ? 'Prices are manual (see Settings); only the exchange rate is fetched' : undefined}
      >
        {market.loading ? 'Refreshing…' : data.settings.priceProvider === 'manual' ? 'Refresh rate' : 'Refresh prices'}
      </button>
    </section>
  );
}
