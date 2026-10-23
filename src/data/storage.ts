import type { AppData } from '../types';
import { emptyData, parseAppData } from './schema';

export const STORAGE_KEY = 'stockbalance:data';

function browserStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Load saved data. Missing data → empty data. Corrupt/invalid data → empty data plus an `error`
 * message, and the raw value is copied to `${STORAGE_KEY}:corrupt-<timestamp>` so nothing is lost.
 * Never throws (storage may be unavailable, e.g. in private mode).
 */
export function loadData(storage?: Storage): { data: AppData; error?: string } {
  const s = storage ?? browserStorage();
  let raw: string | null = null;
  try {
    raw = s?.getItem(STORAGE_KEY) ?? null;
  } catch {
    // Unavailable storage is reported when saving.
    return { data: emptyData() };
  }
  if (raw === null) return { data: emptyData() };

  let reason: string;
  try {
    const result = parseAppData(JSON.parse(raw));
    if (result.ok) return { data: result.data };
    reason = result.error;
  } catch {
    reason = 'it is not valid JSON';
  }

  const backupKey = `${STORAGE_KEY}:corrupt-${new Date().toISOString()}`;
  let kept = false;
  try {
    s?.setItem(backupKey, raw);
    kept = true;
  } catch {
    // Nothing more we can do; the error message says so.
  }
  return {
    data: emptyData(),
    error:
      `Your saved data couldn't be read (${reason.replace(/\.$/, '')}), so the app started empty. ` +
      (kept ? `The old data was kept in this browser under "${backupKey}". ` : '') +
      'If you have a backup file, restore it in Settings.',
  };
}

/** Save data. Returns an error message instead of throwing (e.g. quota exceeded / unavailable). */
export function saveData(data: AppData, storage?: Storage): { error?: string } {
  const s = storage ?? browserStorage();
  if (!s) return { error: "this browser doesn't allow saving data (private mode or blocked storage)." };
  try {
    s.setItem(STORAGE_KEY, JSON.stringify(data));
    return {};
  } catch (e) {
    const name = e instanceof Error ? e.name : '';
    return {
      error: /quota/i.test(name)
        ? "the browser's storage is full."
        : "this browser doesn't allow saving data (private mode or blocked storage).",
    };
  }
}
