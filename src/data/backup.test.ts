import { describe, expect, it } from 'vitest';
import { backupFileName, readBackupFile, serializeBackup } from './backup';
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
});
