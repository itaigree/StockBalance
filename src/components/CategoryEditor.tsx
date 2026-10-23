import { useState } from 'react';
import type { Category, ContributionRule } from '../types';
import { CATEGORY_COLORS, newId } from '../lib/ids';
import { fmtPercent, normalizeTicker } from '../lib/format';
import { RULE_EXPLANATION } from '../lib/rules';
import { Modal } from './Modal';
import { NumberField } from './NumberField';
import './CategoryEditor.css';

const TICKER_RE = /^[A-Z0-9][A-Z0-9.\-]{0,14}$/;

interface Row {
  key: string;
  ticker: string;
  percent: number | null;
  shares: number | null;
}

interface Props {
  /** The category to edit, or null to create a new one. */
  category: Category | null;
  existing: Category[];
  onSave: (category: Category) => void;
  onClose: () => void;
}

function rowsFrom(category: Category | null): Row[] {
  if (!category) return [{ key: newId(), ticker: '', percent: null, shares: null }];
  const tickers = [
    ...category.targets.map((t) => t.ticker),
    ...Object.keys(category.holdings).filter((t) => !category.targets.some((x) => x.ticker === t)).sort(),
  ];
  const rows = [...new Set(tickers)].map((ticker) => ({
    key: newId(),
    ticker,
    percent: category.targets.find((t) => t.ticker === ticker)?.percent ?? null,
    shares: category.holdings[ticker] ?? null,
  }));
  return rows.length > 0 ? rows : [{ key: newId(), ticker: '', percent: null, shares: null }];
}

/** Create or edit a category: name, color, contribution rule, cash, and its stocks (target % and shares owned). */
export function CategoryEditor({ category, existing, onSave, onClose }: Props) {
  const [name, setName] = useState(category?.name ?? '');
  const [color, setColor] = useState(
    category?.color ?? CATEGORY_COLORS.find((c) => !existing.some((e) => e.color === c)) ?? CATEGORY_COLORS[0],
  );
  const [ruleKind, setRuleKind] = useState<ContributionRule['kind']>(category?.contribution.kind ?? 'remainder');
  const [fixedAmount, setFixedAmount] = useState<number | null>(
    category?.contribution.kind === 'fixed' ? category.contribution.amountIls : null,
  );
  const [percent, setPercent] = useState<number | null>(
    category?.contribution.kind === 'percent' ? category.contribution.percent : null,
  );
  const [cash, setCash] = useState<number | null>(category?.cashIls ?? 0);
  const [notes, setNotes] = useState(category?.notes ?? '');
  const [rows, setRows] = useState<Row[]>(() => rowsFrom(category));
  const [submitted, setSubmitted] = useState(false);

  const updateRow = (key: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const filled = rows.filter((r) => r.ticker.trim() !== '' || r.percent !== null || r.shares !== null);
  const targetTotal = filled.reduce((s, r) => s + (r.percent ?? 0), 0);
  const hasTargets = filled.some((r) => (r.percent ?? 0) > 0);

  const errors = (() => {
    const e: { name?: string; rule?: string; cash?: string; rows: Record<string, string>; total?: string } = { rows: {} };
    const trimmed = name.trim();
    if (!trimmed) e.name = 'Give the category a name.';
    else if (existing.some((c) => c.id !== category?.id && c.name.trim().toLowerCase() === trimmed.toLowerCase())) {
      e.name = 'Another category already has this name.';
    }
    if (ruleKind === 'fixed' && !(fixedAmount !== null && fixedAmount >= 0)) e.rule = 'Enter the fixed amount (0 or more).';
    if (ruleKind === 'percent' && !(percent !== null && percent >= 0 && percent <= 100)) e.rule = 'Enter a percentage between 0 and 100.';
    if (cash === null) e.cash = 'Enter an amount (0 if none).';

    const seen = new Set<string>();
    for (const r of filled) {
      const t = normalizeTicker(r.ticker);
      if (!t) e.rows[r.key] = 'Enter the ticker symbol.';
      else if (!TICKER_RE.test(t)) e.rows[r.key] = 'Use letters, digits, "." or "-" (e.g. VOO, BRK.B).';
      else if (seen.has(t)) e.rows[r.key] = `${t} is listed twice.`;
      else if (r.percent !== null && (r.percent < 0 || r.percent > 100)) e.rows[r.key] = 'Target must be between 0 and 100%.';
      else if (r.shares !== null && r.shares < 0) e.rows[r.key] = "Shares can't be negative.";
      seen.add(t);
    }
    if (hasTargets && Math.abs(targetTotal - 100) > 0.01) e.total = `Targets add up to ${fmtPercent(targetTotal, 2)}; they must add up to 100%.`;
    return e;
  })();

  const valid = !errors.name && !errors.rule && !errors.cash && !errors.total && Object.keys(errors.rows).length === 0;

  const scaleTo100 = () => {
    if (targetTotal <= 0) return;
    const withTarget = rows.filter((r) => (r.percent ?? 0) > 0);
    let assigned = 0;
    const scaled = new Map<string, number>();
    withTarget.forEach((r, i) => {
      const v = i === withTarget.length - 1 ? Math.round((100 - assigned) * 100) / 100 : Math.round(((r.percent! * 100) / targetTotal) * 100) / 100;
      assigned += v;
      scaled.set(r.key, v);
    });
    setRows((rs) => rs.map((r) => (scaled.has(r.key) ? { ...r, percent: scaled.get(r.key)! } : r)));
  };

  const save = () => {
    setSubmitted(true);
    if (!valid) return;
    const contribution: ContributionRule =
      ruleKind === 'fixed'
        ? { kind: 'fixed', amountIls: fixedAmount! }
        : ruleKind === 'percent'
          ? { kind: 'percent', percent: percent! }
          : { kind: ruleKind };
    const trimmedNotes = notes.trim();
    onSave({
      id: category?.id ?? newId(),
      name: name.trim(),
      color,
      contribution,
      cashIls: cash ?? 0,
      targets: filled.filter((r) => (r.percent ?? 0) > 0).map((r) => ({ ticker: normalizeTicker(r.ticker), percent: r.percent! })),
      holdings: Object.fromEntries(filled.filter((r) => (r.shares ?? 0) > 0).map((r) => [normalizeTicker(r.ticker), r.shares!])),
      ...(trimmedNotes ? { notes: trimmedNotes } : {}),
    });
  };

  const show = (msg?: string) => (submitted && msg ? <span className="error-text">{msg}</span> : null);

  return (
    <Modal
      wide
      title={category ? `Edit ${category.name}` : 'New category'}
      onClose={onClose}
      footer={
        <>
          {submitted && !valid && <span className="error-text spacer">Please fix the highlighted fields.</span>}
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="category-form">
            Save category
          </button>
        </>
      }
    >
      <form
        id="category-form"
        className="category-form stack"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <div className="row align-start">
          <label className="field grow">
            Name
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Pension" autoFocus />
            {show(errors.name)}
          </label>
          <fieldset className="field color-field">
            <legend>Color</legend>
            <div className="swatches">
              {CATEGORY_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`swatch${c === color ? ' selected' : ''}`}
                  style={{ background: c }}
                  aria-label={`Color ${c}`}
                  aria-pressed={c === color}
                  onClick={() => setColor(c)}
                />
              ))}
            </div>
          </fieldset>
        </div>

        <fieldset className="field">
          <legend>Stocks in this category</legend>
          <p className="hint">
            For each stock, set the share of this category it should be (target) and how many shares this category owns
            now. A stock with no target is kept but never bought.
          </p>
          <div className="table-wrap">
            <table className="stock-rows">
              <thead>
                <tr>
                  <th>Ticker</th>
                  <th className="num">Target</th>
                  <th className="num">Shares owned</th>
                  <th>
                    <span className="visually-hidden">Remove</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.key} className={submitted && errors.rows[r.key] ? 'has-error' : undefined}>
                    <td>
                      <input
                        type="text"
                        className="ticker-input"
                        value={r.ticker}
                        aria-label={`Ticker, row ${i + 1}`}
                        placeholder="VOO"
                        autoCapitalize="characters"
                        spellCheck={false}
                        onChange={(e) => updateRow(r.key, { ticker: e.target.value.toUpperCase() })}
                      />
                      {show(errors.rows[r.key])}
                    </td>
                    <td className="num">
                      <NumberField
                        className="narrow"
                        value={r.percent}
                        onChange={(v) => updateRow(r.key, { percent: v })}
                        suffix="%"
                        aria-label={`Target percent, row ${i + 1}`}
                      />
                    </td>
                    <td className="num">
                      <NumberField
                        className="narrow"
                        value={r.shares}
                        onChange={(v) => updateRow(r.key, { shares: v })}
                        aria-label={`Shares owned, row ${i + 1}`}
                      />
                    </td>
                    <td>
                      <button
                        type="button"
                        className="icon-button"
                        aria-label={`Remove row ${i + 1}`}
                        onClick={() => setRows((rs) => (rs.length > 1 ? rs.filter((x) => x.key !== r.key) : [{ ...rs[0], ticker: '', percent: null, shares: null }]))}
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="row">
            <button
              type="button"
              className="secondary small"
              onClick={() => setRows((rs) => [...rs, { key: newId(), ticker: '', percent: null, shares: null }])}
            >
              + Add stock
            </button>
            <span className="spacer" />
            <span className={hasTargets && Math.abs(targetTotal - 100) > 0.01 ? 'error-text' : 'muted'}>
              Targets add up to {fmtPercent(targetTotal, targetTotal % 1 === 0 ? 0 : 2)}
            </span>
            {hasTargets && Math.abs(targetTotal - 100) > 0.01 && (
              <button type="button" className="secondary small" onClick={scaleTo100}>
                Scale to 100%
              </button>
            )}
          </div>
          {!hasTargets && <p className="hint">Without target stocks, money given to this category stays as cash.</p>}
        </fieldset>

        <fieldset className="field">
          <legend>Share of the money you invest</legend>
          <div className="row">
            <select value={ruleKind} onChange={(e) => setRuleKind(e.target.value as ContributionRule['kind'])} aria-label="How this category gets money">
              <option value="fixed">A fixed amount</option>
              <option value="percent">A percentage of what's left</option>
              <option value="remainder">Whatever is left</option>
              <option value="none">Nothing by default</option>
            </select>
            {ruleKind === 'fixed' && <NumberField value={fixedAmount} onChange={setFixedAmount} prefix="₪" aria-label="Fixed amount in ILS" />}
            {ruleKind === 'percent' && <NumberField className="narrow" value={percent} onChange={setPercent} suffix="%" aria-label="Percentage" />}
          </div>
          {show(errors.rule)}
          <p className="hint">{RULE_EXPLANATION}</p>
        </fieldset>

        <div className="row align-start">
          <label className="field">
            Cash not invested yet
            <NumberField value={cash} onChange={setCash} prefix="₪" />
            <span className="hint">Money set aside for this category that isn't in stocks yet.</span>
            {show(errors.cash)}
          </label>
          <label className="field grow">
            Notes (optional)
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </label>
        </div>
      </form>
    </Modal>
  );
}
