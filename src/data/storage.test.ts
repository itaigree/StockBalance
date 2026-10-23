import { describe, expect, it } from 'vitest';
import { emptyData } from './schema';
import { sampleData } from './sample';
import { STORAGE_KEY, loadData, saveData } from './storage';

function fakeStorage(initial: Record<string, string> = {}): Storage & { items: Record<string, string> } {
  const items = { ...initial };
  return {
    items,
    get length() {
      return Object.keys(items).length;
    },
    clear: () => Object.keys(items).forEach((k) => delete items[k]),
    getItem: (k) => (k in items ? items[k] : null),
    key: (i) => Object.keys(items)[i] ?? null,
    removeItem: (k) => void delete items[k],
    setItem: (k, v) => void (items[k] = v),
  };
}

const throwing = (name: string): Storage =>
  ({
    getItem: () => {
      throw Object.assign(new Error('nope'), { name });
    },
    setItem: () => {
      throw Object.assign(new Error('nope'), { name });
    },
  }) as unknown as Storage;

describe('storage', () => {
  it('starts empty when nothing is saved', () => {
    expect(loadData(fakeStorage())).toEqual({ data: emptyData() });
  });

  it('saves and loads data', () => {
    const s = fakeStorage();
    const data = sampleData(new Date('2026-10-23T10:00:00Z'));
    expect(saveData(data, s)).toEqual({});
    expect(loadData(s)).toEqual({ data });
  });

  it('keeps a copy of corrupt data and explains what happened', () => {
    const s = fakeStorage({ [STORAGE_KEY]: '{not json' });
    const r = loadData(s);
    expect(r.data).toEqual(emptyData());
    expect(r.error).toMatch(/couldn't be read/);
    const copyKey = Object.keys(s.items).find((k) => k.startsWith(`${STORAGE_KEY}:corrupt-`));
    expect(copyKey).toBeDefined();
    expect(s.items[copyKey!]).toBe('{not json');
    expect(r.error).toContain(copyKey);
  });

  it('treats invalid data like corrupt data', () => {
    const r = loadData(fakeStorage({ [STORAGE_KEY]: JSON.stringify({ version: 1, categories: [{ id: '', name: 'x' }] }) }));
    expect(r.error).toMatch(/id is empty/);
  });

  it('never throws when storage is blocked or full', () => {
    expect(loadData(throwing('SecurityError'))).toEqual({ data: emptyData() });
    expect(saveData(emptyData(), throwing('QuotaExceededError')).error).toMatch(/full/);
    expect(saveData(emptyData(), throwing('SecurityError')).error).toMatch(/doesn't allow/);
  });
});
