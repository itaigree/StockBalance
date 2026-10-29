import { Fragment, useState } from 'react';
import type { Category, ContributionRule } from '../types';
import { CATEGORY_COLORS, newId } from '../lib/ids';
import { fmtPercent, isTicker, normalizeTicker } from '../lib/format';
import { RULE_EXPLANATION } from '../lib/rules';
import { Modal } from './Modal';
import { NumberField } from './NumberField';
import './CategoryEditor.css';


const round2 = (n: number) => Math.round(n * 100) / 100;

/** A percent with only the decimals it needs (2.5%, 3.33%, 10%). */
function pct(n: number): string {
  const r = round2(n);
  const whole = (x: number) => Math.abs(x - Math.round(x)) < 1e-9;
  return fmtPercent(r, whole(r) ? 0 : whole(r * 10) ? 1 : 2);
}

interface Row {
  key: string;
  ticker: string;
  /** Target percent; not used for stocks in an equally split group (the group's percent is split). */
  percent: number | null;
  shares: number | null;
  /** Key of the group this stock belongs to, if any. */
  group?: string;
}

/** A group of stocks sharing one target, e.g. "Corporates" 5% over AMZN, TSLA… */
interface Group {
  key: string;
  name: string;
  /** The group's target when it is split equally; otherwise it is the sum of its stocks' targets. */
  percent: number | null;
  /** True: the target is split equally between its stocks; false: each stock has its own target. */
  equal: boolean;
}

interface Props {
  /** The category to edit, or null to create a new one. */
  category: Category | null;
  existing: Category[];
  onSave: (category: Category) => void;
  onClose: () => void;
}

function stateFrom(category: Category | null): { rows: Row[]; groups: Group[] } {
  const empty = { key: newId(), ticker: '', percent: null, shares: null };
  if (!category) return { rows: [empty], groups: [] };
  const groups: Group[] = [];
  const rows: Row[] = [];
  for (const t of category.targets) {
    if (rows.some((r) => r.ticker === t.ticker)) continue;
    let groupKey: string | undefined;
    if (t.group) {
      let g = groups.find((x) => x.name === t.group);
      if (!g) {
        g = { key: newId(), name: t.group, percent: 0, equal: true };
        groups.push(g);
      }
      g.percent = Math.round(((g.percent ?? 0) + t.percent) * 1e6) / 1e6;
      groupKey = g.key;
    }
    rows.push({
      key: newId(),
      ticker: t.ticker,
      percent: Math.round(t.percent * 1e6) / 1e6,
      shares: category.holdings[t.ticker] ?? null,
      ...(groupKey ? { group: groupKey } : {}),
    });
  }
  // A group whose stocks have different targets is edited per stock; otherwise as one equal split.
  for (const g of groups) {
    const parts = rows.filter((r) => r.group === g.key).map((r) => r.percent ?? 0);
    g.equal = parts.every((p) => Math.abs(p - parts[0]) < 1e-6);
    if (g.equal) for (const r of rows) if (r.group === g.key) r.percent = null;
  }
  for (const ticker of Object.keys(category.holdings)
    .filter((t) => !rows.some((r) => r.ticker === t))
    .sort()) {
    rows.push({ key: newId(), ticker, percent: null, shares: category.holdings[ticker] });
  }
  return { rows: rows.some((r) => !r.group) ? rows : [empty, ...rows], groups };
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
  const [initial] = useState(() => stateFrom(category));
  const [rows, setRows] = useState<Row[]>(initial.rows);
  const [groups, setGroups] = useState<Group[]>(initial.groups);
  const [submitted, setSubmitted] = useState(false);
  /** Number fields whose text can't be read ("rowKey:percent", "rowKey:shares"). */
  const [unreadable, setUnreadable] = useState<Set<string>>(new Set());
  const trackReadable = (id: string) => (valid: boolean) =>
    setUnreadable((s) => {
      if (valid !== s.has(id)) return s;
      const next = new Set(s);
      if (valid) next.delete(id);
      else next.add(id);
      return next;
    });
  const unreadableRow = (r: Row) => unreadable.has(`${r.key}:percent`) || unreadable.has(`${r.key}:shares`);

  const updateRow = (key: string, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const updateGroup = (key: string, patch: Partial<Group>) =>
    setGroups((gs) => gs.map((g) => (g.key === key ? { ...g, ...patch } : g)));
  const filled = rows.filter((r) => r.ticker.trim() !== '' || r.percent !== null || r.shares !== null || unreadableRow(r));
  const single = rows.filter((r) => !r.group);
  const membersOf = (g: Group) => rows.filter((r) => r.group === g.key);
  const filledMembers = (g: Group) => membersOf(g).filter((r) => r.ticker.trim() !== '');
  /** A group's target: its own percent when split equally, else the sum of its stocks' targets. */
  const groupTarget = (g: Group) => (g.equal ? (g.percent ?? 0) : membersOf(g).reduce((s, r) => s + (r.percent ?? 0), 0));
  const groupOfRow = (r: Row) => groups.find((g) => g.key === r.group);
  /** True when the row has its own target field: a single stock, or a stock in a group with targets per stock. */
  const ownTarget = (r: Row) => !r.group || groupOfRow(r)?.equal === false;
  const targetTotal =
    filled.filter((r) => !r.group).reduce((s, r) => s + (r.percent ?? 0), 0) + groups.reduce((s, g) => s + groupTarget(g), 0);
  const hasTargets = filled.some((r) => !r.group && (r.percent ?? 0) > 0) || groups.some((g) => groupTarget(g) > 0);

  const errors = (() => {
    const e: {
      name?: string;
      rule?: string;
      cash?: string;
      rows: Record<string, string>;
      groups: Record<string, string>;
      total?: string;
    } = {
      rows: {},
      groups: {},
    };
    const trimmed = name.trim();
    if (!trimmed) e.name = 'Give the category a name.';
    else if (existing.some((c) => c.id !== category?.id && c.name.trim().toLowerCase() === trimmed.toLowerCase())) {
      e.name = 'Another category already has this name.';
    }
    if (ruleKind === 'fixed' && !(fixedAmount !== null && fixedAmount >= 0)) e.rule = 'Enter the fixed amount (0 or more).';
    if (ruleKind === 'percent' && !(percent !== null && percent >= 0 && percent <= 100))
      e.rule = 'Enter a percentage between 0 and 100.';
    if (cash === null) e.cash = 'Enter an amount (0 if none).';

    const seen = new Set<string>();
    for (const r of filled) {
      const t = normalizeTicker(r.ticker);
      if (!t) e.rows[r.key] = 'Enter the ticker symbol.';
      else if (!isTicker(t)) e.rows[r.key] = 'Use letters, digits, "." or "-" (e.g. VOO, BRK.B).';
      else if (seen.has(t)) e.rows[r.key] = `${t} is listed twice.`;
      else if (unreadableRow(r)) e.rows[r.key] = 'Enter numbers only (e.g. 2.5), or leave it empty.';
      else if (ownTarget(r) && r.percent !== null && (r.percent < 0 || r.percent > 100))
        e.rows[r.key] = 'Target must be between 0 and 100%.';
      else if (r.group && ownTarget(r) && !((r.percent ?? 0) > 0)) e.rows[r.key] = 'Set this stock’s target (above 0%).';
      else if (r.shares !== null && r.shares < 0) e.rows[r.key] = "Shares can't be negative.";
      seen.add(t);
    }
    const groupNames = new Set<string>();
    for (const g of groups) {
      const n = g.name.trim().toLowerCase();
      if (!n) e.groups[g.key] = 'Give the group a name.';
      else if (groupNames.has(n)) e.groups[g.key] = 'Two groups have this name.';
      else if (g.equal && !(g.percent !== null && g.percent > 0 && g.percent <= 100))
        e.groups[g.key] = 'Set the group’s target (above 0%).';
      else if (filledMembers(g).length === 0) e.groups[g.key] = 'Add at least one stock to the group.';
      groupNames.add(n);
    }
    if (hasTargets && Math.abs(targetTotal - 100) > 0.01)
      e.total = `Targets add up to ${fmtPercent(targetTotal, 2)}; they must add up to 100%.`;
    return e;
  })();

  const valid =
    !errors.name &&
    !errors.rule &&
    !errors.cash &&
    !errors.total &&
    Object.keys(errors.rows).length === 0 &&
    Object.keys(errors.groups).length === 0;

  const scaleTo100 = () => {
    if (targetTotal <= 0) return;
    const items = [
      ...rows.filter((r) => ownTarget(r) && (r.percent ?? 0) > 0).map((r) => ({ key: r.key, percent: r.percent! })),
      ...groups.filter((g) => g.equal && (g.percent ?? 0) > 0).map((g) => ({ key: g.key, percent: g.percent! })),
    ];
    let assigned = 0;
    const scaled = new Map<string, number>();
    items.forEach((it, i) => {
      const v =
        i === items.length - 1
          ? Math.round((100 - assigned) * 100) / 100
          : Math.round(((it.percent * 100) / targetTotal) * 100) / 100;
      assigned += v;
      scaled.set(it.key, v);
    });
    setRows((rs) => rs.map((r) => (scaled.has(r.key) ? { ...r, percent: scaled.get(r.key)! } : r)));
    setGroups((gs) => gs.map((g) => (scaled.has(g.key) ? { ...g, percent: scaled.get(g.key)! } : g)));
  };

  const addGroup = () => {
    const key = newId();
    setGroups((gs) => [...gs, { key, name: '', percent: null, equal: true }]);
    setRows((rs) => [...rs, { key: newId(), ticker: '', percent: null, shares: null, group: key }]);
  };
  const removeGroup = (key: string) => {
    setGroups((gs) => gs.filter((g) => g.key !== key));
    // Its stocks stay in the category (as held stocks without a target).
    setRows((rs) => rs.map((r) => (r.group === key ? { ...r, group: undefined } : r)));
  };
  /**
   * Move a stock into a group, out of it, or to another group. Its part of the targets moves with
   * it (its own target, or its equal part of its group's), so the total stays the same.
   */
  const moveRow = (r: Row, to: string | undefined) => {
    if (r.group === to) return;
    const from = groups.find((g) => g.key === r.group);
    const dest = groups.find((g) => g.key === to);
    const share =
      from?.equal === true
        ? r.ticker.trim() && (from.percent ?? 0) > 0
          ? round2(from.percent! / Math.max(1, filledMembers(from).length))
          : 0
        : (r.percent ?? 0);
    // An equally split group's own target changes; a group with targets per stock just sums them.
    if (share > 0) {
      setGroups((gs) =>
        gs.map((g) =>
          g.key === from?.key && g.equal
            ? { ...g, percent: round2((g.percent ?? 0) - share) }
            : g.key === to && g.equal
              ? { ...g, percent: round2((g.percent ?? 0) + share) }
              : g,
        ),
      );
    }
    updateRow(r.key, { group: to, percent: dest?.equal ? null : share > 0 ? share : null });
  };
  /** Switch a group between an equal split and a target per stock, keeping its total. */
  const setSplit = (g: Group, equal: boolean) => {
    if (g.equal === equal) return;
    if (equal) {
      const total = round2(groupTarget(g));
      setGroups((gs) => gs.map((x) => (x.key === g.key ? { ...x, equal, percent: total > 0 ? total : null } : x)));
      setRows((rs) => rs.map((r) => (r.group === g.key ? { ...r, percent: null } : r)));
      return;
    }
    // Start each stock at its equal part; rounding leftovers go to the last one.
    const members = filledMembers(g);
    const total = g.percent ?? 0;
    const each = members.length > 0 ? round2(total / members.length) : 0;
    const parts = new Map(members.map((r, i) => [r.key, i === members.length - 1 ? round2(total - each * i) : each]));
    setGroups((gs) => gs.map((x) => (x.key === g.key ? { ...x, equal } : x)));
    setRows((rs) => rs.map((r) => (parts.has(r.key) ? { ...r, percent: parts.get(r.key)! > 0 ? parts.get(r.key)! : null } : r)));
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
      targets: [
        ...filled
          .filter((r) => !r.group && (r.percent ?? 0) > 0)
          .map((r) => ({ ticker: normalizeTicker(r.ticker), percent: r.percent! })),
        ...groups.flatMap((g) => {
          const members = filledMembers(g);
          return members.map((r) => ({
            ticker: normalizeTicker(r.ticker),
            percent: g.equal ? g.percent! / members.length : r.percent!,
            group: g.name.trim(),
          }));
        }),
      ],
      holdings: Object.fromEntries(filled.filter((r) => (r.shares ?? 0) > 0).map((r) => [normalizeTicker(r.ticker), r.shares!])),
      ...(trimmedNotes ? { notes: trimmedNotes } : {}),
    });
  };

  const show = (msg?: string) => (submitted && msg ? <span className="error-text">{msg}</span> : null);

  const removeRow = (r: Row) =>
    setRows((rs) => {
      const rest = rs.filter((x) => x.key !== r.key);
      return rest.some((x) => !x.group) ? rest : [{ key: newId(), ticker: '', percent: null, shares: null }, ...rest];
    });

  // A plain function (not a component) so inputs keep focus while typing.
  const stockRow = (r: Row, i: number, inGroup = false) => (
    <tr key={r.key} className={`${inGroup ? 'member-row' : ''}${submitted && errors.rows[r.key] ? ' has-error' : ''}`}>
      <td>
        <input
          type="text"
          className="ticker-input"
          value={r.ticker}
          aria-label={`Ticker, row ${i + 1}`}
          placeholder={inGroup ? 'AMZN' : 'VOO'}
          autoCapitalize="characters"
          spellCheck={false}
          onChange={(e) => updateRow(r.key, { ticker: e.target.value.toUpperCase() })}
        />
        {groups.length > 0 && (
          <select
            className="group-select"
            value={r.group ?? ''}
            aria-label={`Group, row ${i + 1}`}
            onChange={(e) => moveRow(r, e.target.value || undefined)}
          >
            <option value="">No group</option>
            {groups.map((g, gi) => (
              <option key={g.key} value={g.key}>
                {g.name.trim() || `Group ${gi + 1}`}
              </option>
            ))}
          </select>
        )}
        {show(errors.rows[r.key])}
      </td>
      <td className="num">
        {!ownTarget(r) ? (
          <span className="muted small-text">in group</span>
        ) : (
          <NumberField
            className="narrow"
            value={r.percent}
            onChange={(v) => updateRow(r.key, { percent: v })}
            suffix="%"
            aria-label={`Target percent, row ${i + 1}`}
            onValidityChange={trackReadable(`${r.key}:percent`)}
          />
        )}
      </td>
      <td className="num">
        <NumberField
          className="narrow"
          value={r.shares}
          onChange={(v) => updateRow(r.key, { shares: v })}
          aria-label={`Shares owned, row ${i + 1}`}
          onValidityChange={trackReadable(`${r.key}:shares`)}
        />
      </td>
      <td>
        <button type="button" className="icon-button" aria-label={`Remove row ${i + 1}`} onClick={() => removeRow(r)}>
          ×
        </button>
      </td>
    </tr>
  );

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
            For each stock, set the share of this category it should be (target) and how many shares this category owns now. A
            stock with no target is kept but never bought. A group (e.g. "Corporates" 5% with AMZN, TSLA…) shares one target
            between its stocks — equally, or with your own % for each stock. To move a stock into or out of a group, choose it in the menu under the stock;
            its target moves with it.
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
                {single.map((r) => stockRow(r, rows.indexOf(r)))}
                {groups.map((g, gi) => {
                  const members = membersOf(g);
                  const each = (g.percent ?? 0) / Math.max(1, filledMembers(g).length);
                  const total = groupTarget(g);
                  return (
                    <Fragment key={g.key}>
                      <tr className={`group-row${submitted && errors.groups[g.key] ? ' has-error' : ''}`}>
                        <td>
                          <input
                            type="text"
                            className="group-name-input"
                            value={g.name}
                            placeholder="Group name, e.g. Corporates"
                            aria-label={`Group name, group ${gi + 1}`}
                            onChange={(e) => updateGroup(g.key, { name: e.target.value })}
                          />
                          <select
                            className="group-split-select"
                            value={g.equal ? 'equal' : 'own'}
                            aria-label={`How group ${gi + 1} is split`}
                            onChange={(e) => setSplit(g, e.target.value === 'equal')}
                          >
                            <option value="equal">Split equally</option>
                            <option value="own">Own % per stock</option>
                          </select>
                          {show(errors.groups[g.key])}
                        </td>
                        <td className="num">
                          {g.equal ? (
                            <NumberField
                              className="narrow"
                              value={g.percent}
                              onChange={(v) => updateGroup(g.key, { percent: v })}
                              suffix="%"
                              aria-label={`Group target percent, group ${gi + 1}`}
                            />
                          ) : (
                            <span className="group-total" aria-label={`Group target, group ${gi + 1}`}>
                              {pct(total)}
                            </span>
                          )}
                        </td>
                        <td className="muted small-text group-split">
                          {g.equal && filledMembers(g).length > 0 && (g.percent ?? 0) > 0 && `${pct(each)} each`}
                        </td>
                        <td>
                          <button
                            type="button"
                            className="icon-button"
                            aria-label={`Remove group ${gi + 1}`}
                            onClick={() => removeGroup(g.key)}
                          >
                            ×
                          </button>
                        </td>
                      </tr>
                      {members.map((r) => stockRow(r, rows.indexOf(r), true))}
                      <tr className="group-add">
                        <td colSpan={4}>
                          <button
                            type="button"
                            className="link-button"
                            onClick={() =>
                              setRows((rs) => [...rs, { key: newId(), ticker: '', percent: null, shares: null, group: g.key }])
                            }
                          >
                            + Add stock to {g.name.trim() || 'this group'}
                          </button>
                        </td>
                      </tr>
                    </Fragment>
                  );
                })}
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
            <button type="button" className="secondary small" onClick={addGroup}>
              + Add group
            </button>
            <span className="spacer" />
            <span className={hasTargets && Math.abs(targetTotal - 100) > 0.01 ? 'error-text' : 'muted'}>
              Targets add up to {pct(targetTotal)}
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
            <select
              value={ruleKind}
              onChange={(e) => setRuleKind(e.target.value as ContributionRule['kind'])}
              aria-label="How this category gets money"
            >
              <option value="fixed">A fixed amount</option>
              <option value="percent">A percentage of what's left</option>
              <option value="remainder">Whatever is left</option>
              <option value="none">Nothing by default</option>
            </select>
            {ruleKind === 'fixed' && (
              <NumberField value={fixedAmount} onChange={setFixedAmount} prefix="₪" aria-label="Fixed amount in ILS" />
            )}
            {ruleKind === 'percent' && (
              <NumberField className="narrow" value={percent} onChange={setPercent} suffix="%" aria-label="Percentage" />
            )}
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
