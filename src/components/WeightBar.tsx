import { fmtPercent } from '../lib/format';

interface Props {
  /** Current weight 0..100, or null when unknown. */
  current: number | null;
  /** Target weight 0..100. */
  target: number;
  /** Optional weight after a planned purchase, drawn as a lighter extension/marker. */
  after?: number | null;
  color?: string;
}

/**
 * Horizontal bar: filled to the current weight, with a vertical tick at the target. When `after`
 * is given, the solid part is the lower of before and after, and a light extension reaches the
 * higher one: plain when the weight grows, hatched when it drops.
 */
export function WeightBar({ current, target, after, color = 'var(--accent)' }: Props) {
  const clamp = (n: number) => Math.max(0, Math.min(100, n));
  const shown = after ?? current;
  const label =
    current === null
      ? `Target ${fmtPercent(target)}; current weight unknown`
      : `Current ${fmtPercent(current)}${after != null ? `, after purchase ${fmtPercent(after)}` : ''}, target ${fmtPercent(target)}`;
  const both = after != null && current !== null;
  return (
    <div className="weight-bar" role="img" aria-label={label} title={label}>
      {both ? (
        <>
          <div
            className={`fill ${after > current ? 'after' : 'dropped'}`}
            style={{ width: `${clamp(Math.max(current, after))}%`, background: color }}
          />
          <div className="fill before" style={{ width: `${clamp(Math.min(current, after))}%`, background: color }} />
        </>
      ) : (
        shown !== null && shown !== undefined && <div className="fill" style={{ width: `${clamp(shown)}%`, background: color }} />
      )}
      <div className="target" style={{ left: `${clamp(target)}%` }} />
    </div>
  );
}
