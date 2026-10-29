import type { BuyStrategy } from '../types';

export const BUY_STRATEGIES: { id: BuyStrategy; label: string; help: string }[] = [
  {
    id: 'balance',
    label: 'Balance all stocks',
    help: 'Spread the money over every stock below its target, so they all get closer to it.',
  },
  {
    id: 'fewest',
    label: 'Fewest orders',
    help: 'Fill the stock furthest below its target first, up to its target, then the next one. Fewer stocks to buy; the others catch up in later purchases.',
  },
];

/** Radio buttons for how each category's money is spread over its stocks. */
export function BuyStrategyChoice({
  value,
  onChange,
  name,
}: {
  value: BuyStrategy;
  onChange: (strategy: BuyStrategy) => void;
  /** Name of the radio group (unique on the page). */
  name: string;
}) {
  return (
    <fieldset className="choices">
      <legend>How to spend each category’s money</legend>
      {BUY_STRATEGIES.map((s) => (
        <label key={s.id} className="choice">
          <input type="radio" name={name} value={s.id} checked={value === s.id} onChange={() => onChange(s.id)} />
          <span>
            <strong>{s.label}</strong>
            <span className="muted small-text">{s.help}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}
