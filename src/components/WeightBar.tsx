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
 * is given, the fill shows the after-weight and the before-weight is a darker inner segment.
 */
export function WeightBar({ current, target, after, color = 'var(--accent)' }: Props) {
  const clamp = (n: number) => Math.max(0, Math.min(100, n));
  const shown = after ?? current;
  const label =
    current === null
      ? `Target ${fmtPercent(target)}; current weight unknown`
      : `Current ${fmtPercent(current)}${after != null ? `, after purchase ${fmtPercent(after)}` : ''}, target ${fmtPercent(target)}`;
  return (
    <div className="weight-bar" role="img" aria-label={label} title={label}>
      {shown !== null && shown !== undefined && (
        <div
          className={`fill${after != null ? ' after' : ''}`}
          style={{ width: `${clamp(shown)}%`, background: color }}
        />
      )}
      {after != null && current !== null && (
        <div className="fill before" style={{ width: `${clamp(current)}%`, background: color }} />
      )}
      <div className="target" style={{ left: `${clamp(target)}%` }} />
    </div>
  );
}
