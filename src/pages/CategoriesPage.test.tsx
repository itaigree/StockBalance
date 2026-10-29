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
      expect(Math.abs(targets[0].percent - 500 / 9)).toBeLessThanOrEqual(0.01);
    });
  });

  it('scales many small targets to 100% without leaving any below 0', async () => {
    // 15 stocks at 3.333% and one at 0.005% (50% in all): rounding each scaled target up would leave
    // the last one at −0.05%.
    const data = sample();
    const tickers = 'ABCDEFGHIJKLMNOP'.split('');
    data.categories[0] = {
      ...data.categories[0],
      targets: tickers.map((ticker, i) => ({ ticker, percent: i < 15 ? 3.333 : 0.005 })),
      holdings: {},
    };
    const { user } = renderApp('categories', data);
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Scale to 100%' }));
    expect(within(dialog).getByText('Targets add up to 100%')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Save category' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => {
      const targets = savedData().categories[0].targets;
      expect(targets.every((t) => t.percent > 0)).toBe(true);
      expect(targets.reduce((s, t) => s + t.percent, 0)).toBeCloseTo(100, 6);
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

  it('saves a category holding a long imported ticker', async () => {
    const data = sample();
    data.categories[1] = {
      ...data.categories[1],
      holdings: { ...data.categories[1].holdings, AAPL250117C00150000: 1 },
    };
    const { user } = renderApp('categories', data);
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[1]);
    const dialog = screen.getByRole('dialog');
    await user.clear(within(dialog).getByLabelText('Name'));
    await user.type(within(dialog).getByLabelText('Name'), 'Children');
    await user.click(within(dialog).getByRole('button', { name: 'Save category' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() =>
      expect(savedData().categories[1]).toMatchObject({ name: 'Children', holdings: { AAPL250117C00150000: 1 } }),
    );
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

  describe('groups', () => {
    /** Pension with VOO and a group "Corp" (given as per-stock targets). */
    const withGroup = (targets: { ticker: string; percent: number; group?: string }[]) => {
      const data = sample();
      data.categories[0] = { ...data.categories[0], targets, holdings: {} };
      return data;
    };
    const openEditor = async (user: ReturnType<typeof renderApp>['user']) => {
      await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
      return screen.getByRole('dialog');
    };
    const setField = async (user: ReturnType<typeof renderApp>['user'], field: HTMLElement, value: string) => {
      await user.clear(field);
      await user.type(field, value);
    };

    it('shows a group as one line, and edits its stocks in the group box', async () => {
      const { user } = renderApp('categories');
      await user.click(screen.getByRole('button', { name: 'Add your first category' }));
      const dialog = screen.getByRole('dialog');
      await user.type(within(dialog).getByLabelText('Name'), 'Investments');
      await user.type(within(dialog).getByLabelText('Ticker, row 1'), 'VOO');
      await user.type(within(dialog).getByLabelText('Target percent, row 1'), '80');
      expect(within(dialog).queryByRole('combobox', { name: /Group, row/ })).not.toBeInTheDocument();

      // The group box: first the group's share of the category, then its stocks.
      await user.click(within(dialog).getByRole('button', { name: '+ Add group' }));
      const box = within(dialog).getByRole('group', { name: /Group/ });
      await user.type(within(box).getByLabelText('Group name, group 1'), 'Corporates');
      await user.type(within(box).getByLabelText('Group target percent, group 1'), '20');
      await user.type(within(box).getByLabelText('Ticker, row 2'), 'AMZN');
      await user.type(within(box).getByLabelText('Shares owned, row 2'), '3');
      await user.click(within(box).getByRole('button', { name: '+ Add stock' }));
      await user.type(within(box).getByLabelText('Ticker, row 3'), 'TSLA');
      expect(within(box).getAllByText('= 10% of the category')).toHaveLength(2);
      await user.click(within(box).getByRole('button', { name: 'Done' }));

      // Back in the list: one line with the name, its target and its stocks.
      expect(within(dialog).getByRole('button', { name: 'Corporates' })).toBeInTheDocument();
      expect(within(dialog).getByText('AMZN · TSLA')).toBeInTheDocument();
      expect(within(dialog).getByText('Targets add up to 100%')).toBeInTheDocument();
      await user.click(within(dialog).getByRole('button', { name: 'Save category' }));

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
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
      await user.click(screen.getByRole('button', { name: 'Edit' }));
      expect(within(screen.getByRole('dialog')).getByLabelText('Group target percent, group 1')).toHaveValue('20');
    });

    it('splits a group by each stock’s share of the group, adding up to 100%', async () => {
      const { user } = renderApp(
        'categories',
        withGroup([
          { ticker: 'VOO', percent: 95 },
          { ticker: 'AMZN', percent: 2.5, group: 'Corp' },
          { ticker: 'TSLA', percent: 2.5, group: 'Corp' },
        ]),
      );
      const dialog = await openEditor(user);
      await user.click(within(dialog).getByRole('button', { name: 'Edit group Corp' }));
      const box = within(dialog).getByRole('group', { name: 'Group Corp' });
      await user.click(within(box).getByRole('radio', { name: /My own split/ }));
      expect(within(box).getByLabelText('Share of the group, row 2')).toHaveValue('50');
      await setField(user, within(box).getByLabelText('Share of the group, row 2'), '60');
      expect(within(box).getByText('Shares add up to 110%')).toBeInTheDocument();
      await setField(user, within(box).getByLabelText('Share of the group, row 3'), '40');
      expect(within(box).getByText('= 3% of the category')).toBeInTheDocument();
      expect(within(box).getByText('= 2% of the category')).toBeInTheDocument();
      await user.click(within(box).getByRole('button', { name: 'Done' }));
      expect(within(dialog).getByText('AMZN 60% · TSLA 40%')).toBeInTheDocument();
      await user.click(within(dialog).getByRole('button', { name: 'Save category' }));

      expect(screen.getByText('(AMZN 60%, TSLA 40%)')).toBeInTheDocument();
      await waitFor(() =>
        expect(savedData().categories[0].targets).toEqual([
          { ticker: 'VOO', percent: 95 },
          { ticker: 'AMZN', percent: 3, group: 'Corp' },
          { ticker: 'TSLA', percent: 2, group: 'Corp' },
        ]),
      );

      // Opens again with its shares; back to equal keeps the group's 5%.
      const again = await openEditor(user);
      await user.click(within(again).getByRole('button', { name: 'Edit group Corp' }));
      const box2 = within(again).getByRole('group', { name: 'Group Corp' });
      expect(within(box2).getByRole('radio', { name: /My own split/ })).toBeChecked();
      expect(within(box2).getByLabelText('Share of the group, row 2')).toHaveValue('60');
      await user.click(within(box2).getByRole('radio', { name: 'Equally' }));
      expect(within(box2).getByLabelText('Group target percent, group 1')).toHaveValue('5');
      expect(within(box2).getAllByText('= 2.5% of the category')).toHaveLength(2);
    });

    it('needs shares that add up to 100% of the group, each above 0', async () => {
      const { user } = renderApp(
        'categories',
        withGroup([
          { ticker: 'VOO', percent: 80 },
          { ticker: 'AMZN', percent: 15, group: 'Corp' },
          { ticker: 'TSLA', percent: 5, group: 'Corp' },
        ]),
      );
      const dialog = await openEditor(user);
      await user.click(within(dialog).getByRole('button', { name: 'Edit group Corp' }));
      const box = within(dialog).getByRole('group', { name: 'Group Corp' });
      expect(within(box).getByLabelText('Share of the group, row 3')).toHaveValue('25');
      await user.clear(within(box).getByLabelText('Share of the group, row 3'));
      await user.click(within(dialog).getByRole('button', { name: 'Save category' }));
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(within(box).getByText('Set this stock’s share of the group (above 0%).')).toBeInTheDocument();
      await user.type(within(box).getByLabelText('Share of the group, row 3'), '15');
      expect(
        within(box).getByText('The stocks’ shares add up to 90%; they must add up to 100% of the group.'),
      ).toBeInTheDocument();
      await user.click(within(box).getByRole('button', { name: 'Scale to 100%' }));
      expect(within(box).getByText('Shares add up to 100%')).toBeInTheDocument();
      await user.click(within(dialog).getByRole('button', { name: 'Save category' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    });

    it('moves a stock in and takes one out, each keeping its part of the category', async () => {
      const { user } = renderApp(
        'categories',
        withGroup([
          { ticker: 'VOO', percent: 70 },
          { ticker: 'NVDA', percent: 10 },
          { ticker: 'AMZN', percent: 15, group: 'Corp' },
          { ticker: 'TSLA', percent: 5, group: 'Corp' },
        ]),
      );
      const dialog = await openEditor(user);
      await user.click(within(dialog).getByRole('button', { name: 'Edit group Corp' }));
      const box = within(dialog).getByRole('group', { name: 'Group Corp' });
      await user.selectOptions(
        within(box).getByLabelText("Move one of the category's stocks into the group"),
        'NVDA (10%)',
      );
      expect(within(box).getByLabelText('Group target percent, group 1')).toHaveValue('30');
      expect(within(box).getByText('= 10% of the category')).toBeInTheDocument(); // NVDA
      await user.click(within(box).getByRole('button', { name: 'Take TSLA out of the group' }));
      expect(within(box).getByLabelText('Group target percent, group 1')).toHaveValue('25');
      expect(within(box).getByLabelText('Share of the group, row 2')).toHaveValue('40'); // NVDA
      expect(within(box).getByLabelText('Share of the group, row 3')).toHaveValue('60'); // AMZN
      await user.click(within(box).getByRole('button', { name: 'Done' }));
      expect(within(dialog).getByLabelText('Target percent, row 4')).toHaveValue('5'); // TSLA on its own
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

    it('keeps the total when a stock leaves an equal group that does not split evenly', async () => {
      const { user } = renderApp(
        'categories',
        withGroup([
          { ticker: 'VOO', percent: 90 },
          ...['A', 'B', 'C'].map((ticker) => ({ ticker, percent: 10 / 3, group: 'G' })),
        ]),
      );
      const dialog = await openEditor(user);
      // Three stocks of 3.333…% give back the 10% typed.
      expect(within(dialog).getByLabelText('Group target percent, group 1')).toHaveValue('10');
      await user.click(within(dialog).getByRole('button', { name: 'Edit group G' }));
      const box = within(dialog).getByRole('group', { name: 'Group G' });
      await user.click(within(box).getByRole('button', { name: 'Take A out of the group' }));
      expect(within(box).getByLabelText('Group target percent, group 1')).toHaveValue('6.67');
      await user.click(within(box).getByRole('button', { name: 'Done' }));
      expect(within(dialog).getByLabelText('Target percent, row 2')).toHaveValue('3.33');
      expect(within(dialog).getByText('Targets add up to 100%')).toBeInTheDocument();
    });

    it('removes a group when its last stock is taken out', async () => {
      const { user } = renderApp(
        'categories',
        withGroup([
          { ticker: 'VOO', percent: 95 },
          { ticker: 'AMZN', percent: 5, group: 'Corp' },
        ]),
      );
      const dialog = await openEditor(user);
      await user.click(within(dialog).getByRole('button', { name: 'Edit group Corp' }));
      await user.click(within(dialog).getByRole('button', { name: 'Take AMZN out of the group' }));
      expect(within(dialog).queryByRole('group', { name: /Group/ })).not.toBeInTheDocument();
      expect(within(dialog).getByLabelText('Target percent, row 2')).toHaveValue('5');
    });

    it('forgets an unreadable share once its field is gone', async () => {
      const { user } = renderApp(
        'categories',
        withGroup([
          { ticker: 'VOO', percent: 50 },
          { ticker: 'AMZN', percent: 30, group: 'Corp' },
          { ticker: 'TSLA', percent: 20, group: 'Corp' },
        ]),
      );
      const dialog = await openEditor(user);
      await user.click(within(dialog).getByRole('button', { name: 'Edit group Corp' }));
      const box = within(dialog).getByRole('group', { name: 'Group Corp' });
      await setField(user, within(box).getByLabelText('Share of the group, row 3'), '20..');
      // Splitting equally hides the shares.
      await user.click(within(box).getByRole('radio', { name: 'Equally' }));
      await user.click(within(dialog).getByRole('button', { name: 'Save category' }));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      await waitFor(() =>
        expect(savedData().categories[0].targets.find((t) => t.ticker === 'TSLA')).toMatchObject({
          percent: 25,
          group: 'Corp',
        }),
      );
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
});
