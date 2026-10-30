import { describe, expect, it } from 'vitest';
import type { AppData } from '../types';
import { backupReminder, dataSignature, loadBackupMark, markBackedUp, snoozeBackupReminder } from './backupMark';
import { emptyData } from './schema';
import { fingerprint } from '../lib/fingerprint';
import { sampleData } from './sample';

/** A Storage backed by a Map. */
function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, v),
  };
}

const DAY = 24 * 60 * 60 * 1000;
const t0 = new Date('2026-10-01T10:00:00Z');
const later = (days: number) => new Date(t0.getTime() + days * DAY);

describe('backup reminder', () => {
  it('asks for a first backup once there is data', () => {
    expect(backupReminder(emptyData(), {}, t0)).toBeNull();
    expect(backupReminder(sampleData(t0), {}, t0)).toBe('never');
  });

  it('is quiet after a backup, also when only prices changed', () => {
    const storage = memoryStorage();
    const data = sampleData(t0);
    markBackedUp(data, t0, storage);
    const mark = loadBackupMark(storage);
    expect(mark.at).toBe(t0.toISOString());
    expect(backupReminder(data, mark, later(100))).toBeNull();
    const repriced: AppData = { ...data, prices: {}, fx: null };
    expect(dataSignature(repriced)).toBe(dataSignature(data));
    expect(backupReminder(repriced, mark, later(100))).toBeNull();
  });

  it('reminds after purchases right away, and after other changes once the backup is a month old', () => {
    const storage = memoryStorage();
    const data = sampleData(t0);
    const mark = markBackedUp(data, t0, storage);
    const renamed = { ...data, categories: data.categories.map((c, i) => (i === 0 ? { ...c, name: 'Retirement' } : c)) };
    expect(backupReminder(renamed, mark, later(29))).toBeNull();
    expect(backupReminder(renamed, mark, later(30))).toBe('old');
    const bought = { ...data, transactions: [{ id: 'tx-1' } as AppData['transactions'][number]] };
    expect(backupReminder(bought, mark, later(1))).toBe('purchases');
  });

  it('reminds after undoing an older purchase too', () => {
    const storage = memoryStorage();
    const tx = (id: string) => ({ id }) as AppData['transactions'][number];
    const data = { ...sampleData(t0), transactions: [tx('t1'), tx('t2')] };
    const mark = markBackedUp(data, t0, storage);
    expect(backupReminder({ ...data, transactions: [tx('t2')] }, mark, later(1))).toBe('purchases');
  });

  it('can be put off for a week', () => {
    const storage = memoryStorage();
    const data = sampleData(t0);
    const mark = snoozeBackupReminder(t0, storage);
    expect(backupReminder(data, loadBackupMark(storage), later(6))).toBeNull();
    expect(backupReminder(data, mark, later(7))).toBe('never');
  });

  it('keeps a backup made in another open copy when the reminder is put off', () => {
    const storage = memoryStorage();
    const data = sampleData(t0);
    // This copy read the mark before the other one made a backup.
    const stale = loadBackupMark(storage);
    expect(backupReminder(data, stale, t0)).toBe('never');
    markBackedUp(data, t0, storage);
    snoozeBackupReminder(later(1), storage);
    expect(loadBackupMark(storage)).toMatchObject({ at: t0.toISOString(), signature: dataSignature(data) });
  });

  it('gives the same signature to the same data whatever the order of its keys', () => {
    const data = sampleData(t0);
    const reordered = {
      ...data,
      categories: data.categories.map((c) => Object.fromEntries(Object.entries(c).reverse()) as typeof c),
    };
    expect(dataSignature(reordered)).toBe(dataSignature(data));
    expect(dataSignature({ ...data, categories: data.categories.slice(1) })).not.toBe(dataSignature(data));
  });

  it('still recognises a backup marked by the previous version (key-order signature)', () => {
    const data = sampleData(t0);
    const legacy = {
      at: t0.toISOString(),
      signature: fingerprint(JSON.stringify([data.categories, data.transactions, data.settings])),
      purchases: fingerprint(JSON.stringify(data.transactions.map((t) => t.id))),
    };
    expect(backupReminder(data, legacy, later(40))).toBeNull();
  });

  it('ignores a broken saved mark', () => {
    const storage = memoryStorage();
    storage.setItem('stockbalance:backup', '{oops');
    expect(loadBackupMark(storage)).toEqual({});
  });
});
