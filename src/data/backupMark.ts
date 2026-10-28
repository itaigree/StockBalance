import type { AppData } from '../types';

const KEY = 'stockbalance:backup';

/** Days after which changes not in a backup are worth a reminder. */
const OLD_DAYS = 30;
/** How long "Later" hides the reminder. */
const SNOOZE_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

/** When this browser last made a backup, and of what (kept beside the data, not in it). */
export interface BackupMark {
  at?: string;
  /** `dataSignature` of the data that was backed up. */
  signature?: string;
  /** Id of the newest purchase in that backup. */
  lastTxId?: string | null;
  /** The reminder is hidden until then. */
  snoozedUntil?: string;
}

/**
 * A short fingerprint of what a backup keeps that the user entered (categories, purchases,
 * settings), so price refreshes don't count as changes.
 */
export function dataSignature(data: AppData): string {
  const text = JSON.stringify([data.categories, data.transactions, data.settings]);
  // FNV-1a, 32 bit.
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

export function loadBackupMark(storage: Storage | null = safeStorage()): BackupMark {
  try {
    const m = JSON.parse(storage?.getItem(KEY) ?? 'null') as BackupMark | null;
    return m && typeof m === 'object' ? m : {};
  } catch {
    return {};
  }
}

function saveBackupMark(mark: BackupMark, storage: Storage | null): BackupMark {
  try {
    storage?.setItem(KEY, JSON.stringify(mark));
  } catch {
    // Only used for the reminder; ignore storage problems.
  }
  return mark;
}

/** Remember that `data` was just backed up. */
export function markBackedUp(data: AppData, now: Date = new Date(), storage: Storage | null = safeStorage()): BackupMark {
  return saveBackupMark(
    { at: now.toISOString(), signature: dataSignature(data), lastTxId: data.transactions.at(-1)?.id ?? null },
    storage,
  );
}

/** Hide the reminder for a while. */
export function snoozeBackupReminder(mark: BackupMark, now: Date = new Date(), storage: Storage | null = safeStorage()): BackupMark {
  return saveBackupMark({ ...mark, snoozedUntil: new Date(now.getTime() + SNOOZE_DAYS * DAY_MS).toISOString() }, storage);
}

export type BackupReminder = 'never' | 'purchases' | 'old';

/**
 * Why to remind the user to back up, or null: there is data and no backup yet, purchases were
 * recorded since the last backup, or it is a month old and things changed since.
 */
export function backupReminder(data: AppData, mark: BackupMark, now: Date = new Date()): BackupReminder | null {
  if (data.categories.length === 0) return null;
  if (mark.snoozedUntil && new Date(mark.snoozedUntil).getTime() > now.getTime()) return null;
  if (!mark.at) return 'never';
  if (mark.signature === dataSignature(data)) return null;
  if ((data.transactions.at(-1)?.id ?? null) !== (mark.lastTxId ?? null)) return 'purchases';
  return now.getTime() - new Date(mark.at).getTime() >= OLD_DAYS * DAY_MS ? 'old' : null;
}

function safeStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
