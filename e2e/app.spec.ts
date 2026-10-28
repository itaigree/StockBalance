import { readFileSync } from 'node:fs';
import { expect, test } from './fixtures';

test('first run: sample data, live prices and the broker view', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Welcome to StockBalance' })).toBeVisible();
  await page.getByRole('button', { name: 'Load sample data' }).click();
  await expect(page.getByRole('heading', { name: 'Pension' })).toBeVisible();
  // The stubbed "live" price replaced the sample price.
  await expect(page.getByRole('region', { name: 'Pension' }).getByRole('button', { name: /\$575\.30/ })).toBeVisible();
  await expect(page.getByText('3.6512')).toBeVisible();
  await page.getByText('Broker view').click();
  const voo = page.locator('.broker-view tr', { hasText: 'VOO' });
  await expect(voo).toContainText('47.5');
});

test('create a category, with validation', async ({ page }) => {
  await page.goto('/#/categories');
  await page.getByRole('button', { name: 'Add your first category' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name').fill('Kids');
  await dialog.getByLabel('Ticker, row 1').fill('vti');
  await dialog.getByLabel('Target percent, row 1').fill('70');
  await dialog.getByLabel('Shares owned, row 1').fill('3');
  await dialog.getByRole('button', { name: '+ Add stock' }).click();
  await dialog.getByLabel('Ticker, row 2').fill('BND');
  await dialog.getByLabel('Target percent, row 2').fill('20');
  await dialog.getByRole('button', { name: 'Save category' }).click();
  await expect(dialog.getByText('Please fix the highlighted fields.')).toBeVisible();
  await dialog.getByLabel('Target percent, row 2').fill('30');
  await dialog.getByRole('button', { name: 'Save category' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Kids' })).toBeVisible();
  await expect(page.getByText('VTI 70%')).toBeVisible();

  await page.getByRole('link', { name: 'Portfolio' }).click();
  await expect(page.getByRole('region', { name: 'Kids' })).toContainText('$900.00'); // 3 × $300
});

test('invest, record, check holdings and the category page, undo', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Load sample data' }).click();
  await expect(page.getByText('3.6512')).toBeVisible();
  await page.getByRole('navigation').getByRole('link', { name: 'Invest' }).click();
  await page.getByLabel('Amount to invest in ILS').fill('10000');

  const orders = page.getByRole('region', { name: 'Orders to place' });
  await expect(orders).toBeVisible();
  const rows = orders.locator('tbody tr');
  const count = await rows.count();
  expect(count).toBeGreaterThan(0);
  const planned: Record<string, number> = {};
  for (let i = 0; i < count; i++) {
    const cells = rows.nth(i).locator('td');
    planned[(await cells.nth(1).textContent())!] = Number(await cells.nth(2).textContent());
  }
  // One order per stock, whole shares.
  expect(new Set(Object.keys(planned)).size).toBe(count);
  for (const n of Object.values(planned)) expect(Number.isInteger(n)).toBe(true);

  await page.getByRole('button', { name: 'I made a purchase' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Record purchase' }).click();
  await expect(page.getByText(/Purchase recorded/)).toBeVisible();

  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('stockbalance:data')!));
  expect(saved.transactions).toHaveLength(1);
  for (const [ticker, shares] of Object.entries(planned)) {
    const total = saved.categories.reduce((s: number, c: { holdings: Record<string, number> }) => s + (c.holdings[ticker] ?? 0), 0);
    const before = { VOO: 47.5, BND: 65, VXUS: 150, QQQ: 8, GLD: 6 }[ticker] ?? 0;
    expect(total).toBeCloseTo(before + shares, 6);
  }

  // The purchase shows on the category's own page…
  await page.getByRole('link', { name: 'Portfolio' }).click();
  await page.getByRole('link', { name: 'Kids' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Kids' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Kids purchases' }).locator('tbody tr')).toHaveCount(1);
  await expect(page.getByRole('img', { name: /^Now: VOO/ })).toBeVisible();

  // …and can be undone from "All purchases" on the Portfolio page.
  await page.getByRole('link', { name: 'Portfolio' }).click();
  await page.getByText('All purchases').click();
  await expect(page.getByRole('article')).toHaveCount(1);
  await page.getByRole('button', { name: 'Undo' }).click();
  await page.getByRole('button', { name: 'Undo purchase' }).click();
  await expect(page.getByText('None recorded yet')).toBeVisible();
  const reverted = await page.evaluate(() => JSON.parse(localStorage.getItem('stockbalance:data')!));
  expect(reverted.categories.find((c: { id: string }) => c.id === 'sample-pension').holdings).toEqual({ VOO: 40, VXUS: 150, BND: 60 });
  expect(reverted.categories.find((c: { id: string }) => c.id === 'sample-kids').cashIls).toBeCloseTo(250, 6);
});

test('data survives a reload, and backups download and restore', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Load sample data' }).click();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Investments' })).toBeVisible();

  await page.getByRole('link', { name: 'Settings' }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download backup' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^stockbalance-backup-\d{4}-\d{2}-\d{2}\.json$/);
  const path = await download.path();
  const backup = JSON.parse(readFileSync(path, 'utf8'));
  expect(backup.categories).toHaveLength(3);

  await page.getByRole('button', { name: 'Delete all data' }).click();
  await page.getByLabel('Type DELETE to confirm').fill('DELETE');
  await page.getByRole('button', { name: 'Delete everything' }).click();
  await page.getByLabel('Backup file to restore').setInputFiles(path);
  await page.getByRole('button', { name: 'Replace my data' }).click();
  await page.reload();
  await page.getByRole('link', { name: 'Portfolio' }).click();
  await expect(page.getByRole('heading', { name: 'Pension' })).toBeVisible();
});

test('works on a phone-sized screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Load sample data' }).click();
  await page.getByRole('navigation').getByRole('link', { name: 'Invest' }).click();
  await page.getByLabel('Amount to invest in ILS').fill('10000');
  await expect(page.getByRole('region', { name: 'Orders to place' })).toBeVisible();
  // Nothing makes the whole page scroll sideways.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
