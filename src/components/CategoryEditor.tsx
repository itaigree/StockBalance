import { useRef, useState } from 'react';
import type { Category, ContributionRule } from '../types';
import { useApp } from '../state/AppState';
import { apportion } from '../engine/apportion';
import { CATEGORY_COLORS, newId } from '../lib/ids';
import { fmtPercent, isTicker, normalizeTicker } from '../lib/format';
import { RULE_EXPLANATION } from '../lib/rules';
import { Modal } from './Modal';
import { NumberField } from './NumberField';
import './CategoryEditor.css';

const round2 = (n: number) => Math.round(n * 100) / 100;
/** Targets are kept to a millionth of a percent, so adding and subtracting them leaves no float noise. */
const roundTarget = (n: number) => Math.round(n * 1e6) / 1e6;

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
  /**
   * In a group with its own split: the exact share of the group behind the rounded one shown, used
   * while the share shown is left as it is (so opening and saving keeps the targets as they were).
   */
  exact?: { shown: number; share: number };
}

/** A group of stocks sharing one target, e.g. "Corporates" 5% of the category over AMZN, TSLA… */
interface Group {
  key: string;
  name: string;
  /** The group's target, % of the category. */
  percent: number | null;
  /** True: split equally between its stocks; false: each stock has its own share of the group. */
  equal: boolean;
  /**
   * The group as saved (its stocks' targets and exact shares by row key), written back unchanged while
   * it's left as it was.
   */
  stored?: { percent: number; equal: boolean; targets: Record<string, number>; shares: Record<string, number> };
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

/**
 * Each part's share of a group (% of the group) for parts in proportion: rounded to 0.01 to show,
 * adding up to 100, with the exact share kept. Parts that are all 0 get equal shares.
 */
function sharesFor(parts: number[]): { shown: number; share: number }[] {
  const sum = parts.reduce((s, p) => s + p, 0);
  const weights = sum > 0 ? parts : parts.map(() => 1);
  const total = sum > 0 ? sum : parts.length;
  return roundParts(weights, 100).map((shown, i) => ({ shown, share: (weights[i] / total) * 100 }));
}

/** The row with a new share of its group (or none), dropping the exact share behind the old one. */
function withShare(r: Row, share: { shown: number; share: number } | null): Row {
  const next: Row = { ...r, percent: share ? share.shown : null };
  if (share) next.exact = share;
  else delete next.exact;
  return next;
}

function stateFrom(category: Category | null): { rows: Row[]; groups: Group[] } {
  if (!category) return { rows: [emptyRow()], groups: [] };
  const groups: Group[] = [];
  const rows: Row[] = [];
  /** Each stock's target as saved, by row key (rows show it rounded). */
  const saved = new Map<string, number>();
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
    const key = newId();
    saved.set(key, t.percent);
    rows.push({
      key,
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
    g.percent = roundTarget(g.percent!);
    const members = rows.filter((r) => r.group === g.key);
    const parts = members.map((r) => saved.get(r.key)!);
    g.equal = parts.every((p) => Math.abs(p - parts[0]) < 1e-6);
    const shares = g.equal ? [] : sharesFor(parts);
    members.forEach((r, i) => {
      r.percent = g.equal ? null : shares[i].shown;
      if (!g.equal) r.exact = shares[i];
    });
    g.stored = {
      percent: g.percent,
      equal: g.equal,
      targets: Object.fromEntries(members.map((r, i) => [r.key, parts[i]])),
      shares: Object.fromEntries(members.map((r, i) => [r.key, g.equal ? 0 : shares[i].share])),
    };
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
  const { data } = useApp();
  /** The category as it was when the editor opened (the page may pass a newer one later). */
  const [opened] = useState(category);
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
  /** Why saving was refused although every field is fine (the category changed somewhere else). */
  const [conflict, setConflict] = useState<string | null>(null);
  const [moveChoice, setMoveChoice] = useState('');
  const moveSelect = useRef<HTMLSelectElement>(null);
  const boxAddStock = useRef<HTMLButtonElement>(null);
  /**
   * Number fields whose text can't be read ("rowKey:percent", "rowKey:shares"), with that text. It is
   * kept while the field is hidden (the stocks list and a group box take turns), so it comes back.
   */
  const [unreadable, setUnreadable] = useState<Record<string, string>>({});
  const trackReadable = (id: string) => (valid: boolean, text: string) =>
    setUnreadable((u) => {
      if (valid) {
        if (!(id in u)) return u;
        const next = { ...u };
        delete next[id];
        return next;
      }
      return u[id] === text ? u : { ...u, [id]: text };
    });
  /** Forget unreadable % text of these rows, whose % now means something else (or is set anew). */
  const forgetPercentText = (keys: string[]) =>
    setUnreadable((u) => {
      const ids = keys.map((k) => `${k}:percent`).filter((id) => id in u);
      if (ids.length === 0) return u;
      const next = { ...u };
      for (const id of ids) delete next[id];
      return next;
    });
  const groupOfRow = (r: Row) => groups.find((g) => g.key === r.group);
  /** True when the row has its own % field: a single stock, or a stock in a group with its own split. */
  const ownPercent = (r: Row) => !r.group || groupOfRow(r)?.equal === false;
  // Only fields that count (a stock in an equally split group has no % field).
  const unreadableRow = (r: Row) =>
    (ownPercent(r) && `${r.key}:percent` in unreadable) || `${r.key}:shares` in unreadable;

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
  /** True while every share of a group's own split is as computed, so the exact shares behind them count. */
  const exactShares = (g: Group) => !g.equal && filledMembers(g).every((r) => r.exact && r.percent === r.exact.shown);
  /** A stock's share of its group, % of the group (the shares shown once any of them was typed). */
  const shareOf = (g: Group, r: Row) =>
    g.equal ? 100 / Math.max(1, filledMembers(g).length) : exactShares(g) && r.exact ? r.exact.share : (r.percent ?? 0);
  /** True while a group is as it was saved: its stocks' saved targets are written back as they were. */
  const untouched = (g: Group) => {
    const s = g.stored;
    const members = filledMembers(g);
    return (
      !!s &&
      g.percent === s.percent &&
      g.equal === s.equal &&
      members.length === Object.keys(s.targets).length &&
      members.every((r) => r.key in s.targets) &&
      // The same shares as saved (not new ones from switching the split, scaling, moving stocks…).
      (g.equal || (exactShares(g) && members.every((r) => r.exact!.share === s.shares[r.key])))
    );
  };
  const sharesTotal = (g: Group) => filledMembers(g).reduce((s, r) => s + (r.percent ?? 0), 0);
  const targetTotal =
    filled.filter((r) => !r.group).reduce((s, r) => s + (r.percent ?? 0), 0) +
    groups.reduce((s, g) => s + (g.percent ?? 0), 0);
  const hasTargets = filled.some((r) => !r.group && (r.percent ?? 0) > 0) || groups.some((g) => (g.percent ?? 0) > 0);
  const totalOff = hasTargets && Math.abs(targetTotal - 100) > 0.01;

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
      else if (r.group && ownPercent(r) && !(shareOf(groupOfRow(r)!, r) > 0))
        e.rows[r.key] = 'Set this stock’s share of the group (above 0%).';
      else if (r.shares !== null && r.shares < 0) e.rows[r.key] = "Shares can't be negative.";
      seen.add(t);
    }
    const groupNames = new Set<string>();
    for (const g of groups) {
      const n = g.name.trim().toLowerCase();
      if (!n) e.groups[g.key] = 'Give the group a name.';
      else if (groupNames.has(n)) e.groups[g.key] = 'Two groups have this name.';
      else if (`${g.key}:target` in unreadable)
        e.groups[g.key] = 'Enter the group’s target in numbers only (e.g. 2.5).';
      else if (!(g.percent !== null && g.percent > 0 && g.percent <= 100))
        e.groups[g.key] = 'Set the group’s target (above 0%).';
      else if (filledMembers(g).length === 0) e.groups[g.key] = 'Add at least one stock to the group.';
      else if (!g.equal && Math.abs(sharesTotal(g) - 100) > 0.01)
        e.groups[g.key] = `The stocks’ shares add up to ${pct(sharesTotal(g))}; they must add up to 100% of the group.`;
      else if (membersOf(g).some((r) => e.rows[r.key])) e.groups[g.key] = 'Fix the stocks in this group.';
      groupNames.add(n);
    }
    if (totalOff) e.total = `Targets add up to ${fmtPercent(targetTotal, 2)}; they must add up to 100%.`;
    return e;
  })();

  const editing = groups.find((g) => g.key === openGroup);
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
    if (sharesTotal(g) <= 0) return;
    const shares = sharesFor(members.map((r) => r.percent!));
    const byKey = new Map(members.map((r, i) => [r.key, shares[i]]));
    setRows((rs) => rs.map((r) => (byKey.has(r.key) ? withShare(r, byKey.get(r.key)!) : r)));
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
    forgetPercentText(rows.filter((r) => r.group === key).map((r) => r.key));
    setRows((rs) => rs.map((r) => (r.group === key ? { ...withShare(r, null), group: undefined } : r)));
    setOpenGroup(null);
  };
  /**
   * Move one of the category's single stocks into a group. Its target comes along (the group's target
   * grows by it) and every stock keeps its part of the category, so the total stays the same; an
   * equal split becomes the group's own split when the parts aren't all the same.
   */
  const moveIn = (g: Group, r: Row) => {
    const t = r.percent ?? 0;
    const before = g.percent ?? 0;
    const members = filledMembers(g);
    let equal = g.equal;
    /** New shares of the group (own split), by row key. */
    const shares = new Map<string, { shown: number; share: number } | null>();
    if (before > 0 && t > 0 && members.length > 0) {
      if (!(g.equal && Math.abs(before / members.length - t) < 1e-6)) {
        equal = false;
        const parts = [...members.map((m) => (before * shareOf(g, m)) / 100), t];
        const s = sharesFor(parts);
        members.forEach((m, i) => shares.set(m.key, s[i]));
        shares.set(r.key, s[members.length]);
      }
    } else if (!g.equal) {
      // Nothing to keep in proportion (the group has no target yet, or the stock has none): the others
      // keep their shares, and the stock's share is left to set (all of it when it is the only one).
      shares.set(r.key, members.length === 0 ? { shown: 100, share: 100 } : null);
    }
    forgetPercentText([r.key, ...shares.keys(), ...(equal !== g.equal ? members.map((m) => m.key) : [])]);
    setRows((rs) =>
      rs
        .map((x) => {
          if (x.key === r.key) return { ...withShare(x, equal ? null : (shares.get(x.key) ?? null)), group: g.key };
          return shares.has(x.key) ? withShare(x, shares.get(x.key)!) : x;
        })
        // A new group's blank first row isn't needed once a stock is moved in.
        .filter(
          (x) =>
            !(
              x.group === g.key &&
              x.key !== r.key &&
              x.ticker.trim() === '' &&
              x.shares === null &&
              x.percent === null
            ),
        ),
    );
    updateGroup(g.key, { equal, ...(t > 0 ? { percent: roundTarget(before + t) } : {}) });
  };
  /**
   * Take a stock out of its group: it becomes a single stock with its part of the group's target, the
   * group's target shrinks by as much, and the others' shares grow to fill the group again. A group
   * left without stocks goes away.
   */
  const takeOut = (g: Group, r: Row) => {
    if (r.ticker.trim() === '') {
      setRows((rs) => rs.filter((x) => x.key !== r.key));
      if (membersOf(g).length === 1) {
        setGroups((gs) => gs.filter((x) => x.key !== g.key));
        setOpenGroup(null);
      }
      return;
    }
    const others = filledMembers(g).filter((m) => m.key !== r.key);
    // Rounded to 0.01% once, and the group gives up exactly that, so the total doesn't change (the
    // last stock gets the whole target of the group, which goes away).
    const part = others.length === 0 ? (g.percent ?? 0) : round2(((g.percent ?? 0) * shareOf(g, r)) / 100);
    const shares = new Map<string, { shown: number; share: number }>();
    if (!g.equal && others.length > 0) {
      const left = others.map((m) => shareOf(g, m));
      // Shares in proportion to what they had; when none is set yet, only a lone stock gets it all.
      if (left.some((x) => x > 0) || others.length === 1)
        sharesFor(left).forEach((s, i) => shares.set(others[i].key, s));
    }
    forgetPercentText([r.key, ...shares.keys()]);
    setRows((rs) =>
      rs
        .filter((x) => !(others.length === 0 && x.group === g.key && x.key !== r.key))
        .map((x) =>
          x.key === r.key
            ? { ...withShare(x, null), group: undefined, percent: part > 0 ? part : null }
            : shares.has(x.key)
              ? withShare(x, shares.get(x.key)!)
              : x,
        ),
    );
    if (others.length === 0) {
      setGroups((gs) => gs.filter((x) => x.key !== g.key));
      setOpenGroup(null);
    } else if (part > 0) updateGroup(g.key, { percent: roundTarget((g.percent ?? 0) - part) });
  };
  /** Switch a group between an equal split and its own split (starting from the equal shares). */
  const setSplit = (g: Group, equal: boolean) => {
    if (g.equal === equal) return;
    updateGroup(g.key, { equal });
    const members = filledMembers(g);
    const shares = equal ? [] : sharesFor(members.map(() => 1));
    const byKey = new Map(members.map((r, i) => [r.key, shares[i]]));
    forgetPercentText(membersOf(g).map((r) => r.key));
    setRows((rs) => rs.map((r) => (r.group !== g.key ? r : withShare(r, equal ? null : (byKey.get(r.key) ?? null)))));
  };

  /** Errors the open group box doesn't show: those of the single stocks and of other groups. */
  const hiddenByBox = (g: Group) =>
    single.some((r) => errors.rows[r.key]) ||
    groups.some((x) => x.key !== g.key && (errors.groups[x.key] || membersOf(x).some((r) => errors.rows[r.key])));
  const boxHasErrors = (g: Group) => !!errors.groups[g.key] || membersOf(g).some((r) => errors.rows[r.key]);

  const save = () => {
    setSubmitted(true);
    setConflict(null);
    if (!valid) {
      // Show the errors: leave a group box that has none of its own.
      if (editing && hiddenByBox(editing) && !boxHasErrors(editing)) setOpenGroup(null);
      return;
    }
    const contribution: ContributionRule =
      ruleKind === 'fixed'
        ? { kind: 'fixed', amountIls: fixedAmount! }
        : ruleKind === 'percent'
          ? { kind: 'percent', percent: percent! }
          : { kind: ruleKind };
    let holdings: Record<string, number> = Object.fromEntries(
      filled.filter((r) => (r.shares ?? 0) > 0).map((r) => [normalizeTicker(r.ticker), r.shares!]),
    );
    let cashIls = cash ?? 0;
    if (opened) {
      // Shares and cash change with purchases, also in another window while this is open: take the
      // stored ones for what wasn't edited here, and don't save over a change made meanwhile.
      const now = data.categories.find((c) => c.id === opened.id);
      if (!now) {
        setConflict(`${opened.name} was deleted or merged somewhere else while this was open, so it can't be saved.`);
        return;
      }
      const merged: Record<string, number> = {};
      let clash = false;
      for (const t of new Set([
        ...Object.keys(holdings),
        ...Object.keys(opened.holdings),
        ...Object.keys(now.holdings),
      ])) {
        const mine = holdings[t] ?? 0;
        const before = opened.holdings[t] ?? 0;
        const stored = now.holdings[t] ?? 0;
        const n = mine === before ? stored : mine;
        if (mine !== before && stored !== before) clash = true;
        if (n > 0) merged[t] = n;
      }
      if (cashIls !== opened.cashIls && now.cashIls !== opened.cashIls) clash = true;
      if (clash) {
        setConflict(
          `${opened.name}'s shares or cash changed somewhere else while this was open (for example a purchase in another window). Close this and edit again, so neither change is lost.`,
        );
        return;
      }
      holdings = merged;
      if (cashIls === opened.cashIls) cashIls = now.cashIls;
    }
    const trimmedNotes = notes.trim();
    onSave({
      id: category?.id ?? newId(),
      name: name.trim(),
      color,
      contribution,
      cashIls,
      targets: [
        ...filled
          .filter((r) => !r.group && (r.percent ?? 0) > 0)
          .map((r) => ({ ticker: normalizeTicker(r.ticker), percent: r.percent! })),
        // Each stock of a group gets its share of the group's target.
        ...groups.flatMap((g) =>
          filledMembers(g).map((r) => ({
            ticker: normalizeTicker(r.ticker),
            percent: untouched(g)
              ? g.stored!.targets[r.key]
              : Math.round(((g.percent! * shareOf(g, r)) / 100) * 1e9) / 1e9,
            group: g.name.trim(),
          })),
        ),
      ],
      holdings,
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
      initialText={unreadable[`${r.key}:shares`]}
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
          initialText={unreadable[`${r.key}:percent`]}
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
            onValidityChange={trackReadable(`${g.key}:target`)}
            initialText={unreadable[`${g.key}:target`]}
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
              onValidityChange={trackReadable(`${g.key}:target`)}
              initialText={unreadable[`${g.key}:target`]}
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
                          initialText={unreadable[`${r.key}:percent`]}
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
          <button
            type="button"
            className="secondary small"
            ref={boxAddStock}
            onClick={() => setRows((rs) => [...rs, emptyRow(g.key)])}
          >
            + Add stock
          </button>
          {movable.length > 0 && (
            // Choosing a stock doesn't move it yet (arrow keys go through the list): "Move in" does.
            <span className="inline-form">
              <select
                className="small-select"
                ref={moveSelect}
                value={movable.some((r) => r.key === moveChoice) ? moveChoice : ''}
                aria-label="Move one of the category's stocks into the group"
                onChange={(e) => setMoveChoice(e.target.value)}
              >
                <option value="">Choose a stock…</option>
                {movable.map((r) => (
                  <option key={r.key} value={r.key}>
                    {normalizeTicker(r.ticker)}
                    {(r.percent ?? 0) > 0 ? ` (${pct(r.percent!)})` : ''}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="secondary small"
                disabled={!movable.some((r) => r.key === moveChoice)}
                onClick={() => {
                  const r = movable.find((x) => x.key === moveChoice);
                  if (r) moveIn(g, r);
                  setMoveChoice('');
                  // This button is now disabled: keep the keyboard in the box (the list, or the button
                  // before it when no other stock is left to move).
                  (movable.length > 1 ? moveSelect.current : boxAddStock.current)?.focus();
                }}
              >
                Move in
              </button>
            </span>
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
          A stock moved in or taken out keeps its part of the category, so the targets still add up the same: an equal
          split becomes your own split when the parts differ, and a stock without a target joins an equal split as one
          more equal part.
        </p>
        <div className="row">
          <button type="button" className="small" onClick={() => setOpenGroup(null)}>
            Done
          </button>
          <span className={totalOff ? 'error-text' : 'muted small-text'}>
            Category targets add up to {pct(targetTotal)}
          </span>
        </div>
      </div>
    );
  };

  return (
    <Modal
      wide
      title={category ? `Edit ${category.name}` : 'New category'}
      onClose={onClose}
      footer={
        <>
          {submitted && !valid && <span className="error-text spacer">Please fix the highlighted fields.</span>}
          {conflict && valid && (
            <span className="error-text spacer" role="alert">
              {conflict}
            </span>
          )}
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
                <span className={totalOff ? 'error-text' : 'muted'}>Targets add up to {pct(targetTotal)}</span>
                {totalOff && (
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
