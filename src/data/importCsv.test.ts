import { describe, expect, it } from 'vitest';
import type { Category } from '../types';
import { applyImport, defaultTarget, parseCsv, parseYahooPortfolioCsv } from './importCsv';
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

  it('turns Yahoo share-class symbols into the app form (BRK-B → BRK.B)', () => {
    const csv = 'Symbol,Portfolio,Currency,Shares Owned,Type\nBRK-B,Pension,USD,10,Buy\nBF-B,Pension,USD,2,Buy\nVOO,Pension,USD,2,Buy\n';
    expect(parseYahooPortfolioCsv(csv)).toMatchObject({ ok: true, portfolios: [{ name: 'Pension', holdings: { 'BRK.B': 10, 'BF.B': 2, VOO: 2 } }] });
  });

  it('rejects files that are not portfolio exports', () => {
    expect(parseYahooPortfolioCsv('name,age\nx,1')).toMatchObject({ ok: false });
    expect(parseYahooPortfolioCsv('Symbol,Shares Owned\n')).toMatchObject({ ok: false, error: /No holdings/ });
  });
});

describe('applyImport', () => {
  const pension: Category = {
    id: 'p',
    name: 'pension',
    color: '#2563eb',
    targets: [{ ticker: 'VTI', percent: 100 }],
    holdings: { VTI: 1, OLD: 3 },
    cashIls: 50,
    contribution: { kind: 'percent', percent: 70 },
  };

  it('matches categories by name by default', () => {
    expect(defaultTarget([pension], { name: 'Pension', holdings: {} })).toEqual({ kind: 'existing', categoryId: 'p' });
    expect(defaultTarget([pension], { name: 'Kids', holdings: {} })).toEqual({ kind: 'new', name: 'Kids' });
  });

  it('replaces holdings of the chosen category, creates new ones, skips, and adds up shared targets', () => {
    const result = applyImport(
      [pension],
      [
        { name: 'My Portfolio', holdings: { VTI: 5 } },
        { name: 'Eitan', holdings: { VT: 2 } },
        { name: 'Naveh', holdings: { VT: 1, VTI: 1 } },
        { name: 'Galit', holdings: { AMZN: 10 } },
      ],
      [
        { kind: 'existing', categoryId: 'p' },
        { kind: 'new', name: 'Kids' },
        { kind: 'new', name: ' kids ' },
        { kind: 'skip' },
      ],
    );
    expect(result[0]).toEqual({ ...pension, holdings: { VTI: 5 } });
    expect(result).toHaveLength(2);
    expect(result[1]).toMatchObject({ name: 'Kids', holdings: { VT: 3, VTI: 1 }, targets: [], contribution: { kind: 'none' } });
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
