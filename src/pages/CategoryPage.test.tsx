import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderApp, sample, savedData } from '../test-utils';

describe('CategoryPage', () => {
  it('shows the mix now and the target as charts, with a legend and the stocks table', () => {
    renderApp('category/sample-pension', sample());
    expect(screen.getByRole('heading', { level: 1, name: 'Pension' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Categories', current: 'page' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /^Now: VOO \d/ })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Target: VOO 60.0%, VXUS 25.0%, BND 15.0%' })).toBeInTheDocument();

    const legend = screen.getAllByRole('table')[0];
    const rows = within(legend).getAllByRole('row');
    expect(rows.map((r) => r.querySelector('td')?.textContent)).toEqual([undefined, 'VOO', 'VXUS', 'BND']);
    expect(within(rows[1]).getByText('60.0%')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Difference' })).toBeInTheDocument();
    expect(screen.getByText('No purchases recorded for Pension yet.')).toBeInTheDocument();
  });

  it('highlights a stock in both charts when its legend row is pointed at', async () => {
    const { user } = renderApp('category/sample-pension', sample());
    const legend = screen.getAllByRole('table')[0];
    await user.hover(within(legend).getByText('VXUS'));
    const target = screen.getByRole('img', { name: /^Target:/ });
    expect(within(target).getByText('VXUS')).toBeInTheDocument();
    expect(within(target).getByText('25.0%')).toBeInTheDocument();
    expect(within(screen.getByRole('img', { name: /^Now:/ })).getByText('VXUS')).toBeInTheDocument();
  });

  it('folds the smallest stocks into "Other" when there are more than six', () => {
    const data = sample();
    const tickers = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
    data.categories[0] = {
      ...data.categories[0],
      targets: tickers.map((ticker, i) => ({ ticker, percent: [30, 20, 15, 12, 10, 8, 5][i] })),
      holdings: {},
    };
    renderApp('category/sample-pension', data);
    expect(screen.getByRole('img', { name: 'Target: A 30.0%, B 20.0%, C 15.0%, D 12.0%, E 10.0%, other 13.0%' })).toBeInTheDocument();
    expect(screen.getByText('Other (F, G)')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Now: No stocks yet' })).toBeInTheDocument();
  });

  it('opens from the Categories page and edits the category', async () => {
    const { user } = renderApp('categories', sample());
    await user.click(screen.getByRole('link', { name: /Kids/ }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Kids' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Edit category' }));
    const name = screen.getByRole('textbox', { name: 'Name' });
    await user.clear(name);
    await user.type(name, 'Noa');
    await user.click(screen.getByRole('button', { name: 'Save category' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Noa' })).toBeInTheDocument();
    await waitFor(() => expect(savedData().categories[1].name).toBe('Noa'));
  });

  it('says so when the category no longer exists, also for a broken link', () => {
    renderApp('category/gone', sample());
    expect(screen.getByText(/This category no longer exists/)).toBeInTheDocument();
  });

  it('does not crash on a link with a broken % escape', () => {
    renderApp('category/100%', sample());
    expect(screen.getByText(/This category no longer exists/)).toBeInTheDocument();
  });
});
