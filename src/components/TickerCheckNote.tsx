import { useRef, useState } from 'react';
import { useApp } from '../state/AppState';
import { checkTicker, ownTickers, type TickerCheck } from '../data/tickerCheck';
import { fmtUsd, isTicker, normalizeTicker } from '../lib/format';

export type CheckState = TickerCheck | 'checking';

/**
 * Checks of tickers the user types (see checkTicker), by ticker. Each ticker is checked once; one that
 * couldn't be checked (offline…) is tried again when asked. `get` reads the latest result right away.
 */
export function useTickerChecks() {
  const { data } = useApp();
  const [checks, setChecks] = useState<Record<string, CheckState>>({});
  const latest = useRef<Record<string, CheckState>>({});
  const pending = useRef(new Map<string, Promise<TickerCheck>>());
  const dataRef = useRef(data);
  dataRef.current = data;

  const set = (t: string, c: CheckState) => {
    latest.current = { ...latest.current, [t]: c };
    setChecks(latest.current);
  };
  /** Check a ticker (once); resolves with the result, or null for something that isn't a ticker. */
  const check = (ticker: string): Promise<TickerCheck> | null => {
    const t = normalizeTicker(ticker);
    if (!isTicker(t)) return null;
    const running = pending.current.get(t);
    if (running) return running;
    const done = latest.current[t];
    if (done && done !== 'checking' && done.status !== 'unchecked') return Promise.resolve(done);
    set(t, 'checking');
    const d = dataRef.current;
    const p = checkTicker(t, d.settings, ownTickers(d)).then((r) => {
      pending.current.delete(t);
      set(t, r);
      return r;
    });
    pending.current.set(t, p);
    return p;
  };
  return {
    checks,
    check,
    /** The latest state of a ticker's check, also before the next render. */
    get: (ticker: string): CheckState | undefined => latest.current[normalizeTicker(ticker)],
  };
}

/**
 * What checking a typed ticker found, under its field: its price, or that no price was found with what
 * may have been meant (each one a button that puts it in the field), or that it couldn't be checked.
 */
export function TickerCheckNote({
  ticker,
  check,
  onUse,
}: {
  ticker: string;
  check: CheckState | undefined;
  onUse: (ticker: string) => void;
}) {
  // An empty line until the check says something, so nothing below moves when it starts (a button
  // pressed to leave the ticker field would otherwise move away under the pointer).
  if (!check)
    return (
      <div className="small-text ticker-note" aria-hidden="true">
        &nbsp;
      </div>
    );
  const t = normalizeTicker(ticker);
  if (check === 'checking') return <div className="muted small-text ticker-note">Checking {t}…</div>;
  if (check.status === 'ok')
    return <div className="good-text small-text ticker-note">{`${t} is ${fmtUsd(check.priceUsd)}`}</div>;
  if (check.status === 'unchecked') {
    return (
      <div className="muted small-text ticker-note" title={check.reason}>
        Couldn't check {t} right now.
      </div>
    );
  }
  return (
    <div className="warn-text small-text ticker-note" role="status">
      {check.reason}{' '}
      {check.suggestions.length > 0 ? (
        <>
          Did you mean{' '}
          {check.suggestions.map((s, i) => (
            <span key={s.ticker}>
              {i > 0 && (i === check.suggestions.length - 1 ? ' or ' : ', ')}
              <button
                type="button"
                className="link-button"
                aria-label={`Use ${s.ticker}${s.name ? ` (${s.name})` : ''}`}
                onClick={() => onUse(s.ticker)}
              >
                {s.ticker}
              </button>
              {s.name && <span className="muted"> ({s.name})</span>}
            </span>
          ))}
          ?
        </>
      ) : (
        'Check how it is written.'
      )}
    </div>
  );
}
