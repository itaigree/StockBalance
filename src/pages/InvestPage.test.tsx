import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { planPurchase } from '../engine';
import { priceMap } from '../state/AppState';
import { renderApp, sample, savedData } from '../test-utils';

const orderRows = () =>
  within(screen.getByRole('region', { name: 'Orders to place' }))
    .getAllByRole('row')
    .slice(1, -1)
    .filter((r) => !r.classList.contains('excluded-row'))
    .map((r) => within(r).getAllByRole('cell').slice(1, 3).map((c) => c.textContent).join(' '));

describe('InvestPage', () => {
  it('splits the money and lists one order per stock', async () => {
    const data = sample();
    const { user } = renderApp('invest', data);
    await user.type(screen.getByLabelText('Amount to invest in ILS'), '10000');

    expect(screen.getByLabelText('New money for Pension')).toHaveValue('6,300');
    expect(screen.getByLabelText('New money for Kids')).toHaveValue('1,000');
    expect(screen.getByLabelText('New money for Investments')).toHaveValue('2,700');

    // Same inputs as the page: rules split + Kids' ₪250 carried-over cash.
    const expected = planPurchase({
      categories: data.categories,
      prices: priceMap(data.prices),
      usdIls: 3.7,
      fxFeePercent: 0,
      budgetsIls: { 'sample-pension': 6300, 'sample-kids': 1250, 'sample-investments': 2700 },
      options: { wholeShares: true, minOrderUsd: 0, maxTickers: null },
    });
    expect(expected.orders.length).toBeGreaterThan(0);
    const orders = screen.getByRole('region', { name: 'Orders to place' });
    const rows = within(orders).getAllByRole('row').slice(1, -1);
    expect(rows.map((r) => within(r).getAllByRole('cell')[1].textContent)).toEqual(expected.orders.map((o) => o.ticker));
    rows.forEach((r, i) => expect(within(r).getAllByRole('cell')[2].textContent).toBe(String(expected.orders[i].shares)));
    expect(screen.getByText(`${expected.orders.length} order${expected.orders.length === 1 ? '' : 's'}`)).toBeInTheDocument();
  });

  it('lets the user change one category amount and reset to the rules', async () => {
    const { user } = renderApp('invest', sample());
    await user.type(screen.getByLabelText('Amount to invest in ILS'), '10000');
    const kids = screen.getByLabelText('New money for Kids');
    await user.clear(kids);
    await user.type(kids, '2000');
    expect(screen.getByText('edited')).toBeInTheDocument();
    expect(screen.getByText(/more than the ₪10,000.00 you entered/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reset to rules' }));
    expect(screen.getByLabelText('New money for Kids')).toHaveValue('1,000');
    expect(screen.queryByText('edited')).not.toBeInTheDocument();
  });

  it('records the purchase into holdings, cash and the purchase list, and can undo it', async () => {
    const data = sample();
    const { user } = renderApp('invest', data);
    await user.type(screen.getByLabelText('Amount to invest in ILS'), '10000');
    await user.click(screen.getByRole('button', { name: 'I made a purchase' }));
    const dialog = screen.getByRole('dialog', { name: 'Record the purchase' });
    await user.click(within(dialog).getByRole('button', { name: 'Record purchase' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText(/Purchase recorded/)).toBeInTheDocument();
    await waitFor(() => expect(savedData().transactions).toHaveLength(1));
    const saved = savedData();
    const tx = saved.transactions[0];
    // Every executed share went to some category.
    for (const o of tx.orders) {
      const before = data.categories.reduce((s, c) => s + (c.holdings[o.ticker] ?? 0), 0);
      const after = saved.categories.reduce((s, c) => s + (c.holdings[o.ticker] ?? 0), 0);
      expect(after - before).toBeCloseTo(o.shares, 6);
    }
    // Cash: before + new money − spent.
    const kids = saved.categories.find((c) => c.id === 'sample-kids')!;
    const kidsCash = tx.cash.find((c) => c.categoryId === 'sample-kids')!;
    expect(kidsCash.newMoneyIls).toBe(1000);
    expect(kids.cashIls).toBeCloseTo(250 + 1000 - kidsCash.spentIls, 4);
    expect(screen.getByLabelText('Amount to invest in ILS')).toHaveValue('');

    // A mistake can be undone right away.
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    await user.click(screen.getByRole('button', { name: 'Undo purchase' }));
    expect(screen.queryByText(/Purchase recorded/)).not.toBeInTheDocument();
    await waitFor(() => expect(savedData().transactions).toHaveLength(0));
    expect(savedData().categories.find((c) => c.id === 'sample-kids')!.cashIls).toBeCloseTo(250, 6);
  });

  it('buys fewer different stocks with "Fewest orders", and can make it the default', async () => {
    const { user } = renderApp('invest', sample());
    await user.type(screen.getByLabelText('Amount to invest in ILS'), '20000');
    const balanced = orderRows();
    await user.click(screen.getByText('Options'));
    await user.click(screen.getByRole('radio', { name: /Fewest orders/ }));
    const fewest = orderRows();
    expect(balanced).toHaveLength(5);
    expect(fewest).toHaveLength(4);
    expect(screen.getByText(/^Fewest orders · whole shares/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save these options as the default' }));
    await waitFor(() => expect(savedData().settings.buyStrategy).toBe('fewest'));
  });

  it('asks for missing prices before calculating', async () => {
    const data = sample();
    delete data.prices.GLD;
    const { user } = renderApp('invest', data);
    await user.type(screen.getByLabelText('Amount to invest in ILS'), '10000');
    expect(screen.getByText('Some prices are missing.')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Orders to place' })).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('Price of GLD in USD'), '300');
    await user.click(screen.getByRole('button', { name: 'Use this price' }));
    expect(screen.queryByText('Some prices are missing.')).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Orders to place' })).toBeInTheDocument();
  });

  it('asks for the exchange rate when there is none', async () => {
    const data = { ...sample(), fx: null };
    const { user } = renderApp('invest', data);
    await user.type(screen.getByLabelText('Amount to invest in ILS'), '5000');
    expect(screen.getByText('The USD/ILS exchange rate is missing.')).toBeInTheDocument();
    await user.type(screen.getByLabelText('USD/ILS rate'), '3.6');
    await user.click(screen.getByRole('button', { name: 'Use this rate' }));
    expect(screen.getByRole('region', { name: 'Orders to place' })).toBeInTheDocument();
  });

  it('applies the limit on different stocks', async () => {
    const { user } = renderApp('invest', sample());
    await user.type(screen.getByLabelText('Amount to invest in ILS'), '50000');
    await user.click(screen.getByText('Options'));
    await user.type(screen.getByLabelText(/Max different stocks/), '1');
    const orders = screen.getByRole('region', { name: 'Orders to place' });
    expect(within(orders).getAllByRole('row')).toHaveLength(3); // header, one order, total
  });

  it('keeps the money as cash when nothing can be bought', async () => {
    const data = sample();
    data.categories = [{ ...data.categories[0], targets: [{ ticker: 'VOO', percent: 100 }], holdings: {}, contribution: { kind: 'remainder' } }];
    const { user } = renderApp('invest', data);
    await user.type(screen.getByLabelText('Amount to invest in ILS'), '1000'); // $270 < one VOO share
    await user.click(screen.getByRole('button', { name: 'Keep the money as cash for next time' }));
    expect(screen.getByText(/added to each category's cash/)).toBeInTheDocument();
    await waitFor(() => expect(savedData().categories[0].cashIls).toBe(1000));
    expect(savedData().transactions[0]).toMatchObject({ orders: [], allocations: [] });
    // Next time the cash is part of the budget.
    await user.type(screen.getByLabelText('Amount to invest in ILS'), '1500');
    expect(screen.getByText('₪2,500.00', { selector: 'strong' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Orders to place' })).toBeInTheDocument();
  });

  it('shows and records the plan that was made before a reload, even if prices changed', async () => {
    const first = renderApp('invest', sample());
    await first.user.type(screen.getByLabelText('Amount to invest in ILS'), '5500');
    const planned = orderRows();
    first.unmount();

    // Prices moved since (e.g. refreshed at start-up).
    const later = sample();
    later.prices.VOO = { ...later.prices.VOO, priceUsd: 600 };
    later.prices.BND = { ...later.prices.BND, priceUsd: 70 };
    const { user } = renderApp('invest', later);
    expect(screen.getByText(/This is the plan you made/)).toBeInTheDocument();
    expect(screen.getByLabelText('Amount to invest in ILS')).toHaveValue('5,500');
    expect(orderRows()).toEqual(planned);

    await user.click(screen.getByRole('button', { name: 'I made a purchase' }));
    const dialog = screen.getByRole('dialog');
    for (const row of planned) expect(within(dialog).getByText(row.split(' ')[0])).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: "Recalculate with today's prices" }));
    expect(screen.queryByText(/This is the plan you made/)).not.toBeInTheDocument();
  });

  it('subtracts an earlier overspend from the budget', async () => {
    const data = sample();
    data.categories[0].cashIls = -300;
    data.categories[1].cashIls = 300;
    const { user } = renderApp('invest', data);
    await user.type(screen.getByLabelText('Amount to invest in ILS'), '10000');
    const split = screen.getByRole('region', { name: 'Split between categories' });
    const totalRow = within(split).getAllByRole('row').at(-1)!;
    expect(within(totalRow).getAllByRole('cell').at(-1)!.textContent).toBe('₪10,000.00');
  });

  it('gives one category all the rest of the total', async () => {
    const data = sample();
    // Like imported categories: no default rule, amounts are typed in.
    data.categories = data.categories.map((c) => ({ ...c, contribution: { kind: 'none' as const }, cashIls: 0 }));
    const { user } = renderApp('invest', data);
    await user.type(screen.getByLabelText('Amount to invest in ILS'), '10000');
    await user.type(screen.getByLabelText('New money for Pension'), '1000');
    await user.click(screen.getByRole('button', { name: 'All the rest to Investments' }));
    expect(screen.getByLabelText('New money for Investments')).toHaveTextContent('₪9,000.00');
    // Changing another amount updates the rest.
    await user.type(screen.getByLabelText('New money for Kids'), '1000');
    expect(screen.getByLabelText('New money for Investments')).toHaveTextContent('₪8,000.00');
    expect(screen.queryByText(/isn't assigned/)).not.toBeInTheDocument();
    // Turning it off keeps the amount as a typed one.
    await user.click(screen.getByRole('button', { name: 'All the rest to Investments' }));
    expect(screen.getByLabelText('New money for Investments')).toHaveValue('8,000');
  });

  it('lets the user skip a stock so its money goes to the others', async () => {
    const { user } = renderApp('invest', sample());
    await user.type(screen.getByLabelText('Amount to invest in ILS'), '10000');
    const before = orderRows();
    const skip = before[0].split(' ')[0];
    await user.click(screen.getByRole('checkbox', { name: `Buy ${skip}` }));
    expect(orderRows().some((r) => r.startsWith(`${skip} `))).toBe(false);
    expect(screen.getByText(/Skipped this time/)).toBeInTheDocument();
    // The rest of the money is still invested (no category is left with its budget as cash).
    expect(screen.getByRole('checkbox', { name: `Buy ${skip}` })).not.toBeChecked();
    await user.click(screen.getByRole('checkbox', { name: `Buy ${skip}` }));
    expect(orderRows()).toEqual(before);
  });

  it('records something different from the recommendation, including an added stock', async () => {
    const { user } = renderApp('invest', sample());
    await user.type(screen.getByLabelText('Amount to invest in ILS'), '10000');
    await user.click(screen.getByRole('button', { name: 'I made a purchase' }));
    const dialog = screen.getByRole('dialog', { name: 'Record the purchase' });
    await user.click(within(dialog).getByLabelText('I bought something different'));
    for (const input of within(dialog).getAllByLabelText(/^Shares of .* bought$/)) {
      await user.clear(input);
      await user.type(input, '0');
    }
    await user.click(within(dialog).getByRole('button', { name: '+ Add a stock I bought instead' }));
    await user.type(within(dialog).getByLabelText('Added stock 1'), 'amzn');
    await user.selectOptions(within(dialog).getByLabelText('Category for added stock 1'), 'sample-kids');
    await user.type(within(dialog).getByLabelText('Shares of added stock 1'), '2');
    expect(within(dialog).getByText('Enter the price paid.')).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText('Price of added stock 1'), '200');
    await user.click(within(dialog).getByRole('button', { name: 'Record purchase' }));

    await waitFor(() => expect(savedData().transactions).toHaveLength(1));
    const tx = savedData().transactions[0];
    expect(tx.orders).toEqual([{ ticker: 'AMZN', shares: 2, priceUsd: 200 }]);
    expect(tx.allocations).toEqual([{ categoryId: 'sample-kids', ticker: 'AMZN', shares: 2, costUsd: 400 }]);
    expect(savedData().categories.find((c) => c.id === 'sample-kids')!.holdings.AMZN).toBe(2);
  });
});

