import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderApp, sample, savedData } from '../test-utils';

describe('PortfolioPage', () => {
  it('welcomes a new user and can load sample data', async () => {
    const { user } = renderApp('portfolio');
    expect(screen.getByRole('heading', { name: 'Welcome to StockBalance' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Load sample data' }));
    expect(screen.getByRole('heading', { name: 'Pension' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Kids' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Investments' })).toBeInTheDocument();
    await waitFor(() => expect(savedData().categories).toHaveLength(3));
  });

  it('keeps listing past purchases when every category was deleted', () => {
    const data = sample();
    data.categories = [];
    data.transactions = [{ id: 't', date: '2026-10-01T12:00:00.000Z', usdIls: 3.7, fxFeePercent: 0, orders: [], allocations: [], cash: [] }];
    renderApp('portfolio', data);
    expect(screen.queryByRole('heading', { name: 'Welcome to StockBalance' })).not.toBeInTheDocument();
    expect(screen.getByText('All purchases')).toBeInTheDocument();
    expect(screen.getByText(/There are no categories now/)).toBeInTheDocument();
  });

  it('keeps the user’s settings when loading the sample on the welcome page', async () => {
    const data = sample();
    data.categories = [];
    data.settings = { ...data.settings, finnhubApiKey: 'my-key', fxFeePercent: 0.5 };
    const { user } = renderApp('portfolio', data);
    await user.click(screen.getByRole('button', { name: 'Load sample data' }));
    await waitFor(() => expect(savedData().settings).toMatchObject({ finnhubApiKey: 'my-key', fxFeePercent: 0.5 }));
  });

  it('shows each category against its targets', () => {
    renderApp('portfolio', sample());
    const pension = screen.getByRole('region', { name: 'Pension' });
    const voo = within(pension).getByText('VOO').closest('tr')!;
    // 40 × $560 = $22,400 of $36,530 → 61.3% vs a 60% target.
    expect(within(voo).getByText('$22,400.00')).toBeInTheDocument();
    expect(within(voo).getByText('61.3%')).toBeInTheDocument();
    expect(within(voo).getByText('+1.3 pp')).toBeInTheDocument();
    const investments = screen.getByRole('region', { name: 'Investments' });
    expect(within(investments).getByText('not a target')).toBeInTheDocument();
  });

  it('adds up shares of the same stock across categories in the broker view', async () => {
    const { user } = renderApp('portfolio', sample());
    await user.click(screen.getByText('Broker view'));
    const row = screen
      .getAllByRole('row')
      .find((r) => r.closest('.broker-view') && within(r).queryByText('VOO'))!;
    expect(within(row).getByText('47.5')).toBeInTheDocument(); // 40 + 3.5 + 4
  });

  it('lets the user type a price by hand', async () => {
    const { user } = renderApp('portfolio', sample());
    const pension = screen.getByRole('region', { name: 'Pension' });
    await user.click(within(pension).getByRole('button', { name: /\$65\.00/ }));
    const input = screen.getByLabelText('Price of VXUS in USD');
    await user.clear(input);
    await user.type(input, '70');
    await user.click(screen.getByRole('button', { name: 'Save price' }));
    expect(within(pension).getByRole('button', { name: /\$70\.00/ })).toBeInTheDocument();
    await waitFor(() => expect(savedData().prices.VXUS).toMatchObject({ priceUsd: 70, source: 'manual' }));
  });

  it('flags missing prices', async () => {
    const data = sample();
    delete data.prices.GLD;
    renderApp('portfolio', data);
    expect(screen.getByText(/1 missing \(GLD\)/)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Enter price' }).length).toBeGreaterThan(0);
  });

  it('shows a group of stocks with its combined weight', () => {
    const data = sample();
    data.categories[2] = {
      ...data.categories[2],
      targets: [
        { ticker: 'QQQ', percent: 50 },
        { ticker: 'VOO', percent: 30 },
        { ticker: 'GLD', percent: 10, group: 'Safe' },
        { ticker: 'AAPL', percent: 10, group: 'Safe' },
      ],
    };
    renderApp('portfolio', data);
    const investments = screen.getByRole('region', { name: 'Investments' });
    const row = within(investments).getByText('Safe').closest('tr')!;
    // GLD 6 × $300 + AAPL 5 × $230 = $2,950 → 20% target.
    expect(within(row).getByText('$2,950.00')).toBeInTheDocument();
    expect(within(row).getByText('20.0%')).toBeInTheDocument();
  });
});

