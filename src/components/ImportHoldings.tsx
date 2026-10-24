import { useRef, useState } from 'react';
import { applyImport, defaultTarget, parseYahooPortfolioCsv, type ImportedPortfolio, type ImportTarget } from '../data/importCsv';
import { useApp } from '../state/AppState';
import { fmtShares } from '../lib/format';
import { Modal } from './Modal';

/** Button that imports holdings from a Yahoo Finance portfolio CSV, with a preview before anything changes. */
export function ImportHoldings({ className = 'secondary', onDone }: { className?: string; onDone?: (message: string) => void }) {
  const { data, actions } = useApp();
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<{
    portfolios: ImportedPortfolio[];
    warnings: string[];
  } | null>(null);
  const [targets, setTargets] = useState<ImportTarget[]>([]);
  const [error, setError] = useState<string | null>(null);

  const setTarget = (i: number, t: ImportTarget) => setTargets((ts) => ts.map((x, j) => (j === i ? t : x)));
  const nameError = (t: ImportTarget): string | null => {
    if (t.kind !== 'new') return null;
    const name = t.name.trim();
    if (!name) return 'Give the new category a name.';
    if (data.categories.some((c) => c.name.trim().toLowerCase() === name.toLowerCase())) {
      return 'A category with this name exists; choose it from the list instead.';
    }
    return null;
  };
  const valid = targets.every((t) => !nameError(t)) && targets.some((t) => t.kind !== 'skip');

  return (
    <>
      <button type="button" className={className} onClick={() => input.current?.click()}>
        Import from Yahoo Finance (CSV)…
      </button>
      <input
        ref={input}
        type="file"
        accept=".csv,text/csv"
        className="visually-hidden"
        aria-label="Yahoo Finance CSV file to import"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          const result = parseYahooPortfolioCsv(await file.text());
          if (result.ok) {
            setError(null);
            setPreview(result);
            setTargets(result.portfolios.map((p) => defaultTarget(data.categories, p)));
          } else setError(result.error);
        }}
      />
      {error && (
        <div className="banner error" role="alert" style={{ marginTop: '0.75rem' }}>
          {error}
        </div>
      )}

      {preview && (
        <Modal
          wide
          title="Import holdings"
          onClose={() => setPreview(null)}
          footer={
            <>
              <button type="button" className="secondary" onClick={() => setPreview(null)}>
                Cancel
              </button>
              <button
                type="button"
                disabled={!valid}
                onClick={() => {
                  actions.replaceData({
                    ...data,
                    categories: applyImport(data.categories, preview.portfolios, targets),
                  });
                  setPreview(null);
                  onDone?.('Holdings imported. Next, set each category’s target percentages on the Categories page.');
                }}
              >
                Import
              </button>
            </>
          }
        >
          <p className="muted">
            Choose where each portfolio in the file goes. Putting it into an existing category replaces that category's shares and
            keeps its targets and settings. Portfolios put into the same category are added together.
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Portfolio</th>
                  <th>Put into</th>
                </tr>
              </thead>
              <tbody>
                {preview.portfolios.map((p, i) => {
                  const t = targets[i] ?? { kind: 'skip' };
                  const err = nameError(t);
                  return (
                    <tr key={p.name}>
                      <td>
                        <strong>{p.name}</strong>
                        <div className="muted small-text">
                          {Object.entries(p.holdings)
                            .map(([t, n]) => `${fmtShares(n)} ${t}`)
                            .join(', ')}
                        </div>
                      </td>
                      <td>
                        <div className="import-target">
                          <select
                            aria-label={`Put ${p.name} into`}
                            value={t.kind === 'existing' ? t.categoryId : t.kind === 'new' ? '__new' : '__skip'}
                            onChange={(e) => {
                              const v = e.target.value;
                              setTarget(
                                i,
                                v === '__new'
                                  ? {
                                      kind: 'new',
                                      name: data.categories.some((c) => c.name.trim().toLowerCase() === p.name.toLowerCase())
                                        ? ''
                                        : p.name,
                                    }
                                  : v === '__skip'
                                    ? { kind: 'skip' }
                                    : { kind: 'existing', categoryId: v },
                              );
                            }}
                          >
                            {data.categories.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name} (replace its shares)
                              </option>
                            ))}
                            <option value="__new">New category…</option>
                            <option value="__skip">Don't import</option>
                          </select>
                          {t.kind === 'new' && (
                            <input
                              type="text"
                              value={t.name}
                              placeholder="Name of the new category"
                              aria-label={`Name of the new category for ${p.name}`}
                              onChange={(e) =>
                                setTarget(i, {
                                  kind: 'new',
                                  name: e.target.value,
                                })
                              }
                            />
                          )}
                          {err && <span className="error-text">{err}</span>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {preview.warnings.length > 0 && (
            <div className="banner warn">
              <ul>
                {preview.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </div>
          )}
          <p className="muted small-text">Only the current number of shares is imported, not the purchase history.</p>
        </Modal>
      )}
    </>
  );
}
