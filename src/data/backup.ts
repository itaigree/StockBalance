import type { AppData } from '../types';
import type { ParseResult } from './schema';

/** Pretty-printed JSON for a backup file. */
export function serializeBackup(data: AppData): string {
  void data;
  throw new Error('not implemented');
}

/** e.g. "stockbalance-backup-2026-10-22.json" */
export function backupFileName(date: Date): string {
  void date;
  throw new Error('not implemented');
}

/** Trigger a browser download of the backup file. */
export function downloadBackup(data: AppData, date: Date = new Date()): void {
  void data;
  void date;
  throw new Error('not implemented');
}

/** Read and validate a backup file chosen by the user. */
export async function readBackupFile(file: File): Promise<ParseResult> {
  void file;
  throw new Error('not implemented');
}
