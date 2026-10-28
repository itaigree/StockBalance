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
});

