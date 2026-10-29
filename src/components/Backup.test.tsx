import { act, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderApp, sample } from '../test-utils';

const download = vi.hoisted(() => vi.fn());
vi.mock('../data/backup', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../data/backup')>()),
  downloadBackup: download,
}));

const REMINDER = /Your data is saved only in this browser/;

/** Make this browser look like a phone that can share files. */
function asPhone(share: (data: ShareData) => Promise<void>) {
  Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true });
  Object.defineProperty(navigator, 'share', { value: vi.fn(share), configurable: true });
  window.matchMedia = ((q: string) => ({ matches: q === '(pointer: coarse)' })) as unknown as typeof window.matchMedia;
}

afterEach(() => {
  delete (navigator as { canShare?: unknown }).canShare;
  delete (navigator as { share?: unknown }).share;
  delete (window as { matchMedia?: unknown }).matchMedia;
  download.mockClear();
});

describe('backups', () => {
  it('reminds on the Portfolio page until a backup is made', async () => {
    const data = sample();
    const { user } = renderApp('portfolio', data);
    expect(screen.getByText(REMINDER)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Back up now' }));
    expect(download).toHaveBeenCalledWith(data);
    expect(screen.queryByText(REMINDER)).not.toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: 'Settings' }));
    expect(screen.getByText(/Last backup from this browser: just now/)).toBeInTheDocument();
  });

  it('can be put off', async () => {
    const { user, unmount } = renderApp('portfolio', sample());
    await user.click(screen.getByRole('button', { name: 'Later' }));
    expect(screen.queryByText(REMINDER)).not.toBeInTheDocument();
    unmount();
    renderApp('portfolio', sample());
    expect(screen.queryByText(REMINDER)).not.toBeInTheDocument();
    expect(download).not.toHaveBeenCalled();
  });

  it('uses the share sheet on a phone, and keeps reminding if it was cancelled', async () => {
    asPhone(() => Promise.reject(new DOMException('Share canceled', 'AbortError')));
    const { user } = renderApp('portfolio', sample());
    await user.click(screen.getByRole('button', { name: 'Back up now' }));
    expect(navigator.share).toHaveBeenCalledWith({ files: [expect.any(File)], title: 'StockBalance backup' });
    expect(download).not.toHaveBeenCalled();
    expect(screen.getByText(REMINDER)).toBeInTheDocument();

    vi.mocked(navigator.share).mockResolvedValueOnce(undefined);
    await user.click(screen.getByRole('button', { name: 'Back up now' }));
    expect(screen.queryByText(REMINDER)).not.toBeInTheDocument();
  });

  it('offers "Save or send" in Settings where files can be shared', async () => {
    asPhone(() => Promise.resolve());
    const { user } = renderApp('settings', sample());
    expect(screen.getByText('No backup made from this browser yet.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save or send…' }));
    expect(navigator.share).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Last backup from this browser: just now/)).toBeInTheDocument();
  });

  it('offers a backup right after a purchase is recorded', async () => {
    const { user } = renderApp('invest', sample());
    await user.type(screen.getByLabelText('Amount to invest in ILS'), '10000');
    await user.click(screen.getByRole('button', { name: 'I made a purchase' }));
    await user.click(screen.getByRole('button', { name: 'Record purchase' }));
    await user.click(screen.getByRole('button', { name: 'Back up now' }));
    expect(download).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Backed up\./)).toBeInTheDocument();
  });
});

describe('backup reminder with several copies of the app open', () => {
  it('goes away when another copy makes a backup', async () => {
    const data = sample();
    renderApp('portfolio', data);
    expect(screen.getByText(REMINDER)).toBeInTheDocument();
    const { markBackedUp } = await import('../data/backupMark');
    act(() => {
      markBackedUp(data);
      window.dispatchEvent(new StorageEvent('storage', { key: 'stockbalance:backup' }));
    });
    expect(screen.queryByText(REMINDER)).not.toBeInTheDocument();
  });
});
