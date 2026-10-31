import { render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { AppData } from '../types';
import { applyTransaction, planPurchase, transactionFromPlan } from '../engine';
import { priceMap } from '../state/AppState';
import { renderApp, sample, savedData } from '../test-utils';
import { UndoModal } from './AllPurchases';

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

/** Render the Portfolio page and open its "All purchases" card. */
async function openPurchases(data: AppData) {
  const r = renderApp('portfolio', data);
  await r.user.click(screen.getByText('All purchases'));
  return r;
}

describe('All purchases (Portfolio page)', () => {
  it('shows when there are none yet', async () => {
    await openPurchases(sample());
    expect(screen.getByText('None recorded yet')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'History' })).not.toBeInTheDocument();
  });

  it('lists purchases with their orders and per-category details', async () => {
    const { after } = withPurchase();
    const { user } = await openPurchases(after);
    const card = screen.getByRole('article');
    expect(within(card).getByText('October deposit')).toBeInTheDocument();
    for (const o of after.transactions[0].orders) expect(within(card).getAllByText(o.ticker).length).toBeGreaterThan(0);
    await user.click(within(card).getByText('By category'));
    expect(within(card).getByText('Pension')).toBeInTheDocument();
    expect(within(card).getAllByText('₪6,300.00').length).toBeGreaterThan(0);
  });

  it('undoes a purchase after confirmation', async () => {
    const { before, after } = withPurchase();
    const { user } = await openPurchases(after);
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    await user.click(screen.getByRole('button', { name: 'Undo purchase' }));
    expect(screen.getByText('None recorded yet')).toBeInTheDocument();
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
    const { user } = await openPurchases(data);
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.getByText(/now own fewer shares than the purchase gave them/)).toBeInTheDocument();
  });
});

describe('a category’s purchases (its own page)', () => {
  it('shows them as a table with totals', () => {
    const { after } = withPurchase();
    renderApp('category/sample-kids', after);
    const table = screen.getByRole('region', { name: 'Kids purchases' });
    const body = within(table).getAllByRole('row');
    // header, one purchase, total
    expect(body).toHaveLength(3);
    expect(within(body[1]).getAllByText('₪1,000.00').length).toBeGreaterThan(0);
    expect(within(body[1]).getByText('October deposit')).toBeInTheDocument();
    const kidsAlloc = after.transactions[0].allocations.filter((a) => a.categoryId === 'sample-kids');
    const spent = kidsAlloc.reduce((sum, a) => sum + a.costUsd, 0);
    expect(within(body[2]).getByText(new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(spent))).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Kids totals' })).toHaveTextContent('Left over');
  });
});

describe('UndoModal', () => {
  it('warns when a category owns less than all the parts of one stock the purchase gave it', () => {
    const data = sample();
    const kids = { ...data.categories[1], holdings: { VOO: 1.1159, BND: 5 } };
    const tx: AppData['transactions'][number] = {
      id: 't',
      date: '2026-10-29T10:00:00.000Z',
      usdIls: 3.7,
      fxFeePercent: 0,
      orders: [
        { ticker: 'VOO', shares: 1, priceUsd: 575.3 },
        { ticker: 'VOO', shares: 1, priceUsd: 574.3 },
      ],
      allocations: [
        { categoryId: 'sample-kids', ticker: 'VOO', shares: 0.2319, costUsd: 133.41, priceUsd: 575.3 },
        { categoryId: 'sample-pension', ticker: 'VOO', shares: 0.7681, costUsd: 441.89, priceUsd: 575.3 },
        { categoryId: 'sample-kids', ticker: 'VOO', shares: 1, costUsd: 574.3, priceUsd: 574.3 },
      ],
      cash: [],
    };
    render(<UndoModal tx={tx} categories={[data.categories[0], kids]} onClose={() => {}} onConfirm={() => {}} />);
    expect(screen.getByText('Kids: VOO (has 1.1159, the purchase added 1.2319)')).toBeInTheDocument();
  });
});
