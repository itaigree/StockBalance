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
  /**
   * Told whether the text can be read as a number (empty counts as readable), and the text, so a form
   * can refuse to save "5.5." or "100%" instead of treating it like an empty field. A field that goes
   * away doesn't report anything: the form knows whether its value still counts.
   */
  onValidityChange?: (valid: boolean, text: string) => void;
  /** Text to show at first instead of the value, e.g. unreadable text the form kept while the field was hidden. */
  initialText?: string;
};

const format = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 10 });

/**
 * Text input for numbers that lets the user type freely ("1,000", "0.", "") and reports the parsed
 * value. External value changes are reflected unless they match what is already typed. While the
 * user has just emptied the field, a default the parent puts in its place (e.g. the latest rate)
 * waits until the field is left, so it isn't mixed into what is being typed. The number is shown
 * with thousands separators when the field isn't being edited.
 */
export function NumberField({
  value,
  onChange,
  prefix,
  suffix,
  className,
  onBlur,
  onFocus,
  onValidityChange,
  initialText,
  ...rest
}: Props) {
  const [text, setText] = useState(() => initialText ?? (value === null ? '' : format(value)));
  const lastEmitted = useRef<number | null>(value);
  const focused = useRef(false);

  useEffect(() => {
    if (value === lastEmitted.current) return;
    if (focused.current && lastEmitted.current === null && value !== null) return;
    setText(value === null ? '' : format(value));
    lastEmitted.current = value;
  }, [value]);

  const parsed = parseNumber(text);
  const invalid = text.trim() !== '' && parsed === null;
  const onValidityRef = useRef(onValidityChange);
  onValidityRef.current = onValidityChange;
  useEffect(() => {
    onValidityRef.current?.(!invalid, text);
  }, [invalid, text]);

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
          // Told together with the value, so the form never sees one without the other.
          onValidityRef.current?.(e.target.value.trim() === '' || n !== null, e.target.value);
          onChange(n);
        }}
        onFocus={(e) => {
          focused.current = true;
          onFocus?.(e);
        }}
        onBlur={(e) => {
          focused.current = false;
          const n = parseNumber(text);
          if (value !== lastEmitted.current) {
            // The value changed (or was filled in by the parent) while typing: show it now.
            setText(value === null ? '' : format(value));
            lastEmitted.current = value;
          } else if (n !== null) setText(format(n));
          onBlur?.(e);
        }}
      />
      {suffix && <span className="affix">{suffix}</span>}
    </span>
  );
}
