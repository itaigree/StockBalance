import { describe, expect, it } from 'vitest';
import type { Category } from '../types';
import { applyImport, parseCsv, parseYahooPortfolioCsv } from './importCsv';
import { YAHOO_CSV } from './importCsv.fixture';
import { yahooSymbol } from './prices';

describe('parseCsv', () => {
  it('handles quotes, escaped quotes, commas and CRLF', () => {
    expect(parseCsv('a,"b,c","d ""e"""\r\n1,,3')).toEqual([
      ['a', 'b,c', 'd "e"'],
      ['1', '', '3'],
    ]);
  });
});

describe('parseYahooPortfolioCsv', () => {
  it('nets buys and sells per portfolio and skips non-USD stocks', () => {
    const r = parseYahooPortfolioCsv(YAHOO_CSV);
    expect(r).toMatchObject({
      ok: true,
      portfolios: [
        { name: 'My Portfolio', holdings: { 'MXWO.L': 3, VT: 12.5 } },
        { name: 'Pension', holdings: { VTI: 5 } },
      ],
    });
    expect(r.ok && r.warnings.join(' ')).toMatch(/TEVA\.TA \(ILA\)/);
  });

  it('rejects files that are not portfolio exports', () => {
    expect(parseYahooPortfolioCsv('name,age\nx,1')).toMatchObject({ ok: false });
    expect(parseYahooPortfolioCsv('Symbol,Shares Owned\n')).toMatchObject({ ok: false, error: /No holdings/ });
  });
});

describe('applyImport', () => {
  it('replaces holdings of matching categories and adds new ones', () => {
    const pension: Category = {
      id: 'p',
      name: 'pension',
      color: '#2563eb',
      targets: [{ ticker: 'VTI', percent: 100 }],
      holdings: { VTI: 1, OLD: 3 },
      cashIls: 50,
      contribution: { kind: 'percent', percent: 70 },
    };
    const result = applyImport([pension], [
      { name: 'Pension', holdings: { VTI: 5 } },
      { name: 'Kids', holdings: { VT: 2 } },
    ]);
    expect(result[0]).toEqual({ ...pension, holdings: { VTI: 5 } });
    expect(result[1]).toMatchObject({ name: 'Kids', holdings: { VT: 2 }, targets: [], contribution: { kind: 'none' } });
    expect(result[1].color).not.toBe(pension.color);
  });
});

describe('yahooSymbol', () => {
  it('converts US share classes but keeps exchange suffixes', () => {
    expect(yahooSymbol('BRK.B')).toBe('BRK-B');
    expect(yahooSymbol('MXWO.L')).toBe('MXWO.L');
    expect(yahooSymbol('VOO')).toBe('VOO');
  });
});
