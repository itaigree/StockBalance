import { useState } from 'react';
import type { Category, ContributionRule } from '../types';
import { apportion } from '../engine/apportion';
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
  /**
   * A single stock: its target, % of the category. A stock in a group with its own split: its share
   * of the group, % of the group (the group's stocks add up to 100%). Unused in an equal split.
   */
  percent: number | null;
  shares: number | null;
  /** Key of the group this stock belongs to, if any. */
  group?: string;
}

/** A group of stocks sharing one target, e.g. "Corporates" 5% of the category over AMZN, TSLA… */
interface Group {
  key: string;
  name: string;
  /** The group's target, % of the category. */
  percent: number | null;
  /** True: split equally between its stocks; false: each stock has its own share of the group. */
  equal: boolean;
}

interface Props {
  /** The category to edit, or null to create a new one. */
  category: Category | null;
  existing: Category[];
  onSave: (category: Category) => void;
  onClose: () => void;
}

const emptyRow = (group?: string): Row => ({
  key: newId(),
  ticker: '',
  percent: null,
  shares: null,
  ...(group ? { group } : {}),
});

/** `total` split in proportion to `parts`, rounded to 0.01 and adding up exactly (never below 0). */
function roundParts(parts: number[], total: number): number[] {
  return apportion(total, parts, 2);
}

function stateFrom(category: Category | null): { rows: Row[]; groups: Group[] } {
  if (!category) return { rows: [emptyRow()], groups: [] };
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
      g.percent = (g.percent ?? 0) + t.percent;
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
  // A group whose stocks have different targets keeps each one's share of the group (adding up to
  // 100%); otherwise it is one equal split.
  for (const g of groups) {
    // Rounded once, so three stocks of 3.333…% give back the 10% typed (not 9.999999%).
    g.percent = Math.round(g.percent! * 1e6) / 1e6;
    const members = rows.filter((r) => r.group === g.key);
    const parts = members.map((r) => r.percent ?? 0);
    g.equal = parts.every((p) => Math.abs(p - parts[0]) < 1e-6);
    const shares = g.equal || !g.percent ? [] : roundParts(parts, 100);
    members.forEach((r, i) => (r.percent = g.equal ? null : shares[i]));
  }
  for (const ticker of Object.keys(category.holdings)
    .filter((t) => !rows.some((r) => r.ticker === t))
    .sort()) {
    rows.push({ key: newId(), ticker, percent: null, shares: category.holdings[ticker] });
  }
  return { rows: rows.some((r) => !r.group) ? rows : [emptyRow(), ...rows], groups };
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
  /** The group being edited in the group box, if any. */
  const [openGroup, setOpenGroup] = useState<string | null>(null);
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
  const groupOfRow = (r: Row) => groups.find((g) => g.key === r.group);
  /** True when the row has its own % field: a single stock, or a stock in a group with its own split. */
  const ownPercent = (r: Row) => !r.group || groupOfRow(r)?.equal === false;
  // Only fields still shown count (a stock in an equally split group has no % field).
  const unreadableRow = (r: Row) =>
    (ownPercent(r) && unreadable.has(`${r.key}:percent`)) || unreadable.has(`${r.key}:shares`);

  const updateRow = (key: string, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const updateGroup = (key: string, patch: Partial<Group>) =>
    setGroups((gs) => gs.map((g) => (g.key === key ? { ...g, ...patch } : g)));
  const filled = rows.filter(
    (r) => r.ticker.trim() !== '' || r.percent !== null || r.shares !== null || unreadableRow(r),
  );
  const single = rows.filter((r) => !r.group);
  const membersOf = (g: Group) => rows.filter((r) => r.group === g.key);
  const filledMembers = (g: Group) => membersOf(g).filter((r) => r.ticker.trim() !== '');
  /** A stock's share of its group, % of the group. */
  const shareOf = (g: Group, r: Row) => (g.equal ? 100 / Math.max(1, filledMembers(g).length) : (r.percent ?? 0));
  const sharesTotal = (g: Group) => filledMembers(g).reduce((s, r) => s + (r.percent ?? 0), 0);
  const targetTotal =
    filled.filter((r) => !r.group).reduce((s, r) => s + (r.percent ?? 0), 0) +
    groups.reduce((s, g) => s + (g.percent ?? 0), 0);
  const hasTargets = filled.some((r) => !r.group && (r.percent ?? 0) > 0) || groups.some((g) => (g.percent ?? 0) > 0);

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
    if (ruleKind === 'fixed' && !(fixedAmount !== null && fixedAmount >= 0))
      e.rule = 'Enter the fixed amount (0 or more).';
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
      else if (ownPercent(r) && r.percent !== null && (r.percent < 0 || r.percent > 100))
        e.rows[r.key] = r.group ? 'A share of the group is between 0 and 100%.' : 'Target must be between 0 and 100%.';
      else if (r.group && ownPercent(r) && !((r.percent ?? 0) > 0))
        e.rows[r.key] = 'Set this stock’s share of the group (above 0%).';
      else if (r.shares !== null && r.shares < 0) e.rows[r.key] = "Shares can't be negative.";
      seen.add(t);
    }
    const groupNames = new Set<string>();
    for (const g of groups) {
      const n = g.name.trim().toLowerCase();
      if (!n) e.groups[g.key] = 'Give the group a name.';
      else if (groupNames.has(n)) e.groups[g.key] = 'Two groups have this name.';
      else if (!(g.percent !== null && g.percent > 0 && g.percent <= 100))
        e.groups[g.key] = 'Set the group’s target (above 0%).';
      else if (filledMembers(g).length === 0) e.groups[g.key] = 'Add at least one stock to the group.';
      else if (!g.equal && Math.abs(sharesTotal(g) - 100) > 0.01)
        e.groups[g.key] = `The stocks’ shares add up to ${pct(sharesTotal(g))}; they must add up to 100% of the group.`;
      else if (membersOf(g).some((r) => e.rows[r.key])) e.groups[g.key] = 'Fix the stocks in this group.';
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

  /** Scale the category's targets (single stocks and groups) so they add up to 100%. */
  const scaleTo100 = () => {
    if (targetTotal <= 0) return;
    const items = [
      ...rows.filter((r) => !r.group && (r.percent ?? 0) > 0).map((r) => ({ key: r.key, percent: r.percent! })),
      ...groups.filter((g) => (g.percent ?? 0) > 0).map((g) => ({ key: g.key, percent: g.percent! })),
    ];
    const parts = roundParts(
      items.map((x) => x.percent),
      100,
    );
    const scaled = new Map(items.map((it, i) => [it.key, parts[i]]));
    setRows((rs) => rs.map((r) => (scaled.has(r.key) ? { ...r, percent: scaled.get(r.key)! } : r)));
    setGroups((gs) => gs.map((g) => (scaled.has(g.key) ? { ...g, percent: scaled.get(g.key)! } : g)));
  };
  /** Scale a group's own split so its stocks' shares add up to 100%. */
  const scaleShares = (g: Group) => {
    const members = filledMembers(g).filter((r) => (r.percent ?? 0) > 0);
    const total = sharesTotal(g);
    if (total <= 0) return;
    const parts = roundParts(
      members.map((r) => r.percent!),
      100,
    );
    const byKey = new Map(members.map((r, i) => [r.key, parts[i]]));
    setRows((rs) => rs.map((r) => (byKey.has(r.key) ? { ...r, percent: byKey.get(r.key)! } : r)));
  };

  const addGroup = () => {
    const key = newId();
    setGroups((gs) => [...gs, { key, name: '', percent: null, equal: true }]);
    setRows((rs) => [...rs, emptyRow(key)]);
    setOpenGroup(key);
  };
  const removeGroup = (key: string) => {
    setGroups((gs) => gs.filter((g) => g.key !== key));
    // Its stocks stay in the category (as held stocks without a target).
    setRows((rs) => rs.map((r) => (r.group === key ? { ...r, group: undefined, percent: null } : r)));
    setOpenGroup(null);
  };
  /**
   * Move one of the category's other stocks into a group. Its target comes along (the group's target
   * grows by it), so every stock keeps its part of the category and the total stays the same.
   */
  const moveIn = (g: Group, r: Row) => {
    const t = r.percent ?? 0;
    const before = g.percent ?? 0;
    const after = round2(before + t);
    if (!g.equal) {
      const members = filledMembers(g);
      // Each stock's part of the category, as shares of the larger group.
      const parts = after > 0 ? roundParts([...members.map((m) => (before * (m.percent ?? 0)) / 100), t], 100) : [];
      const byKey = new Map(members.map((m, i) => [m.key, parts[i]]));
      setRows((rs) =>
        rs.map((x) =>
          byKey.has(x.key)
            ? { ...x, percent: byKey.get(x.key)! }
            : x.key === r.key
              ? { ...x, group: g.key, percent: after > 0 ? parts.at(-1)! : null }
              : x,
        ),
      );
    } else updateRow(r.key, { group: g.key, percent: null });
    if (t > 0) updateGroup(g.key, { percent: after });
  };
  /**
   * Take a stock out of its group: it becomes a single stock with its part of the group's target, the
   * group's target shrinks by that much, and the others' shares grow to fill the group again.
   */
  const takeOut = (g: Group, r: Row) => {
    const others = membersOf(g).filter((m) => m.key !== r.key);
    if (r.ticker.trim() === '') {
      setRows((rs) => rs.filter((x) => x.key !== r.key));
    } else {
      const part = ((g.percent ?? 0) * shareOf(g, r)) / 100;
      const left = 100 - (g.equal ? 0 : (r.percent ?? 0));
      const othersFilled = others.filter((m) => m.ticker.trim() !== '');
      const parts =
        !g.equal && left > 0
          ? roundParts(
              othersFilled.map((m) => m.percent ?? 0),
              100,
            )
          : [];
      const byKey = new Map(othersFilled.map((m, i) => [m.key, parts[i]]));
      setRows((rs) =>
        rs.map((x) =>
          x.key === r.key
            ? { ...x, group: undefined, percent: part > 0 ? round2(part) : null }
            : byKey.has(x.key)
              ? { ...x, percent: byKey.get(x.key)! }
              : x,
        ),
      );
      if (part > 0) updateGroup(g.key, { percent: round2((g.percent ?? 0) - part) });
    }
    // A group left without stocks goes away.
    if (others.length === 0) {
      setGroups((gs) => gs.filter((x) => x.key !== g.key));
      setOpenGroup(null);
    }
  };
  /** Switch a group between an equal split and its own split (starting from the equal shares). */
  const setSplit = (g: Group, equal: boolean) => {
    if (g.equal === equal) return;
    updateGroup(g.key, { equal });
    const members = filledMembers(g);
    const parts = equal
      ? []
      : roundParts(
          members.map(() => 100 / members.length),
          100,
        );
    const byKey = new Map(members.map((r, i) => [r.key, parts[i]]));
    setRows((rs) =>
      rs.map((r) => (r.group !== g.key ? r : { ...r, percent: equal ? null : (byKey.get(r.key) ?? null) })),
    );
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
        // Each stock of a group gets its share of the group's target.
        ...groups.flatMap((g) =>
          filledMembers(g).map((r) => ({
            ticker: normalizeTicker(r.ticker),
            percent: (g.percent! * shareOf(g, r)) / 100,
            group: g.name.trim(),
          })),
        ),
      ],
      holdings: Object.fromEntries(
        filled.filter((r) => (r.shares ?? 0) > 0).map((r) => [normalizeTicker(r.ticker), r.shares!]),
      ),
      ...(trimmedNotes ? { notes: trimmedNotes } : {}),
    });
  };

  const show = (msg?: string) => (submitted && msg ? <span className="error-text">{msg}</span> : null);

  const removeRow = (r: Row) =>
    setRows((rs) => {
      const rest = rs.filter((x) => x.key !== r.key);
      return rest.some((x) => !x.group) ? rest : [emptyRow(), ...rest];
    });

  // Plain functions (not components) so inputs keep focus while typing.
  const tickerInput = (r: Row, i: number, placeholder: string) => (
    <>
      <input
        type="text"
        className="ticker-input"
        value={r.ticker}
        aria-label={`Ticker, row ${i + 1}`}
        placeholder={placeholder}
        autoCapitalize="characters"
        spellCheck={false}
        onChange={(e) => updateRow(r.key, { ticker: e.target.value.toUpperCase() })}
      />
      {show(errors.rows[r.key])}
    </>
  );
  const sharesInput = (r: Row, i: number) => (
    <NumberField
      className="narrow"
      value={r.shares}
      onChange={(v) => updateRow(r.key, { shares: v })}
      aria-label={`Shares owned, row ${i + 1}`}
      onValidityChange={trackReadable(`${r.key}:shares`)}
    />
  );
  const stockRow = (r: Row, i: number) => (
    <tr key={r.key} className={submitted && errors.rows[r.key] ? 'has-error' : undefined}>
      <td>{tickerInput(r, i, 'VOO')}</td>
      <td className="num">
        <NumberField
          className="narrow"
          value={r.percent}
          onChange={(v) => updateRow(r.key, { percent: v })}
          suffix="%"
          aria-label={`Target percent, row ${i + 1}`}
          onValidityChange={trackReadable(`${r.key}:percent`)}
        />
      </td>
      <td className="num">{sharesInput(r, i)}</td>
      <td>
        <button type="button" className="icon-button" aria-label={`Remove row ${i + 1}`} onClick={() => removeRow(r)}>
          ×
        </button>
      </td>
    </tr>
  );
  /** A group in the list of stocks: its name, target and stocks; its stocks are edited in the group box. */
  const groupRow = (g: Group, gi: number) => {
    const members = filledMembers(g);
    const label = g.name.trim() || `Group ${gi + 1}`;
    return (
      <tr key={g.key} className={`group-row${submitted && errors.groups[g.key] ? ' has-error' : ''}`}>
        <td>
          <button type="button" className="link-button group-open" onClick={() => setOpenGroup(g.key)}>
            {label}
          </button>
          <div className="muted small-text group-members">
            {members.length === 0
              ? 'No stocks yet'
              : members.map((r) => (g.equal ? r.ticker : `${r.ticker} ${pct(r.percent ?? 0)}`)).join(' · ')}
          </div>
          {show(errors.groups[g.key])}
        </td>
        <td className="num">
          <NumberField
            className="narrow"
            value={g.percent}
            onChange={(v) => updateGroup(g.key, { percent: v })}
            suffix="%"
            aria-label={`Group target percent, group ${gi + 1}`}
          />
        </td>
        <td>
          <button
            type="button"
            className="secondary small"
            aria-label={`Edit group ${label}`}
            onClick={() => setOpenGroup(g.key)}
          >
            Edit group
          </button>
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
    );
  };
  /** The group box: the group's name and target, how it is split, and its stocks. */
  const groupBox = (g: Group) => {
    const gi = groups.indexOf(g);
    const members = membersOf(g);
    const total = sharesTotal(g);
    const off = !g.equal && Math.abs(total - 100) > 0.01;
    const movable = single.filter((r) => r.ticker.trim() !== '');
    return (
      <div className="group-box" role="group" aria-label={`Group ${g.name.trim() || gi + 1}`}>
        <button type="button" className="link-button back-to-stocks" onClick={() => setOpenGroup(null)}>
          ‹ All stocks
        </button>
        <div className="row align-start">
          <label className="field grow">
            Group name
            <input
              type="text"
              value={g.name}
              placeholder="e.g. Corporates"
              aria-label={`Group name, group ${gi + 1}`}
              autoFocus={g.name === ''}
              onChange={(e) => updateGroup(g.key, { name: e.target.value })}
            />
          </label>
          <label className="field">
            Target in the category
            <NumberField
              className="narrow"
              value={g.percent}
              onChange={(v) => updateGroup(g.key, { percent: v })}
              suffix="%"
              aria-label={`Group target percent, group ${gi + 1}`}
            />
          </label>
        </div>
        {show(errors.groups[g.key])}
        <fieldset className="choices group-split-choice">
          <legend>Split between its stocks</legend>
          <label className="choice">
            <input type="radio" name={`split-${g.key}`} checked={g.equal} onChange={() => setSplit(g, true)} />
            <span>Equally</span>
          </label>
          <label className="choice">
            <input type="radio" name={`split-${g.key}`} checked={!g.equal} onChange={() => setSplit(g, false)} />
            <span>My own split (each stock's share of the group, adding up to 100%)</span>
          </label>
        </fieldset>
        <div className="table-wrap">
          <table className="stock-rows">
            <thead>
              <tr>
                <th>Ticker</th>
                <th className="num">Share of group</th>
                <th className="num">Shares owned</th>
              </tr>
            </thead>
            <tbody>
              {members.map((r) => {
                const i = rows.indexOf(r);
                const share = shareOf(g, r);
                return (
                  <tr key={r.key} className={submitted && errors.rows[r.key] ? 'has-error' : undefined}>
                    <td>
                      {tickerInput(r, i, 'AMZN')}
                      <button
                        type="button"
                        className="link-button take-out"
                        aria-label={`Take ${r.ticker.trim() || `row ${i + 1}`} out of the group`}
                        onClick={() => takeOut(g, r)}
                      >
                        Take out
                      </button>
                    </td>
                    <td className="num">
                      {g.equal ? (
                        <span className="muted">{r.ticker.trim() ? pct(share) : '—'}</span>
                      ) : (
                        <NumberField
                          className="narrow"
                          value={r.percent}
                          onChange={(v) => updateRow(r.key, { percent: v })}
                          suffix="%"
                          aria-label={`Share of the group, row ${i + 1}`}
                          onValidityChange={trackReadable(`${r.key}:percent`)}
                        />
                      )}
                      {r.ticker.trim() !== '' && (g.percent ?? 0) > 0 && (
                        <div className="muted small-text">
                          = {pct(((g.percent ?? 0) * share) / 100)} of the category
                        </div>
                      )}
                    </td>
                    <td className="num">{sharesInput(r, i)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="row">
          <button type="button" className="secondary small" onClick={() => setRows((rs) => [...rs, emptyRow(g.key)])}>
            + Add stock
          </button>
          {movable.length > 0 && (
            <select
              className="small-select"
              value=""
              aria-label="Move one of the category's stocks into the group"
              onChange={(e) => {
                const r = movable.find((x) => x.key === e.target.value);
                if (r) moveIn(g, r);
              }}
            >
              <option value="">Move a stock in…</option>
              {movable.map((r) => (
                <option key={r.key} value={r.key}>
                  {normalizeTicker(r.ticker)}
                  {(r.percent ?? 0) > 0 ? ` (${pct(r.percent!)})` : ''}
                </option>
              ))}
            </select>
          )}
          <span className="spacer" />
          {!g.equal && <span className={off ? 'error-text' : 'muted'}>Shares add up to {pct(total)}</span>}
          {off && total > 0 && (
            <button type="button" className="secondary small" onClick={() => scaleShares(g)}>
              Scale to 100%
            </button>
          )}
        </div>
        <p className="hint">
          A stock moved in or taken out keeps its part of the category, so the targets still add up the same.
        </p>
        <div className="row">
          <button type="button" className="small" onClick={() => setOpenGroup(null)}>
            Done
          </button>
          <span className="muted small-text">Category targets add up to {pct(targetTotal)}</span>
        </div>
      </div>
    );
  };
  const editing = groups.find((g) => g.key === openGroup);

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
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Pension"
              autoFocus
            />
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
          {editing ? (
            groupBox(editing)
          ) : (
            <>
              <p className="hint">
                For each stock, set the share of this category it should be (target) and how many shares this category
                owns now. A stock with no target is kept but never bought. A group (e.g. "Corporates" 5% with AMZN,
                TSLA…) shares one target between its stocks; open it to choose its stocks and how it is split.
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
                    {groups.map((g, gi) => groupRow(g, gi))}
                  </tbody>
                </table>
              </div>
              <div className="row">
                <button type="button" className="secondary small" onClick={() => setRows((rs) => [...rs, emptyRow()])}>
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
              {!hasTargets && (
                <p className="hint">Without target stocks, money given to this category stays as cash.</p>
              )}
            </>
          )}
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
              <NumberField
                className="narrow"
                value={percent}
                onChange={setPercent}
                suffix="%"
                aria-label="Percentage"
              />
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
