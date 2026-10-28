import { useState } from 'react';
import type { Category } from '../types';
import type { CategoryValuation } from '../engine';
import { groupOf } from '../lib/targetGroups';
import { fmtPercent, fmtUsd } from '../lib/format';
import './StockDonuts.css';

/** At most this many slices; past it, the smallest stocks fold into "Other". */
const MAX_SLICES = 6;

interface Slice {
  key: string;
  label: string;
  group?: string;
  now: number;
  target: number;
  color: string;
}

/** A category's mix as two donuts — what it holds now and what it should hold — with a shared legend. */
export function StockDonuts({ category, valuation }: { category: Category; valuation: CategoryValuation }) {
  const [active, setActive] = useState<string | null>(null);
  const missingPrice = valuation.positions.some((p) => p.shares > 0 && p.weightPercent === null);
  const slices = slicesOf(category, valuation);
  if (slices.length === 0) return null;
  const hasNow = valuation.investedUsd > 0 && !missingPrice;

  return (
    <div className="donuts">
      <Donut
        title="Now"
        subtitle={hasNow ? fmtUsd(valuation.investedUsd, true) : undefined}
        empty={missingPrice ? 'Enter the missing prices' : 'No stocks yet'}
        slices={hasNow ? slices.map((s) => ({ ...s, value: s.now })) : []}
        active={active}
        onActive={setActive}
      />
      <Donut
        title="Target"
        empty="No targets set"
        slices={slices.map((s) => ({ ...s, value: s.target }))}
        active={active}
        onActive={setActive}
      />
      <table className="donut-legend">
        <thead>
          <tr>
            <th>Stock</th>
            <th className="num">Now</th>
            <th className="num">Target</th>
          </tr>
        </thead>
        <tbody>
          {slices.map((s) => (
            <tr
              key={s.key}
              className={active === s.key ? 'active' : undefined}
              onMouseEnter={() => setActive(s.key)}
              onMouseLeave={() => setActive(null)}
              onClick={() => setActive(active === s.key ? null : s.key)}
            >
              <td>
                <span className="swatch" style={{ background: s.color }} />
                <span className={s.key === OTHER ? undefined : 'ticker'}>{s.label}</span>
                {s.group && <span className="muted small-text"> · {s.group}</span>}
              </td>
              <td className="num">{hasNow ? fmtPercent(s.now) : '—'}</td>
              <td className="num">{s.target > 0 ? fmtPercent(s.target) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const OTHER = '__other__';

/** Slices in the order the valuation lists the stocks (targets first), each with a fixed color. */
function slicesOf(category: Category, valuation: CategoryValuation): Slice[] {
  let items = valuation.positions
    .map((p) => ({
      ticker: p.ticker,
      now: p.weightPercent ?? 0,
      target: p.targetPercent,
      group: p.targetPercent > 0 ? groupOf(category, p.ticker) : undefined,
    }))
    .filter((i) => i.now > 0 || i.target > 0);
  let other: Slice | null = null;
  if (items.length > MAX_SLICES) {
    const size = (i: { now: number; target: number }) => Math.max(i.now, i.target);
    const keep = new Set(
      [...items]
        .sort((a, b) => size(b) - size(a) || a.ticker.localeCompare(b.ticker))
        .slice(0, MAX_SLICES - 1)
        .map((i) => i.ticker),
    );
    const folded = items.filter((i) => !keep.has(i.ticker));
    other = {
      key: OTHER,
      label: `Other (${folded.map((i) => i.ticker).join(', ')})`,
      now: folded.reduce((s, i) => s + i.now, 0),
      target: folded.reduce((s, i) => s + i.target, 0),
      color: 'var(--series-other)',
    };
    items = items.filter((i) => keep.has(i.ticker));
  }
  const slices: Slice[] = items.map((i, k) => ({
    key: i.ticker,
    label: i.ticker,
    group: i.group,
    now: i.now,
    target: i.target,
    color: `var(--series-${k + 1})`,
  }));
  return other ? [...slices, other] : slices;
}

const SIZE = 200;
const C = SIZE / 2;
const OUTER = 96;
const INNER = 62;

function Donut({
  title,
  subtitle,
  empty,
  slices,
  active,
  onActive,
}: {
  title: string;
  subtitle?: string;
  empty: string;
  slices: (Slice & { value: number })[];
  active: string | null;
  onActive: (key: string | null) => void;
}) {
  const shown = slices.filter((s) => s.value > 0);
  const total = shown.reduce((s, x) => s + x.value, 0);
  const current = shown.find((s) => s.key === active);
  const label =
    total > 0
      ? `${title}: ${shown.map((s) => `${s.key === OTHER ? 'other' : s.label} ${fmtPercent((s.value / total) * 100)}`).join(', ')}`
      : `${title}: ${empty}`;

  let angle = -Math.PI / 2;
  return (
    <figure className="donut">
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label={label} onMouseLeave={() => onActive(null)}>
        {total > 0 ? (
          shown.map((s) => {
            const sweep = (s.value / total) * 2 * Math.PI;
            const d = arc(angle, angle + sweep);
            angle += sweep;
            return (
              <path
                key={s.key}
                d={d}
                fill={s.color}
                fillRule="evenodd"
                className={`slice${active !== null && active !== s.key ? ' dim' : ''}`}
                onMouseEnter={() => onActive(s.key)}
                onClick={() => onActive(active === s.key ? null : s.key)}
              />
            );
          })
        ) : (
          <path d={arc(0, 2 * Math.PI)} fillRule="evenodd" className="slice empty" />
        )}
        <text x={C} y={current || subtitle ? C - 6 : C + 6} textAnchor="middle" className="donut-title">
          {current ? (current.key === OTHER ? 'Other' : current.label) : title}
        </text>
        {(current || subtitle) && (
          <text x={C} y={C + 18} textAnchor="middle" className="donut-sub">
            {current ? fmtPercent((current.value / total) * 100) : subtitle}
          </text>
        )}
      </svg>
      {total === 0 && <figcaption className="muted small-text">{empty}</figcaption>}
    </figure>
  );
}

/** Path of a ring segment from angle a0 to a1 (radians, clockwise from the x axis). */
function arc(a0: number, a1: number): string {
  const pt = (r: number, a: number) => `${(C + r * Math.cos(a)).toFixed(3)} ${(C + r * Math.sin(a)).toFixed(3)}`;
  if (a1 - a0 >= 2 * Math.PI - 1e-9) {
    // A full ring: two circles, the inner one cut out (even-odd fill).
    const circle = (r: number) => `M ${C - r} ${C} A ${r} ${r} 0 1 1 ${C + r} ${C} A ${r} ${r} 0 1 1 ${C - r} ${C} Z`;
    return `${circle(OUTER)} ${circle(INNER)}`;
  }
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return [
    `M ${pt(OUTER, a0)}`,
    `A ${OUTER} ${OUTER} 0 ${large} 1 ${pt(OUTER, a1)}`,
    `L ${pt(INNER, a1)}`,
    `A ${INNER} ${INNER} 0 ${large} 0 ${pt(INNER, a0)}`,
    'Z',
  ].join(' ');
}
