import { afterEach, describe, expect, it, vi } from 'vitest';
import { backupFileName, canShareBackup, readBackupFile, serializeBackup, shareableBackupFile } from './backup';
import { sampleData } from './sample';

describe('backup', () => {
  it('names the file with the local date', () => {
    expect(backupFileName(new Date(2026, 0, 5, 23, 59))).toBe('stockbalance-backup-2026-01-05.json');
  });

  it('round-trips through a file', async () => {
    const data = sampleData(new Date('2026-10-23T10:00:00Z'));
    const file = new File([serializeBackup(data)], 'b.json', { type: 'application/json' });
    expect(await readBackupFile(file)).toEqual({ ok: true, data });
  });

  it('explains bad files', async () => {
    expect(await readBackupFile(new File(['hello'], 'b.json'))).toEqual({ ok: false, error: 'The file is not valid JSON.' });
    expect(await readBackupFile(new File(['{"a":1}'], 'b.json'))).toMatchObject({ ok: false });
  });

  describe('sharing', () => {
    afterEach(() => vi.unstubAllGlobals());
    const data = sampleData(new Date('2026-10-23T10:00:00Z'));
    const date = new Date(2026, 9, 28);

    it('shares the JSON file where the device allows it', async () => {
      vi.stubGlobal('navigator', { ...navigator, canShare: () => true });
      const file = shareableBackupFile(data, date)!;
      expect(file.name).toBe('stockbalance-backup-2026-10-28.json');
      expect(await readBackupFile(file)).toEqual({ ok: true, data });
    });

    it('falls back to a text file where only those can be shared, and restores it', async () => {
      vi.stubGlobal('navigator', { ...navigator, canShare: ({ files }: ShareData) => files?.[0].type === 'text/plain' });
      const file = shareableBackupFile(data, date)!;
      expect(file.name).toBe('stockbalance-backup-2026-10-28.txt');
      expect(await readBackupFile(file)).toEqual({ ok: true, data });
    });

    it('offers no sharing where files cannot be shared', () => {
      vi.stubGlobal('navigator', { ...navigator, canShare: () => false });
      expect(canShareBackup()).toBe(false);
      expect(shareableBackupFile(data, date)).toBeNull();
    });
  });
});
