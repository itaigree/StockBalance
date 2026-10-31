import { useState } from 'react';
import type { Category } from '../types';
import { mergeCategories, splitCategory } from '../engine';
import { useApp } from '../state/AppState';
import { CATEGORY_COLORS, newId } from '../lib/ids';
import { fmtIls, fmtShares } from '../lib/format';
import { clearDraft } from '../lib/investDraft';
import { Modal } from './Modal';
import { NumberField } from './NumberField';

const holdingsText = (h: Record<string, number>) =>
  Object.entries(h)
    .filter(([, n]) => n > 0)
    .map(([t, n]) => `${fmtShares(n)} ${t}`)
    .join(', ') || 'no shares';

/** Merge another category into this one (or this one into another). */
export function MergeModal({ category, onClose, onDone }: { category: Category; onClose: () => void; onDone: (msg: string) => void }) {
  const { data, actions } = useApp();
  const others = data.categories.filter((c) => c.id !== category.id);
  const [otherId, setOtherId] = useState(others[0]?.id ?? '');
  const [keepId, setKeepId] = useState(category.id);
  const other = others.find((c) => c.id === otherId);
  // The kept category is always one of the two shown (the choice resets when "Merge with" changes).
  const keep = keepId === category.id ? category : keepId === otherId ? other : undefined;
  const [name, setName] = useState(category.name);
  const nameTaken =
    name.trim() !== '' &&
    data.categories.some((c) => c.id !== category.id && c.id !== otherId && c.name.trim().toLowerCase() === name.trim().toLowerCase());

  let preview: Category | null = null;
  let error: string | null = null;
  if (other && keep) {
    try {
      const absorbId = keep.id === category.id ? other.id : category.id;
      preview = mergeCategories(data.categories, [], { keepId: keep.id, absorbId, name }).categories.find((c) => c.id === keep.id)!;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }
  const valid = !!preview && !error && name.trim() !== '' && !nameTaken;

  return (
    <Modal
      title={`Merge ${category.name}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            disabled={!valid}
            onClick={() => {
              const absorbId = keep!.id === category.id ? other!.id : category.id;
              const r = mergeCategories(data.categories, data.transactions, { keepId: keep!.id, absorbId, name });
              actions.replaceData({ ...data, categories: r.categories, transactions: r.transactions });
              clearDraft(); // a saved Invest plan may refer to the removed category
              onDone(`${category.name} and ${other!.name} were merged into ${name.trim()}.`);
            }}
          >
            Merge
          </button>
        </>
      }
    >
      {others.length === 0 ? (
        <p>There is no other category to merge with.</p>
      ) : (
        <div className="stack">
          <label className="field">
            Merge with
            <select
              value={otherId}
              onChange={(e) => {
                setOtherId(e.target.value);
                if (keepId !== category.id) {
                  setKeepId(category.id);
                  setName(category.name);
                }
              }}
            >
              {others.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          {other && (
            <fieldset className="field plain-fieldset">
              <legend>Keep the targets and money rule of</legend>
              {[category, other].map((c) => (
                <label key={c.id} className="checkbox">
                  <input
                    type="radio"
                    name="keep"
                    checked={keepId === c.id}
                    onChange={() => {
                      setKeepId(c.id);
                      setName(c.name);
                    }}
                  />
                  {c.name}
                </label>
              ))}
            </fieldset>
          )}
          <label className="field">
            Name of the merged category
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
            {name.trim() === '' && <span className="error-text">Give it a name.</span>}
            {nameTaken && <span className="error-text">Another category already has this name.</span>}
          </label>
          {preview && (
            <div className="banner info">
              <strong>{name.trim() || '…'}</strong> will own {holdingsText(preview.holdings)}
              {preview.cashIls !== 0 && ` and ${fmtIls(preview.cashIls)} cash`}. Past purchases of both are kept under it.
            </div>
          )}
          {error && <div className="banner error">{error}</div>}
        </div>
      )}
    </Modal>
  );
}

/** Move part of a category's shares and cash into a new category. */
export function SplitModal({
  category: opened,
  onClose,
  onDone,
}: {
  category: Category;
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const { data, actions } = useApp();
  // What the category has now (a purchase may be recorded in another window while this is open).
  const now = data.categories.find((c) => c.id === opened.id);
  const category = now ?? opened;
  const held = now ? Object.entries(now.holdings).filter(([, n]) => n > 0) : [];
  const [name, setName] = useState('');
  const [move, setMove] = useState<Record<string, number | null>>({});
  const [cash, setCash] = useState<number | null>(0);
  const [copyTargets, setCopyTargets] = useState(true);
  const [percent, setPercent] = useState<number | null>(50);
  const [splitError, setSplitError] = useState<string | null>(null);
  /** Fields whose text can't be read as a number (tickers, or "cash"). */
  const [unreadable, setUnreadable] = useState<Set<string>>(new Set());
  const trackReadable = (id: string) => (valid: boolean) =>
    setUnreadable((s) => {
      if (valid !== s.has(id)) return s;
      const next = new Set(s);
      if (valid) next.delete(id);
      else next.add(id);
      return next;
    });

  const trimmed = name.trim();
  const nameError = !trimmed
    ? 'Give the new category a name.'
    : data.categories.some((c) => c.name.trim().toLowerCase() === trimmed.toLowerCase())
      ? 'Another category already has this name.'
      : null;
  const rowError = (t: string, have: number) => {
    if (unreadable.has(t)) return 'Enter a number.';
    const n = move[t];
    if (n === null || n === undefined) return null;
    if (n < 0) return "Can't be negative.";
    if (n > have + 1e-9) return `Only ${fmtShares(have)} to move.`;
    return null;
  };
  const maxCash = Math.max(0, category.cashIls);
  const cashError = unreadable.has('cash')
    ? 'Enter a number.'
    : cash !== null && (cash < 0 || cash > maxCash + 0.005)
      ? `Between ₪0 and ${fmtIls(maxCash)}.`
      : null;
  const valid = !!now && !nameError && !cashError && held.every(([t, have]) => !rowError(t, have));

  const applyPercent = () => {
    if (percent === null || percent < 0 || percent > 100) return;
    // Rounded to millionths of a share, but never more than there is (all of it at 100%).
    const part = (have: number) => (percent === 100 ? have : Math.min(have, Math.round(((have * percent) / 100) * 1e6) / 1e6));
    setMove(Object.fromEntries(held.map(([t, have]) => [t, part(have)])));
    setCash(percent === 100 ? maxCash : Math.min(maxCash, Math.round(maxCash * percent) / 100));
  };

  return (
    <Modal
      wide
      title={`Split ${category.name}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            disabled={!valid}
            onClick={() => {
              const color = CATEGORY_COLORS.find((c) => !data.categories.some((x) => x.color === c)) ?? CATEGORY_COLORS[0];
              try {
                const categories = splitCategory(data.categories, {
                  sourceId: category.id,
                  newCategory: {
                    id: newId(),
                    name: trimmed,
                    color,
                    targets: copyTargets ? category.targets : [],
                    contribution: { kind: 'none' },
                  },
                  // Only stocks it still has (one may have gone in another window since it was typed).
                  moveShares: Object.fromEntries(held.map(([t]) => [t, move[t] ?? 0])),
                  moveCashIls: cash ?? 0,
                });
                actions.replaceData({ ...data, categories });
                clearDraft();
                onDone(`${trimmed} was split off from ${category.name}.`);
              } catch (e) {
                setSplitError(e instanceof Error ? e.message : String(e));
              }
            }}
          >
            Split
          </button>
        </>
      }
    >
      <div className="stack">
        {!now && (
          <div className="banner error" role="alert">
            {opened.name} was deleted or merged somewhere else, so it can't be split.
          </div>
        )}
        {splitError && now && (
          <div className="banner error" role="alert">
            {splitError}
          </div>
        )}
        <label className="field">
          Name of the new category
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Naveh" autoFocus />
          {name !== '' && nameError && <span className="error-text">{nameError}</span>}
        </label>

        <div>
          <div className="row">
            <strong>What moves to the new category</strong>
            <span className="spacer" />
            <span className="inline-form">
              <NumberField className="narrow" value={percent} onChange={setPercent} suffix="%" aria-label="Percent to move" />
              <button type="button" className="secondary small" onClick={applyPercent}>
                Move this % of everything
              </button>
            </span>
          </div>
          {held.length === 0 ? (
            <p className="muted">{category.name} owns no shares.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Stock</th>
                    <th className="num">{category.name} has</th>
                    <th className="num">Move</th>
                    <th className="num">Stays</th>
                  </tr>
                </thead>
                <tbody>
                  {held.map(([t, have]) => {
                    const err = rowError(t, have);
                    const n = move[t] ?? 0;
                    return (
                      <tr key={t}>
                        <td className="ticker">{t}</td>
                        <td className="num">{fmtShares(have)}</td>
                        <td className="num">
                          <NumberField
                            className="narrow"
                            value={move[t] ?? null}
                            placeholder="0"
                            aria-label={`Shares of ${t} to move`}
                            onChange={(v) => setMove((m) => ({ ...m, [t]: v }))}
                            onValidityChange={trackReadable(t)}
                          />
                          {err && <div className="error-text">{err}</div>}
                        </td>
                        <td className="num">{err ? '—' : fmtShares(Math.max(0, have - n))}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <label className="field">
          Cash to move
          <NumberField value={cash} onChange={setCash} prefix="₪" aria-label="Cash to move" onValidityChange={trackReadable('cash')} />
          <span className="hint">
            {category.name} has {fmtIls(category.cashIls)} cash.
          </span>
          {cashError && <span className="error-text">{cashError}</span>}
        </label>

        <label className="checkbox">
          <input type="checkbox" checked={copyTargets} onChange={(e) => setCopyTargets(e.target.checked)} />
          Start with the same target percentages as {category.name}
        </label>
        <p className="muted small-text">
          Past purchases stay in {category.name}'s history. The new category gets no money by default; set its rule on this
          page afterwards.
        </p>
      </div>
    </Modal>
  );
}
