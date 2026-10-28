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

/**
 * How this device can share the backup file (the phone's share sheet: Drive, iCloud, Files,
 * email…): as JSON, as plain text (some browsers only share text files; the content is the same and
 * restoring accepts both), or not at all.
 */
function shareableKind(): 'json' | 'text' | null {
  if (typeof navigator === 'undefined' || typeof navigator.canShare !== 'function') return null;
  const can = (name: string, type: string) => {
    try {
      return navigator.canShare({ files: [new File(['{}'], name, { type })] });
    } catch {
      return false;
    }
  };
  if (can('backup.json', 'application/json')) return 'json';
  if (can('backup.txt', 'text/plain')) return 'text';
  return null;
}

/** True when the backup can be sent through the share sheet. */
export function canShareBackup(): boolean {
  return shareableKind() !== null;
}

/** The backup as a file for the share sheet, or null if this device can't share files. */
export function shareableBackupFile(data: AppData, date: Date = new Date()): File | null {
  const kind = shareableKind();
  if (!kind) return null;
  const name = backupFileName(date);
  return kind === 'json'
    ? new File([serializeBackup(data)], name, { type: 'application/json' })
    : new File([serializeBackup(data)], name.replace(/\.json$/, '.txt'), { type: 'text/plain' });
}

/** Open the share sheet with the backup file. False if the user cancelled. */
export async function shareBackupFile(file: File): Promise<boolean> {
  try {
    await navigator.share({ files: [file], title: 'StockBalance backup' });
    return true;
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return false;
    throw e;
  }
}
