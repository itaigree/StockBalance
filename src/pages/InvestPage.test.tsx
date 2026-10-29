import { act, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { planPurchase } from '../engine';
import { priceMap } from '../state/AppState';
import { renderApp, sample, saveFromOtherCopy, savedData } from '../test-utils';

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

  it('does not bring back a saved plan once the categories changed', async () => {
    const first = renderApp('invest', sample());
    await first.user.type(screen.getByLabelText('Amount to invest in ILS'), '10000');
    first.unmount();

    // Kids now gets ₪3,000 first.
    const edited = sample();
    edited.categories[1] = { ...edited.categories[1], contribution: { kind: 'fixed', amountIls: 3000 } };
    const second = renderApp('invest', edited);
    expect(screen.queryByText(/This is the plan you made/)).not.toBeInTheDocument();
    expect(screen.getByLabelText('Amount to invest in ILS')).toHaveValue('10,000');
    expect(screen.getByLabelText('New money for Kids')).toHaveValue('3,000');
    await second.user.click(screen.getByRole('button', { name: 'I made a purchase' }));
    await second.user.click(screen.getByRole('button', { name: 'Record purchase' }));
    await waitFor(() => expect(savedData().transactions).toHaveLength(1));
    expect(savedData().transactions[0].cash.find((c) => c.categoryId === 'sample-kids')!.newMoneyIls).toBe(3000);
    second.unmount();

    // A deleted category: the plan is made again for the categories there are.
    const third = renderApp('invest', sample());
    await third.user.type(screen.getByLabelText('Amount to invest in ILS'), '10000');
    third.unmount();
    const withoutKids = sample();
    withoutKids.categories = withoutKids.categories.filter((c) => c.id !== 'sample-kids');
    renderApp('invest', withoutKids);
    expect(screen.queryByText(/This is the plan you made/)).not.toBeInTheDocument();
    expect(screen.queryByText('(deleted category)')).not.toBeInTheDocument();
  });

  it('saves the plan again when the exchange rate changes', async () => {
    // One category, so a small rate change leaves every share (and how it is split) the same.
    const data = sample();
    data.categories = [{ ...data.categories[1], contribution: { kind: 'remainder' } }];
    const first = renderApp('invest', data);
    await first.user.type(screen.getByLabelText('Amount to invest in ILS'), '10000');
    await first.user.click(screen.getByRole('button', { name: 'edit' }));
    const rate = screen.getByLabelText('USD/ILS rate');
    await first.user.clear(rate);
    // A small change that buys the same whole shares, only at a different cost in shekels.
    const orders = orderRows();
    await first.user.type(rate, '3.69');
    await first.user.click(screen.getByRole('button', { name: 'Save' }));
    expect(orderRows()).toEqual(orders);
    await waitFor(() => expect(JSON.parse(window.localStorage.getItem('stockbalance:invest-draft')!).saved.usdIls).toBe(3.69));
  });

  it('treats an empty fee as no fee and explains invalid amounts and options', async () => {
    const { user } = renderApp('invest', sample());
    await user.type(screen.getByLabelText('Amount to invest in ILS'), '10000');
    await user.click(screen.getByText('Options'));
    await user.clear(screen.getByLabelText(/^Currency conversion fee/));
    expect(screen.getByRole('region', { name: 'Orders to place' })).toBeInTheDocument();

    await user.clear(screen.getByLabelText(/^Minimum order/));
    await user.type(screen.getByLabelText(/^Minimum order/), '-5');
    expect(screen.queryByRole('region', { name: 'Orders to place' })).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(/Check the Options/);
    expect(screen.getByText('0 or more (or empty).')).toBeInTheDocument();
    await user.clear(screen.getByLabelText(/^Minimum order/));

    // A negative amount for a category isn't planned or recorded.
    const kids = screen.getByLabelText('New money for Kids');
    await user.clear(kids);
    await user.type(kids, '-500');
    expect(screen.queryByRole('region', { name: 'Orders to place' })).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(/below 0/);
    expect(screen.queryByRole('button', { name: 'I made a purchase' })).not.toBeInTheDocument();
  });

  it('keeps a typed rate as typed, even after emptying the field', async () => {
    const { user } = renderApp('invest', sample());
    await user.type(screen.getByLabelText('Amount to invest in ILS'), '10000');
    await user.click(screen.getByText('Options'));
    const rate = screen.getByLabelText(/^USD\/ILS rate for this purchase/);
    // Deleting one character at a time: 3.7 → 3. → 3 → empty (which means "the latest rate").
    await user.type(rate, '{Backspace}{Backspace}{Backspace}');
    expect(rate).toHaveValue('');
    await user.type(rate, '3.65');
    expect(rate).toHaveValue('3.65');
    expect(screen.getByText(/rate 3\.6500/)).toBeInTheDocument();
  });

  it('shows fractional orders with every decimal that is recorded', async () => {
    const data = sample();
    data.settings.wholeShares = false;
    const { user } = renderApp('invest', data);
    await user.type(screen.getByLabelText('Amount to invest in ILS'), '10000');
    const shown = Object.fromEntries(orderRows().map((r) => [r.split(' ')[0], r.split(' ')[1]]));
    await user.click(screen.getByRole('button', { name: 'I made a purchase' }));
    await user.click(screen.getByRole('button', { name: 'Record purchase' }));
    await waitFor(() => expect(savedData().transactions).toHaveLength(1));
    for (const o of savedData().transactions[0].orders) expect(Number(shown[o.ticker].replace(/,/g, ''))).toBe(o.shares);
  });

  it('starts over when a purchase is recorded in another tab', async () => {
    const { user } = renderApp('invest', sample());
    await user.type(screen.getByLabelText('Amount to invest in ILS'), '10000');
    expect(window.localStorage.getItem('stockbalance:invest-draft')).not.toBeNull();

    // The other tab recorded the purchase.
    const after = sample();
    after.transactions = [{ id: 'elsewhere', date: '2026-10-29T10:00:00.000Z', usdIls: 3.7, fxFeePercent: 0, orders: [], allocations: [], cash: [] }];
    after.categories = after.categories.map((c) => ({ ...c, cashIls: c.cashIls + 1 }));
    act(() => {
      window.localStorage.setItem('stockbalance:data', JSON.stringify(after));
      window.dispatchEvent(new StorageEvent('storage', { key: 'stockbalance:data', newValue: JSON.stringify(after) }));
    });
    expect(screen.getByLabelText('Amount to invest in ILS')).toHaveValue('');
    await waitFor(() => expect(window.localStorage.getItem('stockbalance:invest-draft')).toBeNull());
  });

  it('forgets the saved plan when the amount is cleared, even while another amount is invalid', async () => {
    const first = renderApp('invest', sample());
    await first.user.type(screen.getByLabelText('Amount to invest in ILS'), '10000');
    const kids = screen.getByLabelText('New money for Kids');
    await first.user.clear(kids);
    await first.user.type(kids, '-500');
    await first.user.clear(screen.getByLabelText('Amount to invest in ILS'));
    first.unmount();
    renderApp('invest', sample());
    expect(screen.queryByText(/This is the plan you made/)).not.toBeInTheDocument();
    expect(screen.getByLabelText('Amount to invest in ILS')).toHaveValue('');
  });

  it('still restores a plan saved by the previous version of the app', async () => {
    const first = renderApp('invest', sample());
    await first.user.type(screen.getByLabelText('Amount to invest in ILS'), '5500');
    const planned = orderRows();
    first.unmount();
    const draft = JSON.parse(window.localStorage.getItem('stockbalance:invest-draft')!);
    delete draft.saved.categoriesKey;
    delete draft.saved.lastTxId;
    window.localStorage.setItem('stockbalance:invest-draft', JSON.stringify(draft));

    const later = sample();
    later.prices.VOO = { ...later.prices.VOO, priceUsd: 600 };
    renderApp('invest', later);
    expect(screen.getByText(/This is the plan you made/)).toBeInTheDocument();
    expect(orderRows()).toEqual(planned);
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
    expect(tx.allocations).toEqual([{ categoryId: 'sample-kids', ticker: 'AMZN', shares: 2, costUsd: 400, priceUsd: 200 }]);
    expect(savedData().categories.find((c) => c.id === 'sample-kids')!.holdings.AMZN).toBe(2);
  });

  describe('while another copy of the app changes things', () => {
    /** A purchase recorded in the other copy. */
    const elsewhere = () => ({
      id: 'elsewhere',
      date: '2026-10-29T10:00:00.000Z',
      usdIls: 3.7,
      fxFeePercent: 0,
      orders: [],
      allocations: [],
      cash: [],
    });
    it('records the plan the user confirmed, even if prices change while the dialog is open', async () => {
      const data = sample();
      const { user } = renderApp('invest', data);
      await user.type(screen.getByLabelText('Amount to invest in ILS'), '10000');
      const planned = orderRows();
      await user.click(screen.getByRole('button', { name: 'I made a purchase' }));
      const newer = sample();
      for (const t of Object.keys(newer.prices)) newer.prices[t] = { ...newer.prices[t], priceUsd: newer.prices[t].priceUsd * 0.6 };
      saveFromOtherCopy(newer);
      const dialog = screen.getByRole('dialog', { name: 'Record the purchase' });
      await user.click(within(dialog).getByRole('button', { name: 'Record purchase' }));
      await waitFor(() => expect(savedData().transactions).toHaveLength(1));
      expect(savedData().transactions[0].orders.map((o) => `${o.ticker} ${o.shares}`)).toEqual(planned);
    });

    it('closes the record dialog for good when the other copy records a purchase', async () => {
      const { user } = renderApp('invest', sample());
      await user.type(screen.getByLabelText('Amount to invest in ILS'), '10000');
      await user.click(screen.getByRole('button', { name: 'I made a purchase' }));
      const after = sample();
      after.transactions = [elsewhere()];
      saveFromOtherCopy(after);
      expect(screen.queryByRole('dialog', { name: 'Record the purchase' })).not.toBeInTheDocument();
      await user.type(screen.getByLabelText('Amount to invest in ILS'), '500');
      expect(screen.queryByRole('dialog', { name: 'Record the purchase' })).not.toBeInTheDocument();
    });

    it('hides the banner\'s Undo once another purchase is the newest, so it never undoes that one', async () => {
      const { user } = renderApp('invest', sample());
      await user.type(screen.getByLabelText('Amount to invest in ILS'), '10000');
      await user.click(screen.getByRole('button', { name: 'I made a purchase' }));
      await user.click(screen.getByRole('button', { name: 'Record purchase' }));
      expect(screen.getByText(/Purchase recorded/)).toBeInTheDocument();
      await waitFor(() => expect(savedData().transactions).toHaveLength(1));
      const after = savedData();
      after.transactions.push(elsewhere());
      saveFromOtherCopy(after);
      expect(screen.queryByText(/Purchase recorded/)).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument();
    });
  });

  it('does not plan with a number it cannot read, and keeps it as typed', async () => {
    const { user } = renderApp('invest', sample());
    await user.type(screen.getByLabelText('Amount to invest in ILS'), '10000');
    expect(screen.getByRole('button', { name: 'I made a purchase' })).toBeInTheDocument();
    const fee = screen.getByLabelText(/^Currency conversion fee/);
    await user.clear(fee);
    await user.type(fee, '0,5');
    expect(screen.getByRole('alert')).toHaveTextContent(/Some numbers can't be read/);
    expect(screen.queryByRole('button', { name: 'I made a purchase' })).not.toBeInTheDocument();
    await user.clear(fee);
    await user.type(fee, '0.5');
    expect(screen.getByRole('button', { name: 'I made a purchase' })).toBeInTheDocument();

    const kids = screen.getByLabelText('New money for Kids');
    await user.clear(kids);
    await user.type(kids, '1000..');
    expect(screen.queryByRole('button', { name: 'I made a purchase' })).not.toBeInTheDocument();
    // Giving Kids "the rest" hides its field, so its text no longer counts.
    await user.click(screen.getByRole('button', { name: 'All the rest to Kids' }));
    expect(screen.getByRole('button', { name: 'I made a purchase' })).toBeInTheDocument();

    const rate = screen.getByLabelText(/^USD\/ILS rate for this purchase/);
    await user.clear(rate);
    await user.type(rate, '3,65');
    await user.tab();
    expect(rate).toHaveValue('3,65');
    expect(screen.queryByRole('button', { name: 'I made a purchase' })).not.toBeInTheDocument();
  });

  it('invests the cash left from earlier purchases when 0 new money is entered', async () => {
    const data = sample();
    data.categories[1] = { ...data.categories[1], cashIls: 5000 };
    const { user } = renderApp('invest', data);
    expect(screen.getByText('Enter an amount to see what to buy.')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Amount to invest in ILS'), '0');
    expect(screen.getByRole('region', { name: 'Orders to place' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'I made a purchase' }));
    await user.click(screen.getByRole('button', { name: 'Record purchase' }));
    await waitFor(() => expect(savedData().transactions).toHaveLength(1));
    const kids = savedData().transactions[0].cash.find((c) => c.categoryId === 'sample-kids')!;
    expect(kids.newMoneyIls).toBe(0);
    expect(kids.spentIls).toBeGreaterThan(0);
  });
});
