import { useEffect, useRef, useState, type InputHTMLAttributes } from 'react';
import { parseNumber } from '../lib/format';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type' | 'prefix'> & {
  value: number | null;
  /** Called with the parsed number, or null when the field is empty/invalid. */
  onChange: (value: number | null) => void;
  /** Text shown before the input, e.g. "₪" or "$". */
  prefix?: string;
  /** Text shown after the input, e.g. "%". */
  suffix?: string;
};

/**
 * Text input for numbers that lets the user type freely ("1,000", "0.", "") and reports the parsed
 * value. External value changes are reflected unless they match what is already typed.
 */
export function NumberField({ value, onChange, prefix, suffix, className, ...rest }: Props) {
  const [text, setText] = useState(() => (value === null ? '' : String(value)));
  const lastEmitted = useRef<number | null>(value);

  useEffect(() => {
    if (value !== lastEmitted.current) {
      setText(value === null ? '' : String(value));
      lastEmitted.current = value;
    }
  }, [value]);

  const parsed = parseNumber(text);
  const invalid = text.trim() !== '' && parsed === null;

  return (
    <span className={`number-field${invalid ? ' invalid' : ''}${className ? ` ${className}` : ''}`}>
      {prefix && <span className="affix">{prefix}</span>}
      <input
        {...rest}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        value={text}
        aria-invalid={invalid || undefined}
        onChange={(e) => {
          setText(e.target.value);
          const n = parseNumber(e.target.value);
          lastEmitted.current = n;
          onChange(n);
        }}
      />
      {suffix && <span className="affix">{suffix}</span>}
    </span>
  );
}
