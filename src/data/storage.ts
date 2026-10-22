import type { AppData } from '../types';

export const STORAGE_KEY = 'stockbalance:data';

/**
 * Load saved data. Missing data → empty data. Corrupt/invalid data → empty data plus an `error`
 * message, and the raw value is copied to `${STORAGE_KEY}:corrupt-<timestamp>` so nothing is lost.
 * Never throws (storage may be unavailable, e.g. in private mode).
 */
export function loadData(storage?: Storage): { data: AppData; error?: string } {
  void storage;
  throw new Error('not implemented');
}

/** Save data. Returns an error message instead of throwing (e.g. quota exceeded / unavailable). */
export function saveData(data: AppData, storage?: Storage): { error?: string } {
  void data;
  void storage;
  throw new Error('not implemented');
}
