import { useState } from 'react';
import { useApp } from '../state/AppState';
import { canShareBackup, downloadBackup, shareableBackupFile, shareBackupFile } from '../data/backup';
import {
  backupReminder,
  clearBackupMark,
  loadBackupMark,
  markBackedUp,
  snoozeBackupReminder,
  type BackupMark,
} from '../data/backupMark';
import { fmtAgo } from '../lib/format';

/** True on touch devices (phones, tablets), where sharing the file is the natural way to keep it. */
function touchDevice(): boolean {
  try {
    return window.matchMedia('(pointer: coarse)').matches;
  } catch {
    return false;
  }
}

/**
 * Making backups: download the file, or (where the device can) send it through the share sheet to
 * Drive, iCloud, email and so on. `backUp` picks the share sheet on phones and a download elsewhere.
 * Each successful backup is remembered, for the reminder. Both resolve to false if no backup was made.
 */
export function useBackup() {
  const { data } = useApp();
  const [mark, setMark] = useState<BackupMark>(() => loadBackupMark());
  const [error, setError] = useState<string | null>(null);
  const [canShare] = useState(canShareBackup);

  const download = (): boolean => {
    setError(null);
    downloadBackup(data);
    setMark(markBackedUp(data));
    return true;
  };
  const share = async (): Promise<boolean> => {
    setError(null);
    const file = shareableBackupFile(data);
    if (!file) return download();
    try {
      if (!(await shareBackupFile(file))) return false;
      setMark(markBackedUp(data));
      return true;
    } catch {
      setError("The file couldn't be shared. Use Download backup instead.");
      return false;
    }
  };

  return {
    mark,
    error,
    canShare,
    download,
    share,
    backUp: async (): Promise<boolean> => (canShare && touchDevice() ? share() : download()),
    snooze: () => setMark(snoozeBackupReminder(mark)),
    /** Forget the last backup (after deleting all data). */
    forget: () => {
      clearBackupMark();
      setMark({});
    },
  };
}

/** A banner asking for a backup when there is none yet or important changes aren't in one. */
export function BackupReminder() {
  const { data } = useApp();
  const backup = useBackup();
  const reason = backupReminder(data, backup.mark);
  if (!reason) return null;

  const ago = backup.mark.at ? fmtAgo(backup.mark.at) : '';
  const text =
    reason === 'never'
      ? "Your data is saved only in this browser: if the browser's data is cleared or you change phones, it's gone. Keep a backup copy somewhere safe."
      : reason === 'purchases'
        ? `Your purchases changed since your last backup (${ago}).`
        : `Your last backup was ${ago}, and things have changed since.`;

  return (
    <div className="banner warn backup-reminder" role="status">
      <span>{text}</span>
      <span className="row">
        <button type="button" className="small" onClick={() => void backup.backUp()}>
          Back up now
        </button>
        <button type="button" className="secondary small" onClick={backup.snooze}>
          Later
        </button>
      </span>
      {backup.error && <span className="error-text">{backup.error}</span>}
    </div>
  );
}
