import { useEffect, useRef, useState } from 'react';
import type { AppData, PriceProviderSetting } from '../types';
import { useApp, allTickers } from '../state/AppState';
import { downloadBackup, readBackupFile } from '../data/backup';
import { fetchPrices } from '../data/prices';
import { emptyData } from '../data/schema';
import { sampleData } from '../data/sample';
import { ImportHoldings } from '../components/ImportHoldings';
import { Modal } from '../components/Modal';
import { NumberField } from '../components/NumberField';
import './SettingsPage.css';

const PROVIDERS: { id: PriceProviderSetting; label: string; help: string }[] = [
  { id: 'auto', label: 'Automatic', help: 'Tries Yahoo Finance first, then Finnhub if you set a key below.' },
  {
    id: 'yahoo',
    label: 'Yahoo Finance',
    help: 'No key needed and covers every exchange. Works when the app runs on your computer with npm start, or anywhere once you set up a price forwarder (below).',
  },
  { id: 'finnhub', label: 'Finnhub', help: 'Needs a free API key; also works on a hosted copy of the app.' },
  { id: 'manual', label: 'Manual', help: 'You type the prices yourself (the exchange rate is still fetched).' },
];

export function SettingsPage() {
  const { data, actions } = useApp();
  const { settings } = data;
  const [showKey, setShowKey] = useState(false);
  const [proxyTest, setProxyTest] = useState<{ ok: boolean; text: string } | 'testing' | null>(null);
  const [minOrder, setMinOrder] = useState<number | null>(settings.minOrderUsd);
  const [maxTickers, setMaxTickers] = useState<number | null>(settings.maxTickersPerPurchase);
  const [fee, setFee] = useState<number | null>(settings.fxFeePercent);
  const [restore, setRestore] = useState<AppData | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [confirmSample, setConfirmSample] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteText, setDeleteText] = useState('');
  const [done, setDone] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // Follow changes made elsewhere (restoring a backup, "save as default" on the Invest page).
  useEffect(() => setMinOrder(settings.minOrderUsd), [settings.minOrderUsd]);
  useEffect(() => setMaxTickers(settings.maxTickersPerPurchase), [settings.maxTickersPerPurchase]);
  useEffect(() => setFee(settings.fxFeePercent), [settings.fxFeePercent]);

  const maxValid = maxTickers === null || (Number.isInteger(maxTickers) && maxTickers >= 1);

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Settings</h1>
          <p className="muted">Where prices come from, purchase defaults, and your data.</p>
        </div>
      </div>

      {done && (
        <div className="banner info" role="status">
          {done}
        </div>
      )}

      <section className="card" aria-labelledby="prices-title">
        <h2 id="prices-title">Prices</h2>
        <fieldset className="providers">
          <legend className="visually-hidden">Price source</legend>
          {PROVIDERS.map((p) => (
            <label key={p.id} className="provider">
              <input
                type="radio"
                name="provider"
                value={p.id}
                checked={settings.priceProvider === p.id}
                onChange={() => actions.updateSettings({ priceProvider: p.id })}
              />
              <span>
                <strong>{p.label}</strong>
                <span className="muted small-text">{p.help}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <label className="field">
          Finnhub API key
          <span className="row">
            <input
              type={showKey ? 'text' : 'password'}
              value={settings.finnhubApiKey}
              onChange={(e) => actions.updateSettings({ finnhubApiKey: e.target.value.trim() })}
              autoComplete="off"
              spellCheck={false}
              className="key-input"
              aria-label="Finnhub API key"
            />
            <button type="button" className="secondary small" onClick={() => setShowKey((s) => !s)}>
              {showKey ? 'Hide' : 'Show'}
            </button>
          </span>
          <span className="hint">
            Get a free key at{' '}
            <a href="https://finnhub.io/register" target="_blank" rel="noreferrer">
              finnhub.io
            </a>
            . Only ticker symbols are sent to these services, never your holdings.
          </span>
        </label>
        <label className="field forwarder-field">
          Price forwarder address (optional)
          <span className="row">
            <input
              type="text"
              inputMode="url"
              value={settings.yahooProxyUrl}
              placeholder="https://stockbalance-prices.yourname.workers.dev"
              onChange={(e) => {
                actions.updateSettings({ yahooProxyUrl: e.target.value.trim() });
                setProxyTest(null);
              }}
              autoComplete="off"
              spellCheck={false}
              className="key-input"
              aria-label="Price forwarder address"
            />
            <button
              type="button"
              className="secondary small"
              disabled={!settings.yahooProxyUrl || proxyTest === 'testing'}
              onClick={async () => {
                setProxyTest('testing');
                const r = await fetchPrices(['VOO'], { ...settings, priceProvider: 'yahoo' });
                setProxyTest(
                  r.quotes.VOO
                    ? { ok: true, text: `Works: VOO is $${r.quotes.VOO.priceUsd.toFixed(2)}.` }
                    : { ok: false, text: r.failures.VOO ?? "It didn't work." },
                );
              }}
            >
              {proxyTest === 'testing' ? 'Testing…' : 'Test'}
            </button>
          </span>
          {proxyTest && proxyTest !== 'testing' && (
            <span className={proxyTest.ok ? 'good-text small-text' : 'error-text'}>{proxyTest.text}</span>
          )}
          <span className="hint">
            Your own free Cloudflare Worker that fetches Yahoo prices for the hosted app — needed for stocks outside
            the US (like MXWO.L) on your phone. Setup steps are in the{' '}
            <a href="https://github.com/itaigree/StockBalance#prices-for-every-exchange-free-price-forwarder" target="_blank" rel="noreferrer">
              README
            </a>
            .
          </span>
        </label>
      </section>

      <section className="card" aria-labelledby="defaults-title">
        <h2 id="defaults-title">Purchase defaults</h2>
        <p className="muted small-text">Used on the Invest page; you can still change them for a single purchase there.</p>
        <div className="settings-grid">
          <label className="checkbox">
            <input
              type="checkbox"
              checked={settings.wholeShares}
              onChange={(e) => actions.updateSettings({ wholeShares: e.target.checked })}
            />
            My broker only sells whole shares
          </label>
          <label className="field">
            Minimum order
            <NumberField
              value={minOrder}
              prefix="$"
              placeholder="0"
              onChange={(v) => {
                setMinOrder(v);
                if (v === null || v >= 0) actions.updateSettings({ minOrderUsd: v ?? 0 });
              }}
            />
            <span className="hint">Skip a stock if less than this would be bought.</span>
            {minOrder !== null && minOrder < 0 && <span className="error-text">0 or more.</span>}
          </label>
          <label className="field">
            Max different stocks per purchase
            <NumberField
              className="narrow"
              value={maxTickers}
              placeholder="no limit"
              onChange={(v) => {
                setMaxTickers(v);
                if (v === null || (Number.isInteger(v) && v >= 1)) actions.updateSettings({ maxTickersPerPurchase: v });
              }}
            />
            <span className="hint">Leave empty for no limit.</span>
            {!maxValid && <span className="error-text">A whole number, 1 or more.</span>}
          </label>
          <label className="field">
            Currency conversion fee
            <NumberField
              className="narrow"
              value={fee}
              suffix="%"
              onChange={(v) => {
                setFee(v);
                if (v !== null && v >= 0) actions.updateSettings({ fxFeePercent: v });
              }}
            />
            <span className="hint">What your broker charges on top of the exchange rate.</span>
            {(fee === null || fee < 0) && <span className="error-text">0 or more.</span>}
          </label>
        </div>
      </section>

      <section className="card" aria-labelledby="backup-title">
        <h2 id="backup-title">Backup</h2>
        <p>
          Your data is stored only in this browser. Clearing the browser's data, or using another browser or device,
          means starting empty — so download a backup now and then, especially after recording purchases.
        </p>
        <div className="row">
          <button
            type="button"
            onClick={() => {
              downloadBackup(data);
              setDone('Backup downloaded.');
            }}
          >
            Download backup
          </button>
          <button type="button" className="secondary" onClick={() => fileInput.current?.click()}>
            Restore from backup…
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            className="visually-hidden"
            aria-label="Backup file to restore"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              const result = await readBackupFile(file);
              if (result.ok) {
                setRestoreError(null);
                setRestore(result.data);
              } else {
                setRestoreError(result.error);
              }
            }}
          />
        </div>
        {restoreError && (
          <div className="banner error" role="alert">
            This file can't be restored: {restoreError}
          </div>
        )}
      </section>

      <section className="card" aria-labelledby="import-title">
        <h2 id="import-title">Import holdings</h2>
        <p>
          Load your current shares from a Yahoo Finance portfolio export (Portfolio → Export). Each portfolio becomes a
          category; you'll see a preview before anything changes.
        </p>
        <ImportHoldings onDone={setDone} />
      </section>

      <section className="card danger-zone" aria-labelledby="danger-title">
        <h2 id="danger-title">Start over</h2>
        <div className="row">
          <button type="button" className="secondary" onClick={() => setConfirmSample(true)}>
            Load sample data
          </button>
          <button type="button" className="secondary danger-outline" onClick={() => setConfirmDelete(true)}>
            Delete all data
          </button>
        </div>
      </section>

      {restore && (
        <Modal
          title="Restore this backup?"
          onClose={() => setRestore(null)}
          footer={
            <>
              <button type="button" className="secondary" onClick={() => setRestore(null)}>
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  actions.replaceData(restore);
                  setRestore(null);
                  setDone('Backup restored.');
                }}
              >
                Replace my data
              </button>
            </>
          }
        >
          <p>
            The file has {restore.categories.length} categor{restore.categories.length === 1 ? 'y' : 'ies'} and{' '}
            {restore.transactions.length} recorded purchase{restore.transactions.length === 1 ? '' : 's'}.
          </p>
          <p>It will replace everything currently in the app.</p>
        </Modal>
      )}

      {confirmSample && (
        <Modal
          title="Load sample data?"
          onClose={() => setConfirmSample(false)}
          footer={
            <>
              <button type="button" className="secondary" onClick={() => setConfirmSample(false)}>
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  const sample = sampleData();
                  actions.replaceData(sample);
                  void actions.refreshMarket(allTickers(sample.categories));
                  setConfirmSample(false);
                  setDone('Sample data loaded.');
                }}
              >
                Replace with sample data
              </button>
            </>
          }
        >
          <p>This replaces everything currently in the app with example categories, so you can try it out.</p>
        </Modal>
      )}

      {confirmDelete && (
        <Modal
          title="Delete all data?"
          onClose={() => setConfirmDelete(false)}
          footer={
            <>
              <button type="button" className="secondary" onClick={() => setConfirmDelete(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="danger"
                disabled={deleteText !== 'DELETE'}
                onClick={() => {
                  actions.replaceData(emptyData());
                  setConfirmDelete(false);
                  setDeleteText('');
                  setDone('All data deleted.');
                }}
              >
                Delete everything
              </button>
            </>
          }
        >
          <p>All categories, holdings, prices, settings and history will be deleted from this browser.</p>
          <label className="field">
            Type DELETE to confirm
            <input type="text" value={deleteText} onChange={(e) => setDeleteText(e.target.value)} autoFocus />
          </label>
        </Modal>
      )}
    </>
  );
}
