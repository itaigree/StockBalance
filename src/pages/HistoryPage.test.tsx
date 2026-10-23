import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { AppData } from '../types';
import { applyTransaction, planPurchase, transactionFromPlan } from '../engine';
import { priceMap } from '../state/AppState';
import { renderApp, sample, savedData } from '../test-utils';

function withPurchase(): { before: AppData; after: AppData } {
  const before = sample();
  const plan = planPurchase({
    categories: before.categories,
    prices: priceMap(before.prices),
    usdIls: 3.7,
    fxFeePercent: 0,
    budgetsIls: { 'sample-pension': 6300, 'sample-kids': 1000, 'sample-investments': 2700 },
    options: { wholeShares: true, minOrderUsd: 0, maxTickers: null },
  });
  const tx = transactionFromPlan(
    plan,
    {
      orders: plan.orders.map((o) => ({ ticker: o.ticker, shares: o.shares, priceUsd: o.priceUsd })),
      usdIls: 3.7,
      fxFeePercent: 0,
      date: new Date(2026, 9, 20, 12).toISOString(),
      newMoneyIls: { 'sample-pension': 6300, 'sample-kids': 1000, 'sample-investments': 2700 },
      note: 'October deposit',
    },
    'tx-1',
  );
  return { before, after: { ...before, categories: applyTransaction(before.categories, tx), transactions: [tx] } };
}

describe('HistoryPage', () => {
  it('shows an empty state', () => {
    renderApp('history', sample());
    expect(screen.getByText(/No purchases recorded yet/)).toBeInTheDocument();
  });

  it('lists purchases with their orders and per-category details', async () => {
    const { after } = withPurchase();
    const { user } = renderApp('history', after);
    const card = screen.getByRole('article');
    expect(within(card).getByText('October deposit')).toBeInTheDocument();
    for (const o of after.transactions[0].orders) expect(within(card).getAllByText(o.ticker).length).toBeGreaterThan(0);
    await user.click(within(card).getByText('By category'));
    expect(within(card).getByText('Pension')).toBeInTheDocument();
    expect(within(card).getAllByText('₪6,300.00').length).toBeGreaterThan(0);
  });

  it('undoes a purchase after confirmation', async () => {
    const { before, after } = withPurchase();
    const { user } = renderApp('history', after);
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    await user.click(screen.getByRole('button', { name: 'Undo purchase' }));
    expect(screen.getByText(/No purchases recorded yet/)).toBeInTheDocument();
    await waitFor(() => expect(savedData().transactions).toEqual([]));
    const restored = savedData().categories;
    restored.forEach((c, i) => {
      expect(c.cashIls).toBeCloseTo(before.categories[i].cashIls, 4);
      for (const [t, n] of Object.entries(before.categories[i].holdings)) expect(c.holdings[t]).toBeCloseTo(n, 6);
    });
  });

  it('warns when holdings were edited since the purchase', async () => {
    const { after } = withPurchase();
    const data = { ...after, categories: after.categories.map((c) => ({ ...c, holdings: {} })) };
    const { user } = renderApp('history', data);
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.getByText(/now own fewer shares than the purchase gave them/)).toBeInTheDocument();
  });
});
