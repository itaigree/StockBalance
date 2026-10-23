import type { AppData } from '../types';
import { parseAppData, type ParseResult } from './schema';

/** Pretty-printed JSON for a backup file. */
export function serializeBackup(data: AppData): string {
  return JSON.stringify(data, null, 2);
}

/** e.g. "stockbalance-backup-2026-10-22.json" (local date). */
export function backupFileName(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `stockbalance-backup-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.json`;
}

/** Trigger a browser download of the backup file. */
export function downloadBackup(data: AppData, date: Date = new Date()): void {
  const blob = new Blob([serializeBackup(data)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = backupFileName(date);
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the browser a moment to start the download before releasing the blob.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Read and validate a backup file chosen by the user. */
export async function readBackupFile(file: File): Promise<ParseResult> {
  let text: string;
  try {
    text = await file.text();
  } catch {
    return { ok: false, error: "The file couldn't be read." };
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, error: 'The file is not valid JSON.' };
  }
  return parseAppData(json);
}
