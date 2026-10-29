import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderApp, sample, savedData } from '../test-utils';

describe('CategoriesPage', () => {
  it('creates a category with targets and holdings', async () => {
    const { user } = renderApp('categories');
    await user.click(screen.getByRole('button', { name: 'Add your first category' }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText('Name'), 'Kids');
    await user.type(within(dialog).getByLabelText('Ticker, row 1'), 'vti');
    await user.type(within(dialog).getByLabelText('Target percent, row 1'), '70');
    await user.type(within(dialog).getByLabelText('Shares owned, row 1'), '2.5');
    await user.click(within(dialog).getByRole('button', { name: '+ Add stock' }));
    await user.type(within(dialog).getByLabelText('Ticker, row 2'), 'BND');
    await user.type(within(dialog).getByLabelText('Target percent, row 2'), '30');
    await user.click(within(dialog).getByRole('button', { name: 'Save category' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Kids' })).toBeInTheDocument();
    await waitFor(() =>
      expect(savedData().categories[0]).toMatchObject({
        name: 'Kids',
        targets: [
          { ticker: 'VTI', percent: 70 },
          { ticker: 'BND', percent: 30 },
        ],
        holdings: { VTI: 2.5 },
        contribution: { kind: 'remainder' },
      }),
    );
  });

  it('requires targets to add up to 100% and can scale them', async () => {
    const { user } = renderApp('categories', sample());
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    const dialog = screen.getByRole('dialog');
    const first = within(dialog).getByLabelText('Target percent, row 1');
    await user.clear(first);
    await user.type(first, '50');
    expect(within(dialog).getByText('Targets add up to 90%')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Save category' }));
    expect(within(dialog).getByText('Please fix the highlighted fields.')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Scale to 100%' }));
    expect(within(dialog).getByText('Targets add up to 100%')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Save category' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => {
      const targets = savedData().categories[0].targets;
      expect(targets.reduce((s, t) => s + t.percent, 0)).toBeCloseTo(100, 6);
      expect(targets[0].percent).toBeCloseTo(55.56, 2);
    });
  });

  it('rejects duplicate tickers and duplicate names', async () => {
    const { user } = renderApp('categories', sample());
    await user.click(screen.getByRole('button', { name: 'Add category' }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText('Name'), 'pension');
    await user.type(within(dialog).getByLabelText('Ticker, row 1'), 'VOO');
    await user.click(within(dialog).getByRole('button', { name: '+ Add stock' }));
    await user.type(within(dialog).getByLabelText('Ticker, row 2'), 'VOO');
    await user.click(within(dialog).getByRole('button', { name: 'Save category' }));
    expect(within(dialog).getByText('Another category already has this name.')).toBeInTheDocument();
    expect(within(dialog).getByText('VOO is listed twice.')).toBeInTheDocument();
  });

  it('deletes a category after confirmation', async () => {
    const { user } = renderApp('categories', sample());
    await user.click(screen.getAllByRole('button', { name: 'Delete' })[1]);
    expect(screen.getByRole('dialog', { name: 'Delete Kids?' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Delete category' }));
    expect(screen.queryByRole('heading', { name: 'Kids' })).not.toBeInTheDocument();
    await waitFor(() => expect(savedData().categories.map((c) => c.name)).toEqual(['Pension', 'Investments']));
  });

  it('previews how money is split', () => {
    renderApp('categories', sample());
    const preview = screen.getByRole('region', { name: 'How money is split' });
    // ₪10,000: Kids ₪1,000 fixed, Pension 70% of ₪9,000, Investments the rest.
    expect(within(preview).getByText('₪6,300.00')).toBeInTheDocument();
    expect(within(preview).getByText('₪1,000.00')).toBeInTheDocument();
    expect(within(preview).getByText('₪2,700.00')).toBeInTheDocument();
  });

  it('merges two categories', async () => {
    const { user } = renderApp('categories', sample());
    await user.click(screen.getAllByRole('button', { name: 'Merge' })[1]); // Kids
    const dialog = screen.getByRole('dialog', { name: 'Merge Kids' });
    await user.selectOptions(within(dialog).getByLabelText('Merge with'), 'sample-pension');
    await user.click(within(dialog).getByLabelText('Pension'));
    expect(within(dialog).getByLabelText('Name of the merged category')).toHaveValue('Pension');
    expect(within(dialog).getByText(/will own/)).toHaveTextContent('43.5 VOO');
    await user.click(within(dialog).getByRole('button', { name: 'Merge' }));
    expect(screen.getByText(/were merged into Pension/)).toBeInTheDocument();
    await waitFor(() => {
      const cats = savedData().categories;
      expect(cats.map((c) => c.name)).toEqual(['Pension', 'Investments']);
      expect(cats[0].holdings).toEqual({ VOO: 43.5, VXUS: 150, BND: 65 });
      expect(cats[0].cashIls).toBe(250);
      expect(cats[0].targets).toEqual(sample().categories[0].targets);
    });
  });

  it('keeps the clicked category when "Merge with" changes after choosing to keep the other', async () => {
    const { user } = renderApp('categories', sample());
    await user.click(screen.getAllByRole('button', { name: 'Merge' })[1]); // Kids
    const dialog = screen.getByRole('dialog', { name: 'Merge Kids' });
    await user.selectOptions(within(dialog).getByLabelText('Merge with'), 'sample-pension');
    await user.click(within(dialog).getByRole('radio', { name: /Pension/ }));
    await user.selectOptions(within(dialog).getByLabelText('Merge with'), 'sample-investments');
    expect(within(dialog).getByRole('radio', { name: /Kids/ })).toBeChecked();
    expect(within(dialog).getByLabelText('Name of the merged category')).toHaveValue('Kids');
    await user.click(within(dialog).getByRole('button', { name: 'Merge' }));
    await waitFor(() => expect(savedData().categories.map((c) => c.id)).toEqual(['sample-pension', 'sample-kids']));
    expect(savedData().categories[1].contribution).toEqual({ kind: 'fixed', amountIls: 1000 });
  });

  it('moves everything at 100% even with shares that have more than 6 decimals', async () => {
    const data = sample();
    data.categories[0] = { ...data.categories[0], holdings: { VOO: 1.2345678, VXUS: 10 } };
    const { user } = renderApp('categories', data);
    await user.click(screen.getAllByRole('button', { name: 'Split' })[0]);
    const dialog = screen.getByRole('dialog', { name: 'Split Pension' });
    await user.type(within(dialog).getByLabelText('Name of the new category'), 'P2');
    const percent = within(dialog).getByRole('textbox', { name: /percent/i });
    await user.clear(percent);
    await user.type(percent, '100');
    await user.click(within(dialog).getByRole('button', { name: 'Move this % of everything' }));
    expect(within(dialog).queryByText(/to move\./)).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Split' }));
    await waitFor(() => expect(savedData().categories[1].holdings).toEqual({ VOO: 1.2345678, VXUS: 10 }));
    expect(savedData().categories[0].holdings).toEqual({});
  });

  it('refuses to save numbers it cannot read instead of dropping them', async () => {
    const { user } = renderApp('categories', sample());
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[2]); // Investments
    const dialog = screen.getByRole('dialog');
    const aapl = within(dialog).getByLabelText('Shares owned, row 4');
    await user.clear(aapl);
    await user.type(aapl, '5.5.');
    await user.click(within(dialog).getByRole('button', { name: 'Save category' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(within(dialog).getByText('Enter numbers only (e.g. 2.5), or leave it empty.')).toBeInTheDocument();
    await user.clear(aapl);
    await user.type(aapl, '5.5');
    await user.click(within(dialog).getByRole('button', { name: 'Save category' }));
    await waitFor(() => expect(savedData().categories[2].holdings.AAPL).toBe(5.5));
  });

  it('splits part of a category into a new one', async () => {
    const { user } = renderApp('categories', sample());
    await user.click(screen.getAllByRole('button', { name: 'Split' })[0]); // Pension
    const dialog = screen.getByRole('dialog', { name: 'Split Pension' });
    const split = within(dialog).getByRole('button', { name: 'Split' });
    expect(split).toBeDisabled();
    await user.type(within(dialog).getByLabelText('Name of the new category'), 'Pension 2');
    await user.click(within(dialog).getByRole('button', { name: 'Move this % of everything' }));
    expect(within(dialog).getByLabelText('Shares of VOO to move')).toHaveValue('20');
    await user.clear(within(dialog).getByLabelText('Shares of BND to move'));
    await user.type(within(dialog).getByLabelText('Shares of BND to move'), '100');
    expect(within(dialog).getByText('Only 60 to move.')).toBeInTheDocument();
    expect(split).toBeDisabled();
    await user.clear(within(dialog).getByLabelText('Shares of BND to move'));
    await user.type(within(dialog).getByLabelText('Shares of BND to move'), '10');
    await user.click(split);
    await waitFor(() => {
      const cats = savedData().categories;
      expect(cats.map((c) => c.name)).toEqual(['Pension', 'Pension 2', 'Kids', 'Investments']);
      expect(cats[0].holdings).toEqual({ VOO: 20, VXUS: 75, BND: 50 });
      expect(cats[1].holdings).toEqual({ VOO: 20, VXUS: 75, BND: 10 });
      expect(cats[1].targets).toEqual(cats[0].targets);
      expect(cats[1].contribution).toEqual({ kind: 'none' });
    });
  });

  it('creates a group of stocks that share one target equally', async () => {
    const { user } = renderApp('categories');
    await user.click(screen.getByRole('button', { name: 'Add your first category' }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText('Name'), 'Investments');
    await user.type(within(dialog).getByLabelText('Ticker, row 1'), 'VOO');
    await user.type(within(dialog).getByLabelText('Target percent, row 1'), '80');
    await user.click(within(dialog).getByRole('button', { name: '+ Add group' }));
    await user.type(within(dialog).getByLabelText('Group name, group 1'), 'Corporates');
    await user.type(within(dialog).getByLabelText('Group target percent, group 1'), '20');
    await user.type(within(dialog).getByLabelText('Ticker, row 2'), 'AMZN');
    await user.type(within(dialog).getByLabelText('Shares owned, row 2'), '3');
    await user.click(within(dialog).getByRole('button', { name: '+ Add stock to Corporates' }));
    await user.type(within(dialog).getByLabelText('Ticker, row 3'), 'TSLA');
    expect(within(dialog).getByText('10% each')).toBeInTheDocument();
    expect(within(dialog).getByText('Targets add up to 100%')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Save category' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('Corporates')).toBeInTheDocument();
    expect(screen.getByText('(AMZN, TSLA)')).toBeInTheDocument();
    await waitFor(() =>
      expect(savedData().categories[0]).toMatchObject({
        targets: [
          { ticker: 'VOO', percent: 80 },
          { ticker: 'AMZN', percent: 10, group: 'Corporates' },
          { ticker: 'TSLA', percent: 10, group: 'Corporates' },
        ],
        holdings: { AMZN: 3 },
      }),
    );

    // Editing again shows the group with its total.
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const again = screen.getByRole('dialog');
    expect(within(again).getByLabelText('Group name, group 1')).toHaveValue('Corporates');
    expect(within(again).getByLabelText('Group target percent, group 1')).toHaveValue('20');
  });

  it('moves a stock into and out of a group, taking its target with it', async () => {
    const data = sample();
    data.categories[0] = {
      ...data.categories[0],
      targets: [
        { ticker: 'VOO', percent: 70 },
        { ticker: 'NVDA', percent: 10 },
        { ticker: 'AMZN', percent: 10, group: 'Corp' },
        { ticker: 'TSLA', percent: 10, group: 'Corp' },
      ],
      holdings: { VOO: 40 },
    };
    const { user } = renderApp('categories', data);
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    const dialog = screen.getByRole('dialog');
    const groupTarget = within(dialog).getByLabelText('Group target percent, group 1');

    // NVDA (10%) joins Corp: the group grows to 30%, 10% each.
    await user.selectOptions(within(dialog).getByLabelText('Group, row 2'), 'Corp');
    expect(groupTarget).toHaveValue('30');
    expect(within(dialog).getByText('10% each')).toBeInTheDocument();
    expect(within(dialog).queryByLabelText('Target percent, row 2')).not.toBeInTheDocument();

    // TSLA leaves Corp with its 10%.
    await user.selectOptions(within(dialog).getByLabelText('Group, row 4'), 'No group');
    expect(groupTarget).toHaveValue('20');
    expect(within(dialog).getByLabelText('Target percent, row 4')).toHaveValue('10');
    expect(within(dialog).getByText('Targets add up to 100%')).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Save category' }));
    await waitFor(() =>
      expect(savedData().categories[0].targets).toEqual([
        { ticker: 'VOO', percent: 70 },
        { ticker: 'TSLA', percent: 10 },
        { ticker: 'NVDA', percent: 10, group: 'Corp' },
        { ticker: 'AMZN', percent: 10, group: 'Corp' },
      ]),
    );
  });

  it('keeps the total when a stock leaves a group that does not split evenly', async () => {
    const data = sample();
    data.categories[0] = {
      ...data.categories[0],
      targets: [
        { ticker: 'VOO', percent: 90 },
        ...['A', 'B', 'C'].map((ticker) => ({ ticker, percent: 10 / 3, group: 'G' })),
      ],
      holdings: {},
    };
    const { user } = renderApp('categories', data);
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    const dialog = screen.getByRole('dialog');
    await user.selectOptions(within(dialog).getByLabelText('Group, row 2'), 'No group');
    expect(within(dialog).getByLabelText('Target percent, row 2')).toHaveValue('3.33');
    expect(within(dialog).getByLabelText('Group target percent, group 1')).toHaveValue('6.67');
    expect(within(dialog).getByText('Targets add up to 100%')).toBeInTheDocument();
  });

  it('splits a group unequally, with a target for each stock', async () => {
    const { user } = renderApp('categories');
    await user.click(screen.getByRole('button', { name: 'Add your first category' }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText('Name'), 'Investments');
    await user.type(within(dialog).getByLabelText('Ticker, row 1'), 'VOO');
    await user.type(within(dialog).getByLabelText('Target percent, row 1'), '95');
    await user.click(within(dialog).getByRole('button', { name: '+ Add group' }));
    await user.type(within(dialog).getByLabelText('Group name, group 1'), 'Corporates');
    await user.type(within(dialog).getByLabelText('Group target percent, group 1'), '5');
    await user.type(within(dialog).getByLabelText('Ticker, row 2'), 'AMZN');
    await user.click(within(dialog).getByRole('button', { name: '+ Add stock to Corporates' }));
    await user.type(within(dialog).getByLabelText('Ticker, row 3'), 'TSLA');

    // Switching starts from the equal split, then each stock can be changed.
    await user.selectOptions(within(dialog).getByLabelText('How group 1 is split'), 'Own % per stock');
    expect(within(dialog).getByLabelText('Target percent, row 2')).toHaveValue('2.5');
    expect(within(dialog).getByLabelText('Target percent, row 3')).toHaveValue('2.5');
    await user.clear(within(dialog).getByLabelText('Target percent, row 2'));
    await user.type(within(dialog).getByLabelText('Target percent, row 2'), '3');
    await user.clear(within(dialog).getByLabelText('Target percent, row 3'));
    await user.type(within(dialog).getByLabelText('Target percent, row 3'), '2');
    expect(within(dialog).getByLabelText('Group target, group 1')).toHaveTextContent('5%');
    expect(within(dialog).getByText('Targets add up to 100%')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Save category' }));

    expect(screen.getByText('(AMZN 3%, TSLA 2%)')).toBeInTheDocument();
    await waitFor(() =>
      expect(savedData().categories[0].targets).toEqual([
        { ticker: 'VOO', percent: 95 },
        { ticker: 'AMZN', percent: 3, group: 'Corporates' },
        { ticker: 'TSLA', percent: 2, group: 'Corporates' },
      ]),
    );

    // Editing again keeps the per-stock targets; switching back to equal keeps the total.
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const again = screen.getByRole('dialog');
    expect(within(again).getByLabelText('How group 1 is split')).toHaveValue('own');
    expect(within(again).getByLabelText('Target percent, row 2')).toHaveValue('3');
    await user.selectOptions(within(again).getByLabelText('How group 1 is split'), 'Split equally');
    expect(within(again).getByLabelText('Group target percent, group 1')).toHaveValue('5');
    expect(within(again).getByText('2.5% each')).toBeInTheDocument();
  });

  it('needs a target for each stock of a group split unequally', async () => {
    const data = sample();
    data.categories[0] = {
      ...data.categories[0],
      targets: [
        { ticker: 'VOO', percent: 80 },
        { ticker: 'AMZN', percent: 15, group: 'Corp' },
        { ticker: 'TSLA', percent: 5, group: 'Corp' },
      ],
      holdings: {},
    };
    const { user } = renderApp('categories', data);
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    const dialog = screen.getByRole('dialog');
    await user.clear(within(dialog).getByLabelText('Target percent, row 3'));
    await user.click(within(dialog).getByRole('button', { name: 'Save category' }));
    expect(within(dialog).getByText('Set this stock’s target (above 0%).')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('moves stocks into and out of a group split unequally, keeping their own targets', async () => {
    const data = sample();
    data.categories[0] = {
      ...data.categories[0],
      targets: [
        { ticker: 'VOO', percent: 70 },
        { ticker: 'NVDA', percent: 10 },
        { ticker: 'AMZN', percent: 15, group: 'Corp' },
        { ticker: 'TSLA', percent: 5, group: 'Corp' },
      ],
      holdings: {},
    };
    const { user } = renderApp('categories', data);
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    const dialog = screen.getByRole('dialog');
    await user.selectOptions(within(dialog).getByLabelText('Group, row 2'), 'Corp');
    expect(within(dialog).getByLabelText('Target percent, row 2')).toHaveValue('10');
    expect(within(dialog).getByLabelText('Group target, group 1')).toHaveTextContent('30%');
    await user.selectOptions(within(dialog).getByLabelText('Group, row 4'), 'No group');
    expect(within(dialog).getByLabelText('Target percent, row 4')).toHaveValue('5');
    expect(within(dialog).getByLabelText('Group target, group 1')).toHaveTextContent('25%');
    expect(within(dialog).getByText('Targets add up to 100%')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Save category' }));
    await waitFor(() =>
      expect(savedData().categories[0].targets).toEqual([
        { ticker: 'VOO', percent: 70 },
        { ticker: 'TSLA', percent: 5 },
        { ticker: 'NVDA', percent: 10, group: 'Corp' },
        { ticker: 'AMZN', percent: 15, group: 'Corp' },
      ]),
    );
  });

  it('saves a category holding a long imported ticker', async () => {
    const data = sample();
    data.categories[1] = { ...data.categories[1], holdings: { ...data.categories[1].holdings, AAPL250117C00150000: 1 } };
    const { user } = renderApp('categories', data);
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[1]);
    const dialog = screen.getByRole('dialog');
    await user.clear(within(dialog).getByLabelText('Name'));
    await user.type(within(dialog).getByLabelText('Name'), 'Children');
    await user.click(within(dialog).getByRole('button', { name: 'Save category' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(savedData().categories[1]).toMatchObject({ name: 'Children', holdings: { AAPL250117C00150000: 1 } }));
  });

  it('forgets an unreadable target once its field is gone', async () => {
    const data = sample();
    data.categories[0] = {
      ...data.categories[0],
      targets: [
        { ticker: 'VOO', percent: 50 },
        { ticker: 'AMZN', percent: 30, group: 'Corp' },
        { ticker: 'TSLA', percent: 20, group: 'Corp' },
      ],
      holdings: {},
    };
    const { user } = renderApp('categories', data);
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    const dialog = screen.getByRole('dialog');
    await user.clear(within(dialog).getByLabelText('Target percent, row 3'));
    await user.type(within(dialog).getByLabelText('Target percent, row 3'), '20..');
    // Splitting equally hides the stocks' own targets; the group gets 50%.
    await user.selectOptions(within(dialog).getByLabelText('How group 1 is split'), 'Split equally');
    const group = within(dialog).getByLabelText('Group target percent, group 1');
    await user.clear(group);
    await user.type(group, '50');
    await user.click(within(dialog).getByRole('button', { name: 'Save category' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(savedData().categories[0].targets.find((t) => t.ticker === 'TSLA')).toMatchObject({ percent: 25, group: 'Corp' }));
  });

  it('writes share classes with a dot whatever is typed', async () => {
    const { user } = renderApp('categories');
    await user.click(screen.getByRole('button', { name: 'Add your first category' }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText('Name'), 'P');
    await user.type(within(dialog).getByLabelText('Ticker, row 1'), 'brk-b');
    await user.type(within(dialog).getByLabelText('Target percent, row 1'), '100');
    await user.click(within(dialog).getByRole('button', { name: 'Save category' }));
    await waitFor(() => expect(savedData().categories[0].targets).toEqual([{ ticker: 'BRK.B', percent: 100 }]));
  });

  it('validates groups', async () => {
    const { user } = renderApp('categories');
    await user.click(screen.getByRole('button', { name: 'Add your first category' }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText('Name'), 'X');
    await user.click(within(dialog).getByRole('button', { name: '+ Add group' }));
    await user.click(within(dialog).getByRole('button', { name: 'Save category' }));
    expect(within(dialog).getByText('Give the group a name.')).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText('Group name, group 1'), 'G');
    expect(within(dialog).getByText('Set the group’s target (above 0%).')).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText('Group target percent, group 1'), '100');
    expect(within(dialog).getByText('Add at least one stock to the group.')).toBeInTheDocument();
  });
});

