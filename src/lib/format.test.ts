import { describe, expect, it } from 'vitest';
import { parseNumber } from './format';

describe('parseNumber', () => {
  it('reads plain numbers, money signs and thousands separators', () => {
    expect(parseNumber('2.5')).toBe(2.5);
    expect(parseNumber(' ₪10,000 ')).toBe(10000);
    expect(parseNumber('$1,234,567.89')).toBe(1234567.89);
    expect(parseNumber('-1,000')).toBe(-1000);
    expect(parseNumber('.5')).toBe(0.5);
  });

  it('does not read a decimal comma as a thousands separator', () => {
    expect(parseNumber('3,5')).toBeNull();
    expect(parseNumber('12,34')).toBeNull();
    expect(parseNumber('1,0000')).toBeNull();
    expect(parseNumber('1000,')).toBeNull();
  });

  it('rejects what is not a number', () => {
    for (const s of ['', '-', '.', 'abc', '1.2.3', '1e5']) expect(parseNumber(s)).toBeNull();
  });
});
