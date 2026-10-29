import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { expect, PRICES, test } from './fixtures';

/*
 * Journey: backups, restore, two open copies of the app, price source and the backup reminder.
 * The market is stubbed (see fixtures.ts); stocks without a stubbed price are priced by hand.
 */

const DATA_KEY = 'stockbalance:data';
const NEVER_TEXT = /Your data is saved only in this browser/;
const PURCHASES_TEXT = /Your purchases changed since your last backup/;

interface Saved {
  categories: {
    id: string;
    name: string;
    holdings: Record<string, number>;
    cashIls: number;
    targets: unknown[];
    notes?: string;
  }[];
  prices: Record<string, { priceUsd: number; source: string }>;
  fx: { usdIls: number; source: string } | null;
  settings: Record<string, unknown>;
  transactions: { id: string; allocations: { categoryId: string; ticker: string; shares: number }[] }[];
}

const usdFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const usd = (n: number) => usdFmt.format(Math.round(n * 100) / 100);
const ilsFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'ILS' });
const ils = (n: number) => ilsFmt.format(Math.round(n * 100) / 100);

/** Fails the test on any uncaught page error or console error (except the stub's 404 for unknown symbols). */
function watchErrors(page: Page, errors: string[], label = 'page') {
  page.on('pageerror', (e) => errors.push(`${label} pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const url = m.location().url ?? '';
    if (/Failed to load resource/.test(m.text()) && url.includes('/api/yahoo/') && /404/.test(m.text())) return;
    errors.push(`${label} console: ${m.text()}`);
  });
}

/** The same stubbed market as fixtures.ts, for a second tab opened in the same browser context. */
async function stubMarket(page: Page) {
  await page.route('**/api/yahoo/**', (route) => {
    const symbol = decodeURIComponent(route.request().url().split('/chart/')[1].split('?')[0]);
    if (!(symbol in PRICES)) {
      return route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ chart: { result: null, error: { code: 'Not Found', description: 'No data found' } } }),
      });
    }
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        chart: {
          result: [{ meta: { currency: symbol === 'ILS=X' ? 'ILS' : 'USD', regularMarketPrice: PRICES[symbol] } }],
          error: null,
        },
      }),
    });
  });
  await page.route(/finnhub\.io|frankfurter|open\.er-api/, (route) => route.abort());
}

async function openSecondTab(page: Page, errors: string[]): Promise<Page> {
  const page2 = await page.context().newPage();
  await stubMarket(page2);
  watchErrors(page2, errors, 'tab 2');
  await page2.goto('/');
  return page2;
}

async function saved(page: Page): Promise<Saved> {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), DATA_KEY);
}

function stockValue(data: Saved, categoryId: string): number {
  const c = data.categories.find((x) => x.id === categoryId)!;
  return Object.entries(c.holdings).reduce((s, [t, n]) => s + n * data.prices[t].priceUsd, 0);
}

async function loadSample(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Load sample data' }).click();
  // Live (stubbed) rate and prices have replaced the sample's.
  await expect(page.getByRole('region', { name: 'Market data' })).toContainText('3.6512');
  await expect(page.getByRole('region', { name: 'Pension' }).locator('.category-totals')).toContainText('$37,301.00');
}

async function goTo(page: Page, name: 'Portfolio' | 'Invest' | 'Categories' | 'Settings') {
  await page.getByRole('navigation').getByRole('link', { name, exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
}

async function recordPurchase(page: Page, amountIls: string) {
  await goTo(page, 'Invest');
  await page.getByLabel('Amount to invest in ILS').fill(amountIls);
  await expect(page.getByRole('region', { name: 'Orders to place' })).toBeVisible();
  await page.getByRole('button', { name: 'I made a purchase' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Record purchase' }).click();
  await expect(page.getByText(/Purchase recorded/)).toBeVisible();
}

async function downloadBackup(page: Page): Promise<{ path: string; json: Saved }> {
  await goTo(page, 'Settings');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download backup' }).click();
  const download = await downloadPromise;
  const path = await download.path();
  await expect(page.getByText('Backup downloaded.')).toBeVisible();
  await expect(page.getByText(/Last backup from this browser: just now/)).toBeVisible();
  return { path, json: JSON.parse(readFileSync(path, 'utf8')) };
}

async function restoreBackup(page: Page, path: string, summary: RegExp) {
  await goTo(page, 'Settings');
  await page.getByLabel('Backup file to restore').setInputFiles(path);
  const dialog = page.getByRole('dialog', { name: 'Restore this backup?' });
  await expect(dialog).toContainText(summary);
  await dialog.getByRole('button', { name: 'Replace my data' }).click();
  await expect(page.getByText('Backup restored.')).toBeVisible();
}

/** Every category's stock value and cash as shown on the Portfolio page match the saved data. */
async function expectPortfolioMatches(page: Page, data: Saved) {
  await goTo(page, 'Portfolio');
  for (const c of data.categories) {
    const totals = page.getByRole('region', { name: c.name }).locator('.category-totals');
    await expect(totals).toContainText(`Stocks ${usd(stockValue(data, c.id))}`);
    if (Math.abs(c.cashIls) >= 0.005) await expect(totals).toContainText(`Cash ${ils(c.cashIls)}`);
    else await expect(totals).not.toContainText('Cash');
  }
  const purchases = page.locator('.all-purchases > summary');
  await expect(purchases).toContainText(
    data.transactions.length === 0 ? 'None recorded yet' : `${data.transactions.length} recorded`,
  );
}

let errors: string[];
test.beforeEach(({ page }) => {
  errors = [];
  watchErrors(page, errors);
});
test.afterEach(() => {
  expect(errors, 'no page errors or console errors').toEqual([]);
});

test('backup, change the data, restore it, delete everything and restore again: the backed-up numbers come back', async ({
  page,
}) => {
  await loadSample(page);
  const { path, json: backup } = await downloadBackup(page);
  expect(backup.categories.map((c) => c.name)).toEqual(['Pension', 'Kids', 'Investments']);
  expect(backup.transactions).toEqual([]);
  const original = await saved(page);
  expect(backup.categories).toEqual(original.categories);

  // Change the data: a purchase and an edited fee.
  await recordPurchase(page, '10000');
  await goTo(page, 'Settings');
  await page.getByLabel('Currency conversion fee').fill('0.5');
  const changed = await saved(page);
  expect(changed.transactions).toHaveLength(1);
  expect(changed.settings.fxFeePercent).toBe(0.5);
  expect(stockValue(changed, 'sample-pension')).toBeGreaterThan(stockValue(original, 'sample-pension'));
  await expectPortfolioMatches(page, changed);

  // Restore: everything is as in the backup again.
  await restoreBackup(page, path, /3 categories and 0 recorded purchases/);
  await expect(page.getByLabel('Currency conversion fee')).toHaveValue('0');
  const restored = await saved(page);
  expect(restored.categories).toEqual(original.categories);
  expect(restored.transactions).toEqual([]);
  expect(restored.settings).toEqual(original.settings);
  await expectPortfolioMatches(page, restored);
  await expect(page.getByRole('region', { name: 'Pension' }).locator('.category-totals')).toContainText('$37,301.00');
  await expect(page.getByRole('region', { name: 'Kids' }).locator('.category-totals')).toContainText('Cash ₪250.00');

  // Delete everything, then restore the same file again.
  await goTo(page, 'Settings');
  await page.getByRole('button', { name: 'Delete all data' }).click();
  await page.getByLabel('Type DELETE to confirm').fill('DELETE');
  await page.getByRole('button', { name: 'Delete everything' }).click();
  await expect(page.getByText('All data deleted.')).toBeVisible();
  await expect(page.getByText('No backup made from this browser yet.')).toBeVisible();
  expect((await saved(page)).categories).toEqual([]);
  await page.getByRole('navigation').getByRole('link', { name: 'Portfolio' }).click();
  await expect(page.getByRole('heading', { name: 'Welcome to StockBalance' })).toBeVisible();

  await restoreBackup(page, path, /3 categories and 0 recorded purchases/);
  // Prices and the exchange rate are fetched again for the restored data.
  await goTo(page, 'Portfolio');
  await expect(page.getByRole('region', { name: 'Market data' })).toContainText('3.6512');
  const again = await saved(page);
  expect(again.categories).toEqual(original.categories);
  expect(again.fx?.usdIls).toBe(PRICES['ILS=X']);
  expect(again.prices.VOO.priceUsd).toBe(PRICES.VOO);
  await expectPortfolioMatches(page, again);

  // And it all survives a reload, the same on every page.
  await page.reload();
  await expectPortfolioMatches(page, again);
  await page.getByRole('link', { name: 'Kids' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Kids' })).toBeVisible();
  const summary = page.getByRole('region', { name: 'Summary' });
  await expect(summary).toContainText(usd(stockValue(again, 'sample-kids')).replace(/\.\d\d$/, ''));
  await expect(summary).toContainText('₪250');
});

test('backup reminder: shown with no backup, gone after one, back after a purchase, Later hides it', async ({
  page,
}) => {
  await loadSample(page);
  const reminder = page.locator('.backup-reminder');
  await expect(reminder).toContainText(NEVER_TEXT);

  // A backup from Settings makes it go away.
  await downloadBackup(page);
  await goTo(page, 'Portfolio');
  await expect(page.getByRole('region', { name: 'Pension' })).toBeVisible();
  await expect(reminder).toHaveCount(0);

  // Changing a price or a setting is not worth a reminder…
  await goTo(page, 'Settings');
  await page.getByLabel('Minimum order').fill('20');
  await goTo(page, 'Portfolio');
  await expect(page.getByRole('region', { name: 'Pension' })).toBeVisible();
  await expect(reminder).toHaveCount(0);

  // …a purchase is.
  await recordPurchase(page, '5000');
  await goTo(page, 'Portfolio');
  await expect(reminder).toContainText(PURCHASES_TEXT);
  await expect(reminder).toContainText('(just now)');

  // "Back up now" in the reminder downloads a backup with the purchase in it and hides the reminder.
  const downloadPromise = page.waitForEvent('download');
  await reminder.getByRole('button', { name: 'Back up now' }).click();
  const file = JSON.parse(readFileSync(await (await downloadPromise).path(), 'utf8')) as Saved;
  expect(file.transactions).toHaveLength(1);
  await expect(reminder).toHaveCount(0);

  // Undoing the purchase changes the purchases again: the reminder is back, and "Later" hides it,
  // also after a reload.
  await page.getByText('All purchases').click();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await page.getByRole('button', { name: 'Undo purchase' }).click();
  await expect(page.getByText('None recorded yet')).toBeVisible();
  await expect(reminder).toContainText(PURCHASES_TEXT);
  await reminder.getByRole('button', { name: 'Later' }).click();
  await expect(reminder).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('region', { name: 'Pension' })).toBeVisible();
  await expect(reminder).toHaveCount(0);
  // Snoozing doesn't forget when the last backup was made.
  await goTo(page, 'Settings');
  await expect(page.getByText(/Last backup from this browser: just now/)).toBeVisible();
});

test('two tabs: a purchase recorded in one tab is kept when the other tab then changes a setting and a price', async ({
  page,
}) => {
  await loadSample(page);
  const page2 = await openSecondTab(page, errors);
  await expect(page2.getByRole('region', { name: 'Pension' }).locator('.category-totals')).toContainText('$37,301.00');

  await recordPurchase(page, '10000');
  const afterPurchase = await saved(page);
  expect(afterPurchase.transactions).toHaveLength(1);

  // The other tab follows without a reload…
  await expect(page2.locator('.all-purchases > summary')).toContainText('1 recorded');
  await expect(page2.getByRole('region', { name: 'Pension' }).locator('.category-totals')).toContainText(
    `Stocks ${usd(stockValue(afterPurchase, 'sample-pension'))}`,
  );
  // …and its own changes keep the purchase.
  await goTo(page2, 'Settings');
  await page2.getByLabel('Currency conversion fee').fill('0.25');
  await page2.getByRole('checkbox', { name: 'My broker only sells whole shares' }).uncheck();
  await goTo(page2, 'Portfolio');
  await page2
    .getByRole('region', { name: 'Pension' })
    .getByRole('button', { name: /\$575\.30/ })
    .click();
  const priceDialog = page2.getByRole('dialog', { name: 'Price of VOO' });
  await priceDialog.getByLabel('Price of VOO in USD').fill('590');
  await priceDialog.getByRole('button', { name: 'Save price' }).click();
  await expect(priceDialog).toBeHidden();

  const final = await saved(page2);
  expect(final.transactions).toEqual(afterPurchase.transactions);
  expect(final.categories).toEqual(afterPurchase.categories);
  expect(final.settings.fxFeePercent).toBe(0.25);
  expect(final.settings.wholeShares).toBe(false);
  expect(final.prices.VOO).toMatchObject({ priceUsd: 590, source: 'manual' });

  // The first tab shows the other tab's changes, without a reload.
  await goTo(page, 'Portfolio');
  await expectPortfolioMatches(page, final);
  await expect(page.getByRole('region', { name: 'Pension' }).getByRole('button', { name: /\$590\.00/ })).toBeVisible();
  await goTo(page, 'Settings');
  await expect(page.getByLabel('Currency conversion fee')).toHaveValue('0.25');
  await expect(page.getByRole('checkbox', { name: 'My broker only sells whole shares' })).not.toBeChecked();

  // After a reload both tabs show the same data (a reload refreshes prices: VOO is live again).
  await page.reload();
  await page2.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
  await goTo(page, 'Portfolio');
  await expect(page.getByRole('region', { name: 'Pension' }).getByRole('button', { name: /\$575\.30/ })).toBeVisible();
  const reloaded = await saved(page);
  expect(reloaded.transactions).toEqual(afterPurchase.transactions);
  expect(reloaded.categories).toEqual(afterPurchase.categories);
  expect(reloaded.settings.fxFeePercent).toBe(0.25);
  await expectPortfolioMatches(page, reloaded);
  await expectPortfolioMatches(page2, reloaded);
  await page2.close();
});

test('manual prices: typed prices are kept after a reload and a rate refresh; a stock with no live price is priced by hand', async ({
  page,
}) => {
  // With manual prices the exchange rate comes from Frankfurter: serve it a fixed rate.
  await page.route(/frankfurter/, (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify({ base: 'USD', rates: { ILS: 3.6601 } }) }),
  );
  await loadSample(page);
  await goTo(page, 'Settings');
  await page.getByRole('radio', { name: /Manual/ }).check();
  expect((await saved(page)).settings.priceProvider).toBe('manual');

  // A new category with a stock the market stub doesn't know.
  await goTo(page, 'Categories');
  await page.getByRole('button', { name: 'Add category' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name').fill('Tech');
  await dialog.getByLabel('Ticker, row 1').fill('msft');
  await dialog.getByLabel('Target percent, row 1').fill('100');
  await dialog.getByLabel('Shares owned, row 1').fill('2.5');
  await dialog.getByRole('button', { name: 'Save category' }).click();
  await expect(dialog).toBeHidden();

  await goTo(page, 'Portfolio');
  await expect(page.getByRole('region', { name: 'Market data' })).toContainText('1 missing (MSFT)');
  await page.getByText('Broker view').click();
  const msftRow = page.locator('.broker-view tbody tr', { hasText: 'MSFT' });
  await msftRow.getByRole('button', { name: 'Enter price' }).click();
  const msftDialog = page.getByRole('dialog', { name: 'Price of MSFT' });
  await msftDialog.getByLabel('Price of MSFT in USD').fill('420.5');
  await msftDialog.getByRole('button', { name: 'Save price' }).click();
  await expect(msftRow).toContainText('$420.50');
  await expect(msftRow).toContainText('$1,051.25'); // 2.5 × 420.50
  await expect(page.getByRole('region', { name: 'Tech' }).locator('.category-totals')).toContainText('$1,051.25');

  // Change a live price by hand too.
  await page
    .getByRole('region', { name: 'Pension' })
    .getByRole('button', { name: /\$575\.30/ })
    .click();
  const vooDialog = page.getByRole('dialog', { name: 'Price of VOO' });
  await vooDialog.getByLabel('Price of VOO in USD').fill('600');
  await vooDialog.getByRole('button', { name: 'Save price' }).click();
  // Pension: 40 × 600 + 150 × 66.10 + 60 × 72.90 = 38,289
  await expect(page.getByRole('region', { name: 'Pension' }).locator('.category-totals')).toContainText('$38,289.00');

  // With manual prices the refresh only fetches the exchange rate: typed prices stay.
  const refresh = page.getByRole('button', { name: 'Refresh rate' });
  await refresh.click();
  await expect(page.getByRole('region', { name: 'Market data' })).toContainText('3.6601 (Frankfurter (ECB)');
  await expect(refresh).toBeEnabled();
  await expect(page.getByRole('region', { name: 'Pension' }).locator('.category-totals')).toContainText('$38,289.00');
  await page.reload();
  await expect(page.getByRole('region', { name: 'Market data' })).toContainText('3.6601');
  await expect(page.getByRole('region', { name: 'Pension' }).locator('.category-totals')).toContainText('$38,289.00');
  await expect(page.getByRole('region', { name: 'Tech' }).locator('.category-totals')).toContainText('$1,051.25');
  const data = await saved(page);
  expect(data.prices.VOO).toMatchObject({ priceUsd: 600, source: 'manual' });
  expect(data.prices.MSFT).toMatchObject({ priceUsd: 420.5, source: 'manual' });

  // The Invest page plans with the typed prices.
  await goTo(page, 'Invest');
  await page.getByLabel('Amount to invest in ILS').fill('3000');
  const orders = page.getByRole('region', { name: 'Orders to place' });
  await expect(orders).toBeVisible();
  await expect(page.getByText(/missing/i)).toHaveCount(0);

  // Back to automatic: a refresh replaces the typed VOO price with the live one; MSFT keeps its typed price.
  await goTo(page, 'Settings');
  await page.getByRole('radio', { name: /Automatic/ }).check();
  await goTo(page, 'Portfolio');
  await page.getByRole('button', { name: 'Refresh prices' }).click();
  await expect(page.getByRole('region', { name: 'Pension' }).locator('.category-totals')).toContainText('$37,301.00');
  await expect(page.getByRole('region', { name: 'Tech' }).locator('.category-totals')).toContainText('$1,051.25');
});

test('two tabs: saving a category editor that was open in the other tab keeps the shares and cash of a purchase recorded meanwhile', async ({
  page,
}) => {
  await loadSample(page);
  const page2 = await openSecondTab(page, errors);
  // Tab 2: start editing Kids (only its notes will change).
  await goTo(page2, 'Categories');
  await page2.getByRole('button', { name: 'Edit', exact: true }).nth(1).click();
  const dialog = page2.getByRole('dialog');
  await expect(dialog.getByLabel('Name')).toHaveValue('Kids');

  // Tab 1: record a purchase, which adds shares to Kids and changes its cash.
  await recordPurchase(page, '10000');
  const afterPurchase = await saved(page);
  const kidsAfter = afterPurchase.categories.find((c) => c.id === 'sample-kids')!;
  expect(afterPurchase.transactions[0].allocations.some((a) => a.categoryId === 'sample-kids')).toBe(true);
  // Tab 2 has taken the new data: the list behind the open editor shows Kids' new shares.
  const shares = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 4 });
  await expect(page2.locator('main')).toContainText(
    `Owns ${Object.entries(kidsAfter.holdings)
      .map(([t, n]) => `${shares(n)} ${t}`)
      .join(', ')}`,
  );

  // Tab 2: save the editor.
  await dialog.getByLabel('Notes (optional)').fill('For the kids');
  await dialog.getByRole('button', { name: 'Save category' }).click();
  await expect(dialog).toBeHidden();

  const final = await saved(page2);
  const kids = final.categories.find((c) => c.id === 'sample-kids')!;
  expect(kids.notes).toBe('For the kids');
  // The purchase is still in the list — so its shares and cash must still be in the category.
  expect(final.transactions).toHaveLength(1);
  expect(kids.holdings).toEqual(kidsAfter.holdings);
  expect(kids.cashIls).toBeCloseTo(kidsAfter.cashIls, 2);
  await page2.close();
});

test('two tabs: a backup made in one tab clears the reminder in the other, and is remembered', async ({ page }) => {
  await loadSample(page);
  const page2 = await openSecondTab(page, errors);
  const reminder2 = page2.locator('.backup-reminder');
  await expect(reminder2).toContainText(NEVER_TEXT);

  // Tab 1 makes a backup: tab 2's reminder goes away by itself (there is nothing left to put off).
  await downloadBackup(page);
  await expect(reminder2).toHaveCount(0);

  // The backup made in tab 1 is still remembered.
  await page.reload();
  await expect(page.getByText(/Last backup from this browser: just now/)).toBeVisible();
  const mark = await page.evaluate(() => JSON.parse(localStorage.getItem('stockbalance:backup') ?? '{}'));
  expect(mark.at).toBeTruthy();
  await page2.close();
});

test('a backup made right after editing a category is still up to date a month later when nothing changed', async ({
  page,
}) => {
  await page.clock.install({ time: new Date('2026-09-01T10:00:00Z') });
  await loadSample(page);
  // Edit a category (its notes), then back up.
  await goTo(page, 'Categories');
  await page.getByRole('button', { name: 'Edit', exact: true }).nth(1).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Notes (optional)').fill('For the kids');
  await dialog.getByRole('button', { name: 'Save category' }).click();
  await expect(dialog).toBeHidden();
  await downloadBackup(page);

  // A month later the app is opened again; nothing was changed since the backup.
  await page.clock.setSystemTime(new Date('2026-10-05T10:00:00Z'));
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
  await expect(page.getByText(/Last backup from this browser: 3[34] days ago/)).toBeVisible();
  await goTo(page, 'Portfolio');
  await expect(page.getByRole('region', { name: 'Pension' })).toBeVisible();
  await expect(page.locator('.backup-reminder')).toHaveCount(0);
});

test('two tabs: Undo after recording on the Invest page never undoes the purchase the other tab recorded', async ({
  page,
}) => {
  await loadSample(page);
  const page2 = await openSecondTab(page, errors);

  await recordPurchase(page, '10000');
  const first = (await saved(page)).transactions[0];

  // The other tab records a second purchase.
  await recordPurchase(page2, '2000');
  const afterSecond = await saved(page2);
  expect(afterSecond.transactions).toHaveLength(2);
  const second = afterSecond.transactions[1];
  // Tab 1 has taken the new data: its split table shows the categories' cash after both purchases.
  const totalCash = afterSecond.categories.reduce((s, c) => s + c.cashIls, 0);
  await expect(page.locator('.split-table tfoot')).toContainText(ils(totalCash));

  // Tab 1 still says "Purchase recorded … Undo". If it offers Undo, it must undo tab 1's own purchase.
  const undo = page.getByRole('status').filter({ hasText: 'Purchase recorded' }).getByRole('button', { name: 'Undo' });
  if ((await undo.count()) > 0) {
    await undo.click();
    const undoDialog = page.getByRole('dialog', { name: 'Undo this purchase?' });
    await undoDialog.getByRole('button', { name: 'Undo purchase' }).click();
    await expect(undoDialog).toBeHidden();
    const ids = (await saved(page)).transactions.map((t) => t.id);
    expect(ids, "the other tab's purchase is kept").toContain(second.id);
    expect(ids, "tab 1's own purchase is the one undone").toEqual([second.id]);
  } else {
    expect((await saved(page)).transactions.map((t) => t.id)).toEqual([first.id, second.id]);
  }
  await page2.close();
});

test('two tabs: restoring a backup (shared as .txt) in one tab replaces the data in the other, which keeps it when it changes a setting', async ({
  page,
}) => {
  await loadSample(page);
  const { path } = await downloadBackup(page);
  // Phones that only share text files save the same JSON as .txt; restore accepts it.
  const txtPath = test.info().outputPath('stockbalance-backup.txt');
  copyFileSync(path, txtPath);
  const original = await saved(page);

  await recordPurchase(page, '10000');
  const page2 = await openSecondTab(page, errors);
  await expect(page2.locator('.all-purchases > summary')).toContainText('1 recorded');

  await restoreBackup(page, txtPath, /3 categories and 0 recorded purchases/);
  const restored = await saved(page);
  expect(restored.categories).toEqual(original.categories);
  expect(restored.transactions).toEqual([]);

  // The other tab shows the restored data without a reload…
  await expect(page2.locator('.all-purchases > summary')).toContainText('None recorded yet');
  await expectPortfolioMatches(page2, restored);
  // …and a change made there doesn't bring the purchase back.
  await goTo(page2, 'Settings');
  await page2.getByLabel('Minimum order').fill('25');
  const final = await saved(page2);
  expect(final.transactions).toEqual([]);
  expect(final.categories).toEqual(original.categories);
  expect(final.settings.minOrderUsd).toBe(25);

  await expect(page.getByLabel('Minimum order')).toHaveValue('25');
  await expectPortfolioMatches(page, final);
  await page.reload();
  await expectPortfolioMatches(page, final);
  await page2.close();
});

test('two tabs: "Delete all data" in one tab empties the other, which stays empty when it changes a setting', async ({
  page,
}) => {
  await loadSample(page);
  await recordPurchase(page, '5000');
  const page2 = await openSecondTab(page, errors);
  await expect(page2.locator('.all-purchases > summary')).toContainText('1 recorded');

  await goTo(page, 'Settings');
  await page.getByRole('button', { name: 'Delete all data' }).click();
  await page.getByLabel('Type DELETE to confirm').fill('DELETE');
  await page.getByRole('button', { name: 'Delete everything' }).click();
  await expect(page.getByText('All data deleted.')).toBeVisible();

  // The other tab follows: no categories and no purchases left.
  await expect(page2.getByRole('heading', { name: 'Welcome to StockBalance' })).toBeVisible();
  await goTo(page2, 'Settings');
  await page2.getByLabel('Currency conversion fee').fill('0.3');
  const final = await saved(page2);
  expect(final.categories).toEqual([]);
  expect(final.transactions).toEqual([]);
  expect(final.settings.fxFeePercent).toBe(0.3);

  await page.reload();
  await expect(page.getByLabel('Currency conversion fee')).toHaveValue('0.3');
  await page.getByRole('navigation').getByRole('link', { name: 'Portfolio' }).click();
  await expect(page.getByRole('heading', { name: 'Welcome to StockBalance' })).toBeVisible();
  await page2.close();
});

test('"Back up now" after recording on the Invest page saves a backup with the purchase; the reminder stays away', async ({
  page,
}) => {
  await loadSample(page);
  await downloadBackup(page);
  await recordPurchase(page, '10000');
  const data = await saved(page);
  const banner = page.getByRole('status').filter({ hasText: 'Purchase recorded' });
  const downloadPromise = page.waitForEvent('download');
  await banner.getByRole('button', { name: 'Back up now' }).click();
  const file = JSON.parse(readFileSync(await (await downloadPromise).path(), 'utf8')) as Saved;
  await expect(banner).toContainText('Backed up.');
  expect(file.transactions).toEqual(data.transactions);
  expect(file.categories).toEqual(data.categories);

  await goTo(page, 'Portfolio');
  await expectPortfolioMatches(page, data);
  await expect(page.locator('.backup-reminder')).toHaveCount(0);
  await goTo(page, 'Settings');
  await expect(page.getByText(/Last backup from this browser: just now/)).toBeVisible();
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('"Back up now" sends the backup through the share sheet; cancelling it keeps the reminder; the shared file restores', async ({
    page,
  }) => {
    // A share sheet that only takes text files (as some phone browsers do), recording what it was given.
    await page.addInitScript(() => {
      const w = window as unknown as {
        __shares: { name: string; type: string; text: string }[];
        __cancelNext: boolean;
      };
      w.__shares = [];
      w.__cancelNext = false;
      Object.defineProperty(navigator, 'canShare', {
        configurable: true,
        value: (d: { files?: File[] }) => !!d?.files?.length && d.files.every((f) => f.type === 'text/plain'),
      });
      Object.defineProperty(navigator, 'share', {
        configurable: true,
        value: async (d: { files: File[] }) => {
          if (w.__cancelNext) {
            w.__cancelNext = false;
            throw new DOMException('Share canceled', 'AbortError');
          }
          const f = d.files[0];
          w.__shares.push({ name: f.name, type: f.type, text: await f.text() });
        },
      });
    });
    await loadSample(page);
    await recordPurchase(page, '10000');
    await goTo(page, 'Portfolio');
    const reminder = page.locator('.backup-reminder');
    await expect(reminder).toContainText(NEVER_TEXT);

    // The user closes the share sheet without saving: no backup, the reminder stays.
    await page.evaluate(() => ((window as unknown as { __cancelNext: boolean }).__cancelNext = true));
    await reminder.getByRole('button', { name: 'Back up now' }).click();
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __cancelNext: boolean }).__cancelNext))
      .toBe(false);
    await expect(reminder).toContainText(NEVER_TEXT);
    await expect(reminder.locator('.error-text')).toHaveCount(0);

    // Second try: shared as a .txt file with the backup's JSON in it; the reminder goes away.
    await reminder.getByRole('button', { name: 'Back up now' }).click();
    await expect(reminder).toHaveCount(0);
    const shares = await page.evaluate(
      () => (window as unknown as { __shares: { name: string; type: string; text: string }[] }).__shares,
    );
    expect(shares).toHaveLength(1);
    expect(shares[0].name).toMatch(/^stockbalance-backup-\d{4}-\d{2}-\d{2}\.txt$/);
    expect(shares[0].type).toBe('text/plain');
    const data = await saved(page);
    const shared = JSON.parse(shares[0].text) as Saved;
    expect(shared.categories).toEqual(data.categories);
    expect(shared.transactions).toEqual(data.transactions);

    await goTo(page, 'Settings');
    await expect(page.getByRole('button', { name: 'Save or send…' })).toBeVisible();
    await expect(page.getByText(/Last backup from this browser: just now/)).toBeVisible();

    // The shared file restores, with the purchase.
    const file = test.info().outputPath(shares[0].name);
    writeFileSync(file, shares[0].text);
    await page.getByRole('button', { name: 'Delete all data' }).click();
    await page.getByLabel('Type DELETE to confirm').fill('DELETE');
    await page.getByRole('button', { name: 'Delete everything' }).click();
    await expect(page.getByText('All data deleted.')).toBeVisible();
    await restoreBackup(page, file, /3 categories and 1 recorded purchase\./);
    const restored = await saved(page);
    expect(restored.categories).toEqual(data.categories);
    expect(restored.transactions).toEqual(data.transactions);
    await expectPortfolioMatches(page, restored);
  });
});
