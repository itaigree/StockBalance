import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { serializeBackup } from '../data/backup';
import { YAHOO_CSV } from '../data/importCsv.fixture';
import { renderApp, sample, savedData } from '../test-utils';

const download = vi.hoisted(() => vi.fn());
vi.mock('../data/backup', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../data/backup')>()),
  downloadBackup: download,
}));

describe('SettingsPage', () => {
  it('changes the price source and the Finnhub key', async () => {
    const { user } = renderApp('settings', sample());
    await user.click(screen.getByRole('radio', { name: /^Finnhub/ }));
    await user.type(screen.getByLabelText('Finnhub API key'), 'abc123');
    await waitFor(() => expect(savedData().settings).toMatchObject({ priceProvider: 'finnhub', finnhubApiKey: 'abc123' }));
  });

  it('saves valid purchase defaults and rejects invalid ones', async () => {
    const { user } = renderApp('settings', sample());
    await user.type(screen.getByLabelText(/Minimum order/), '250');
    await user.click(screen.getByLabelText(/whole shares/));
    const max = screen.getByLabelText(/Max different stocks/);
    await user.type(max, '0');
    expect(screen.getByText('A whole number, 1 or more.')).toBeInTheDocument();
    await waitFor(() => expect(savedData().settings).toMatchObject({ minOrderUsd: 250, wholeShares: false, maxTickersPerPurchase: null }));
    await user.clear(max);
    await user.type(max, '3');
    await waitFor(() => expect(savedData().settings.maxTickersPerPurchase).toBe(3));
  });

  it('downloads a backup', async () => {
    const data = sample();
    const { user } = renderApp('settings', data);
    await user.click(screen.getByRole('button', { name: 'Download backup' }));
    expect(download).toHaveBeenCalledWith(data);
  });

  it('restores a backup after confirmation and rejects bad files', async () => {
    const { user } = renderApp('settings');
    const input = screen.getByLabelText('Backup file to restore');
    await user.upload(input, new File(['nope'], 'bad.json', { type: 'application/json' }));
    expect(await screen.findByText(/not valid JSON/)).toBeInTheDocument();

    await user.upload(input, new File([serializeBackup(sample())], 'good.json', { type: 'application/json' }));
    expect(await screen.findByText(/3 categories and 0 recorded purchases/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Replace my data' }));
    await waitFor(() => expect(savedData().categories).toHaveLength(3));
  });

  it('deletes everything only after typing DELETE', async () => {
    const { user } = renderApp('settings', sample());
    await user.click(screen.getByRole('button', { name: 'Delete all data' }));
    const confirm = screen.getByRole('button', { name: 'Delete everything' });
    expect(confirm).toBeDisabled();
    await user.type(screen.getByLabelText('Type DELETE to confirm'), 'DELETE');
    await user.click(confirm);
    await waitFor(() => expect(savedData().categories).toEqual([]));
  });
});

describe('import holdings', () => {
  it('previews and imports a Yahoo Finance export', async () => {
    const { user } = renderApp('settings', sample());
    await user.upload(screen.getByLabelText('Yahoo Finance CSV file to import'), new File([YAHOO_CSV], 'p.csv', { type: 'text/csv' }));
    expect(await screen.findByText('replaces shares')).toBeInTheDocument(); // Pension exists in the sample
    expect(screen.getByText('new category')).toBeInTheDocument(); // My Portfolio
    await user.click(screen.getByRole('button', { name: 'Import' }));
    await waitFor(() => {
      const cats = savedData().categories;
      expect(cats.find((c) => c.name === 'Pension')!.holdings).toEqual({ VTI: 5 });
      expect(cats.find((c) => c.name === 'Pension')!.targets.length).toBeGreaterThan(0);
      expect(cats.find((c) => c.name === 'My Portfolio')!.holdings).toEqual({ 'MXWO.L': 3, VT: 12.5 });
    });
  });
});
