import { useRef, useState } from 'react';
import { applyImport, parseYahooPortfolioCsv, type ImportedPortfolio } from '../data/importCsv';
import { useApp } from '../state/AppState';
import { fmtShares } from '../lib/format';
import { Modal } from './Modal';

/** Button that imports holdings from a Yahoo Finance portfolio CSV, with a preview before anything changes. */
export function ImportHoldings({ className = 'secondary', onDone }: { className?: string; onDone?: (message: string) => void }) {
  const { data, actions } = useApp();
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<{ portfolios: ImportedPortfolio[]; warnings: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const exists = (name: string) => data.categories.some((c) => c.name.trim().toLowerCase() === name.toLowerCase());

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
                onClick={() => {
                  actions.replaceData({ ...data, categories: applyImport(data.categories, preview.portfolios) });
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
            Each portfolio in the file becomes a category. A category with the same name keeps its targets and
            settings, and only its shares are replaced. You can rename categories afterwards.
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Portfolio</th>
                  <th>What happens</th>
                  <th>Shares</th>
                </tr>
              </thead>
              <tbody>
                {preview.portfolios.map((p) => (
                  <tr key={p.name}>
                    <td>
                      <strong>{p.name}</strong>
                    </td>
                    <td>{exists(p.name) ? <span className="badge warn">replaces shares</span> : <span className="badge good">new category</span>}</td>
                    <td>
                      {Object.entries(p.holdings)
                        .map(([t, n]) => `${fmtShares(n)} ${t}`)
                        .join(', ')}
                    </td>
                  </tr>
                ))}
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
