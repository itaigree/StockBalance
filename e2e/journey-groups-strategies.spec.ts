import { expect, test, PRICES } from './fixtures';
import type { Locator, Page } from '@playwright/test';

/*
 * Stock groups and the two buying strategies, on a desktop, starting from the sample data.
 *
 *   1. In the category editor the user builds groups in the group box (equal split and an own split
 *      by shares of the group), moves stocks in and takes them out, renames and removes a group, and
 *      reopens and saves without changes: the stored targets must be exactly what the box showed.
 *   2. On the Invest page, with a group that is above its target (while one of its stocks is below
 *      its own part), the plan is checked for every combination of "Balance all stocks" / "Fewest
 *      orders", whole / fractional shares, max different stocks and a minimum order: orders are the
 *      sum of what the categories get, nothing goes past a target, the group above target gets
 *      nothing, the limits hold, and Fewest orders never needs more orders than Balance.
 *   3. Two categories are merged and one is split; their pages (donut legend, stocks table with the
 *      group's row) must agree with the stored data and the prices, and so must a new plan.
 */

const RATE = PRICES['ILS=X'];
/** AMZN has no stubbed market price: the user types it on the Invest page. */
const AMZN_PRICE = 185;

// ---------- error watching ----------

let problems: string[] = [];
test.beforeEach(({ page }) => {
  problems = [];
  page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    // The stubbed market answers 404 for a symbol it doesn't know (AMZN, as Yahoo does) and refuses
    // the other price sources; the browser logs those network answers. They are not app errors.
    const url = m.location().url ?? '';
    if (/Failed to load resource/.test(m.text()) && /\/api\/yahoo\/|finnhub|frankfurter|open\.er-api/.test(url)) return;
    problems.push(`console error: ${m.text()} (${url})`);
  });
});
test.afterEach(() => {
  expect(problems, 'no page errors or console errors').toEqual([]);
});

// ---------- helpers ----------

const round = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;
/** "$1,234.56" / "₪1,235" / "−₪3.00" → number. */
function money(text: string | null): number {
  const t = (text ?? '').replace(/[\s,$₪+]/g, '').replace('−', '-');
  const m = /-?\d+(\.\d+)?/.exec(t);
  if (!m) throw new Error(`no amount in "${text}"`);
  return Number(m[0]);
}
const num = (text: string | null) => Number((text ?? '').replace(/,/g, '').trim());
const pctText = (n: number, digits = 1) => `${(Math.abs(n) < 1e-9 ? 0 : n).toFixed(digits)}%`;

interface Target {
  ticker: string;
  percent: number;
  group?: string;
}
interface StoredCategory {
  id: string;
  name: string;
  targets: Target[];
  holdings: Record<string, number>;
  cashIls: number;
  contribution: { kind: string };
}
interface StoredData {
  categories: StoredCategory[];
  prices: Record<string, { priceUsd: number; source: string }>;
  fx: { usdIls: number } | null;
  transactions: {
    orders: { ticker: string; shares: number; priceUsd: number }[];
    allocations: { categoryId: string; ticker: string; shares: number; costUsd: number }[];
    cash: { categoryId: string; newMoneyIls: number; spentIls: number }[];
  }[];
}
async function stored(page: Page): Promise<StoredData> {
  return page.evaluate(() => JSON.parse(localStorage.getItem('stockbalance:data')!));
}
async function storedCategory(page: Page, name: string): Promise<StoredCategory> {
  const c = (await stored(page)).categories.find((x) => x.name === name);
  if (!c) throw new Error(`no stored category ${name}`);
  return c;
}

async function gotoTab(page: Page, name: 'Portfolio' | 'Invest' | 'Categories' | 'Settings') {
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name, exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
}

async function loadSample(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Load sample data' }).click();
  await expect(page.getByRole('heading', { name: 'Pension' })).toBeVisible();
  // The stubbed live prices and rate replaced the sample ones.
  await expect(page.getByText('3.6512').first()).toBeVisible();
  await expect
    .poll(async () => {
      const d = await stored(page);
      return ['VOO', 'VXUS', 'BND', 'QQQ', 'GLD', 'AAPL'].every((t) => d.prices[t]?.priceUsd === PRICES[t]);
    })
    .toBe(true);
}

function categoryCard(page: Page, name: string): Locator {
  return page.locator('li.card', { has: page.getByRole('heading', { level: 2, name, exact: true }) });
}

/** Opens the editor of a category from the Categories page; returns the dialog. */
async function openEditor(page: Page, name: string): Promise<Locator> {
  await gotoTab(page, 'Categories');
  await categoryCard(page, name).getByRole('button', { name: 'Edit', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: `Edit ${name}` });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function save(dialog: Locator) {
  await dialog.getByRole('button', { name: 'Save category' }).click();
  await expect(dialog).toBeHidden();
}

/** The value of a text field. */
const valueOf = (l: Locator) => l.inputValue();

// =====================================================================================
// 1. The group box
// =====================================================================================

test('group box: equal and own split, move in, take out, rename, remove, reopen and save unchanged', async ({
  page,
}) => {
  await loadSample(page);

  // --- Pension: VOO 60 · VXUS 25 · BND 15 → VOO 60 · Abroad 40 (VXUS 62.5% / BND 37.5% of the group)
  let dialog = await openEditor(page, 'Pension');
  await dialog.getByRole('button', { name: '+ Add group' }).click();
  let box = dialog.getByRole('group', { name: /^Group/ });
  await box.getByLabel('Group name, group 1').fill('Abroad');
  const moveIn = box.getByLabel("Move one of the category's stocks into the group");
  await moveIn.selectOption({ label: 'VXUS (25%)' });
  await box.getByRole('button', { name: 'Move in' }).click();
  // The new group's blank row went away once a stock was moved in.
  await expect(box.getByLabel(/^Ticker, row/)).toHaveCount(1);
  await expect(box.getByLabel('Group target percent, group 1')).toHaveValue('25');
  await moveIn.selectOption({ label: 'BND (15%)' });
  await box.getByRole('button', { name: 'Move in' }).click();
  await expect(box.getByLabel('Group target percent, group 1')).toHaveValue('40');
  // Their parts differ (25% and 15%), so the group takes its own split and each keeps its part.
  await expect(box.getByRole('radio', { name: /My own split/ })).toBeChecked();
  const shareFields = box.getByLabel(/^Share of the group, row/);
  await expect(shareFields).toHaveCount(2);
  expect(await valueOf(shareFields.nth(0))).toBe('62.5');
  expect(await valueOf(shareFields.nth(1))).toBe('37.5');
  await expect(box.getByText('= 25% of the category')).toBeVisible();
  await expect(box.getByText('= 15% of the category')).toBeVisible();
  await expect(box.getByText('Category targets add up to 100%')).toBeVisible();
  // Split equally: 50% of the group each = 20% of the category each.
  await box.getByRole('radio', { name: 'Equally' }).check();
  await expect(box.getByText('= 20% of the category')).toHaveCount(2);
  await expect(box.getByText('Category targets add up to 100%')).toBeVisible();
  // My own split starts again from the equal shares.
  await box.getByRole('radio', { name: /My own split/ }).check();
  await expect(shareFields).toHaveCount(2);
  expect(await valueOf(shareFields.nth(0))).toBe('50');
  expect(await valueOf(shareFields.nth(1))).toBe('50');
  await shareFields.nth(0).fill('62.5');
  await expect(box.getByText('Shares add up to 112.5%')).toBeVisible();
  await shareFields.nth(1).fill('37.5');
  await expect(box.getByText('Shares add up to 100%')).toBeVisible();
  await expect(box.getByText('= 25% of the category')).toBeVisible();
  await expect(box.getByText('= 15% of the category')).toBeVisible();
  await box.getByRole('button', { name: 'Done' }).click();
  await expect(dialog.getByRole('button', { name: 'Abroad', exact: true })).toBeVisible();
  await expect(dialog.getByText('VXUS 62.5% · BND 37.5%')).toBeVisible();
  await expect(dialog.getByText('Targets add up to 100%')).toBeVisible();
  await save(dialog);
  await expect(categoryCard(page, 'Pension')).toContainText('Abroad 40% (VXUS 62.5%, BND 37.5%)');
  const pension = await storedCategory(page, 'Pension');
  expect(pension.targets).toEqual([
    { ticker: 'VOO', percent: 60 },
    { ticker: 'VXUS', percent: 25, group: 'Abroad' },
    { ticker: 'BND', percent: 15, group: 'Abroad' },
  ]);

  // Reopen: the group comes back with its own split; saving without changes keeps every target.
  dialog = await openEditor(page, 'Pension');
  await expect(dialog.getByText('VXUS 62.5% · BND 37.5%')).toBeVisible();
  await expect(dialog.getByLabel('Group target percent, group 1')).toHaveValue('40');
  await save(dialog);
  expect((await storedCategory(page, 'Pension')).targets).toEqual(pension.targets);
  expect((await storedCategory(page, 'Pension')).holdings).toEqual(pension.holdings);

  // --- Investments: QQQ 50 · VOO 30 · GLD 20, holds AAPL (no target).
  // A group "Single names" 10%, equally AAPL (moved in) and AMZN (a new stock); QQQ goes to 40%.
  dialog = await openEditor(page, 'Investments');
  await dialog.getByLabel('Target percent, row 1').fill('40');
  await dialog.getByRole('button', { name: '+ Add group' }).click();
  box = dialog.getByRole('group', { name: /^Group/ });
  await box.getByLabel('Group name, group 1').fill('Corporates');
  await box.getByLabel('Group target percent, group 1').fill('10');
  // The blank row of the new group gets AMZN; AAPL (held, without a target) is moved in.
  const tickers = box.getByLabel(/^Ticker, row/);
  await tickers.first().fill('amzn');
  await box.getByLabel("Move one of the category's stocks into the group").selectOption({ label: 'AAPL' });
  await box.getByRole('button', { name: 'Move in' }).click();
  await expect(tickers).toHaveCount(2);
  await expect(box.getByLabel('Group target percent, group 1')).toHaveValue('10');
  await expect(box.getByText('= 5% of the category')).toHaveCount(2);
  await expect(box.getByText('Category targets add up to 100%')).toBeVisible();
  // Rename it from the box.
  await box.getByLabel('Group name, group 1').fill('Single names');
  await expect(dialog.getByRole('group', { name: 'Group Single names' })).toBeVisible();
  await box.getByRole('button', { name: '‹ All stocks' }).click();
  await expect(dialog.getByText('AAPL · AMZN')).toBeVisible();
  await save(dialog);
  await expect(categoryCard(page, 'Investments')).toContainText('Single names 10% (AAPL, AMZN)');
  const investments = await storedCategory(page, 'Investments');
  expect(investments.targets).toEqual([
    { ticker: 'QQQ', percent: 40 },
    { ticker: 'VOO', percent: 30 },
    { ticker: 'GLD', percent: 20 },
    { ticker: 'AAPL', percent: 5, group: 'Single names' },
    { ticker: 'AMZN', percent: 5, group: 'Single names' },
  ]);
  expect(investments.holdings).toEqual({ QQQ: 8, VOO: 4, GLD: 6, AAPL: 5 });

  // Reopen and save unchanged.
  dialog = await openEditor(page, 'Investments');
  await expect(dialog.getByText('AAPL · AMZN')).toBeVisible();
  await save(dialog);
  expect((await storedCategory(page, 'Investments')).targets).toEqual(investments.targets);

  // --- Take stocks out (Pension): each keeps its part of the category, the total stays 100%.
  dialog = await openEditor(page, 'Pension');
  await dialog.getByRole('button', { name: 'Edit group Abroad' }).click();
  box = dialog.getByRole('group', { name: 'Group Abroad' });
  await box.getByRole('button', { name: 'Take BND out of the group' }).click();
  await expect(box.getByLabel('Group target percent, group 1')).toHaveValue('25');
  await expect(box.getByLabel(/^Share of the group, row/)).toHaveCount(1);
  expect(await valueOf(box.getByLabel(/^Share of the group, row/))).toBe('100');
  await expect(box.getByText('Category targets add up to 100%')).toBeVisible();
  // Taking out the last stock removes the group and goes back to the list.
  await box.getByRole('button', { name: 'Take VXUS out of the group' }).click();
  await expect(dialog.getByRole('group', { name: /^Group/ })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Edit group Abroad' })).toHaveCount(0);
  await expect(dialog.getByText('Targets add up to 100%')).toBeVisible();
  await save(dialog);
  expect((await storedCategory(page, 'Pension')).targets).toEqual([
    { ticker: 'VOO', percent: 60 },
    { ticker: 'VXUS', percent: 25 },
    { ticker: 'BND', percent: 15 },
  ]);

  // --- Remove a group with ×: its stocks stay held, without a target, and the total must be fixed.
  dialog = await openEditor(page, 'Investments');
  await dialog.getByRole('button', { name: 'Remove group 1' }).click();
  await expect(dialog.getByText('Targets add up to 90%')).toBeVisible();
  await dialog.getByRole('button', { name: 'Save category' }).click();
  await expect(dialog.getByText('Please fix the highlighted fields.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  expect((await storedCategory(page, 'Investments')).targets).toEqual(investments.targets);
});

test('taking a stock out of a group keeps the category total at 100% (Corporates 5%: 62.5% / 37.5%)', async ({
  page,
}) => {
  await loadSample(page);
  // Investments: QQQ 45 · VOO 30 · GLD 20 · Corporates 5% with AAPL 62.5% and AMZN 37.5% of the group.
  let dialog = await openEditor(page, 'Investments');
  await dialog.getByLabel('Target percent, row 1').fill('45');
  await dialog.getByRole('button', { name: '+ Add group' }).click();
  let box = dialog.getByRole('group', { name: /^Group/ });
  await box.getByLabel('Group name, group 1').fill('Corporates');
  await box.getByLabel('Group target percent, group 1').fill('5');
  await box
    .getByLabel(/^Ticker, row/)
    .first()
    .fill('AMZN');
  await box.getByLabel("Move one of the category's stocks into the group").selectOption({ label: 'AAPL' });
  await box.getByRole('button', { name: 'Move in' }).click();
  await box.getByRole('radio', { name: /My own split/ }).check();
  // AAPL (already in the list) comes first, then AMZN.
  await box
    .getByLabel(/^Share of the group, row/)
    .nth(0)
    .fill('62.5');
  await box
    .getByLabel(/^Share of the group, row/)
    .nth(1)
    .fill('37.5');
  await expect(box.getByText('= 3.13% of the category')).toBeVisible();
  await expect(box.getByText('= 1.88% of the category')).toBeVisible();
  await expect(box.getByText('Category targets add up to 100%')).toBeVisible();
  await box.getByRole('button', { name: 'Done' }).click();
  await save(dialog);
  expect((await storedCategory(page, 'Investments')).targets).toEqual([
    { ticker: 'QQQ', percent: 45 },
    { ticker: 'VOO', percent: 30 },
    { ticker: 'GLD', percent: 20 },
    { ticker: 'AAPL', percent: 3.125, group: 'Corporates' },
    { ticker: 'AMZN', percent: 1.875, group: 'Corporates' },
  ]);

  // Take AMZN out: it keeps its part of the category (1.875%, shown rounded) and the group's target
  // goes down by as much, so the category's targets still add up to 100%.
  dialog = await openEditor(page, 'Investments');
  await dialog.getByRole('button', { name: 'Edit group Corporates' }).click();
  box = dialog.getByRole('group', { name: 'Group Corporates' });
  await box.getByRole('button', { name: 'Take AMZN out of the group' }).click();
  // What the user sees first: the category's total did not move.
  await expect(box.getByText(/^Category targets add up to/)).toHaveText('Category targets add up to 100%');
  const groupTarget = Number(await box.getByLabel('Group target percent, group 1').inputValue());
  await box.getByRole('button', { name: 'Done' }).click();
  const amznTarget = Number(await dialog.getByLabel('Target percent, row 5').inputValue());
  expect(round(amznTarget + groupTarget, 6), 'AMZN + Corporates = the 5% Corporates had').toBe(5);
  await expect(dialog.getByText('Targets add up to 100%')).toBeVisible();
  await save(dialog);
  const targets = (await storedCategory(page, 'Investments')).targets;
  expect(
    round(
      targets.reduce((s, t) => s + t.percent, 0),
      6,
    ),
    'stored targets add up to 100%',
  ).toBe(100);
});

test('taking the last stock out of a group removes the group, even after "+ Add stock" left a blank row', async ({
  page,
}) => {
  await loadSample(page);
  const dialog = await openEditor(page, 'Pension');
  await dialog.getByRole('button', { name: '+ Add group' }).click();
  const box = dialog.getByRole('group', { name: /^Group/ });
  await box.getByLabel('Group name, group 1').fill('Abroad');
  await box.getByLabel("Move one of the category's stocks into the group").selectOption({ label: 'VXUS (25%)' });
  await box.getByRole('button', { name: 'Move in' }).click();
  await expect(box.getByLabel('Group target percent, group 1')).toHaveValue('25');
  // A row for another stock, left empty for now…
  await box.getByRole('button', { name: '+ Add stock' }).click();
  await expect(box.getByLabel(/^Ticker, row/)).toHaveCount(2);
  // …then VXUS goes back out: the group has no stocks left, so it goes away.
  await box.getByRole('button', { name: 'Take VXUS out of the group' }).click();
  await expect(dialog.getByRole('group', { name: /^Group/ })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Edit group Abroad' })).toHaveCount(0);
  await expect(dialog.getByText('Targets add up to 100%')).toBeVisible();
  await save(dialog);
  expect((await storedCategory(page, 'Pension')).targets).toEqual([
    { ticker: 'VOO', percent: 60 },
    { ticker: 'VXUS', percent: 25 },
    { ticker: 'BND', percent: 15 },
  ]);
});

test('a stock without a target moved into an own-split group that has no target yet keeps the editor working', async ({
  page,
}) => {
  await loadSample(page);
  // Investments: a new group with AMZN and TSLA split by the user's own shares, before its target is set.
  const dialog = await openEditor(page, 'Investments');
  await dialog.getByLabel('Target percent, row 1').fill('40');
  await dialog.getByRole('button', { name: '+ Add group' }).click();
  const box = dialog.getByRole('group', { name: /^Group/ });
  await box.getByLabel('Group name, group 1').fill('Corporates');
  await box
    .getByLabel(/^Ticker, row/)
    .first()
    .fill('AMZN');
  await box.getByRole('button', { name: '+ Add stock' }).click();
  await box
    .getByLabel(/^Ticker, row/)
    .nth(1)
    .fill('TSLA');
  await box.getByRole('radio', { name: /My own split/ }).check();
  await expect(box.getByText('Shares add up to 100%')).toBeVisible();
  // AAPL is held without a target; moving it in must not break the box (or the page).
  await box.getByLabel("Move one of the category's stocks into the group").selectOption({ label: 'AAPL' });
  await box.getByRole('button', { name: 'Move in' }).click();
  await expect(dialog.getByRole('group', { name: 'Group Corporates' })).toBeVisible();
  // Rows: QQQ 1, VOO 2, GLD 3, AAPL 4 (held), AMZN 5, TSLA 6 — the box lists AAPL, AMZN, TSLA.
  await expect(box.getByLabel(/^Ticker, row/)).toHaveCount(3);
  await expect(box.getByLabel(/^Share of the group, row/)).toHaveCount(3);

  // Then the user sets the group's target and the split, and saves.
  await box.getByLabel('Group target percent, group 1').fill('10');
  await box.getByLabel('Share of the group, row 4').fill('50');
  await box.getByLabel('Share of the group, row 5').fill('30');
  await box.getByLabel('Share of the group, row 6').fill('20');
  await expect(box.getByText('Shares add up to 100%')).toBeVisible();
  await expect(box.getByText('Category targets add up to 100%')).toBeVisible();
  await box.getByRole('button', { name: 'Done' }).click();
  await save(dialog);
  expect((await storedCategory(page, 'Investments')).targets).toEqual([
    { ticker: 'QQQ', percent: 40 },
    { ticker: 'VOO', percent: 30 },
    { ticker: 'GLD', percent: 20 },
    { ticker: 'AAPL', percent: 5, group: 'Corporates' },
    { ticker: 'AMZN', percent: 3, group: 'Corporates' },
    { ticker: 'TSLA', percent: 2, group: 'Corporates' },
  ]);
});

/** Clicks "Save category" and waits until the dialog either closed or showed its error. */
async function trySave(dialog: Locator) {
  await dialog.getByRole('button', { name: 'Save category' }).click();
  await expect(async () => {
    const closed = !(await dialog.isVisible());
    const refused = await dialog.getByText('Please fix the highlighted fields.').isVisible();
    expect(closed || refused).toBe(true);
  }).toPass();
}

test('an unreadable number of shares typed in the group box is not dropped when the box is closed', async ({
  page,
}) => {
  await loadSample(page);
  const dialog = await openEditor(page, 'Pension');
  await dialog.getByRole('button', { name: '+ Add group' }).click();
  const box = dialog.getByRole('group', { name: /^Group/ });
  await box.getByLabel('Group name, group 1').fill('Abroad');
  await box.getByLabel("Move one of the category's stocks into the group").selectOption({ label: 'VXUS (25%)' });
  await box.getByRole('button', { name: 'Move in' }).click();
  // A typo in VXUS's 150 shares: "152,5" can't be read (a comma is only a thousands separator).
  const vxusShares = box.getByLabel(/^Shares owned, row/).first();
  await vxusShares.fill('152,5');
  await expect(vxusShares).toHaveAttribute('aria-invalid', 'true');
  await box.getByRole('button', { name: 'Done' }).click();
  await trySave(dialog);
  // The category must not be saved without VXUS's shares: the editor refuses, like any unreadable number.
  await expect(dialog, 'the save is refused while a number can’t be read').toBeVisible();
  await expect(dialog.getByText('Please fix the highlighted fields.')).toBeVisible();
  expect((await storedCategory(page, 'Pension')).holdings, 'Pension still owns its 150 VXUS').toEqual({
    VOO: 40,
    VXUS: 150,
    BND: 60,
  });
});

test('an unreadable number of shares in the stock list is not lost by opening a group', async ({ page }) => {
  await loadSample(page);
  let dialog = await openEditor(page, 'Pension');
  await dialog.getByRole('button', { name: '+ Add group' }).click();
  let box = dialog.getByRole('group', { name: /^Group/ });
  await box.getByLabel('Group name, group 1').fill('Abroad');
  await box.getByLabel("Move one of the category's stocks into the group").selectOption({ label: 'BND (15%)' });
  await box.getByRole('button', { name: 'Move in' }).click();
  await box.getByRole('button', { name: 'Done' }).click();
  await save(dialog);

  dialog = await openEditor(page, 'Pension');
  // VOO's 40 shares get a typo, then the user looks into the group and comes back.
  const vooShares = dialog.getByLabel('Shares owned, row 1');
  await vooShares.fill('40,5');
  await expect(vooShares).toHaveAttribute('aria-invalid', 'true');
  await dialog.getByRole('button', { name: 'Edit group Abroad' }).click();
  box = dialog.getByRole('group', { name: 'Group Abroad' });
  await box.getByRole('button', { name: 'Done' }).click();
  await expect(dialog.getByLabel('Shares owned, row 1'), 'what the user typed is still there').toHaveValue('40,5');
  await trySave(dialog);
  await expect(dialog, 'the save is refused while a number can’t be read').toBeVisible();
  expect((await storedCategory(page, 'Pension')).holdings, 'Pension still owns its 40 VOO').toEqual({
    VOO: 40,
    VXUS: 150,
    BND: 60,
  });
});

// =====================================================================================
// 2. Plans with groups: both strategies and every option
// =====================================================================================

const NAMES = ['Pension', 'Kids', 'Investments'] as const;
type Name = (typeof NAMES)[number];

/**
 * Pension: VOO 60 · Abroad 40 (VXUS 62.5% / BND 37.5% of the group), and 250 VXUS (typed in the
 * group box), so Abroad is above its target while BND is below its own part.
 * Investments: QQQ 40 · VOO 30 · GLD 20 · Corporates 10 (AAPL and AMZN equally); its 5 AAPL make
 * Corporates above its target too (for small amounts), while AMZN has nothing.
 */
async function setUpGroups(page: Page) {
  let dialog = await openEditor(page, 'Pension');
  await dialog.getByRole('button', { name: '+ Add group' }).click();
  let box = dialog.getByRole('group', { name: /^Group/ });
  await box.getByLabel('Group name, group 1').fill('Abroad');
  const moveIn = box.getByLabel("Move one of the category's stocks into the group");
  await moveIn.selectOption({ label: 'VXUS (25%)' });
  await box.getByRole('button', { name: 'Move in' }).click();
  await moveIn.selectOption({ label: 'BND (15%)' });
  await box.getByRole('button', { name: 'Move in' }).click();
  await box.getByRole('radio', { name: /My own split/ }).check();
  await box
    .getByLabel(/^Share of the group, row/)
    .nth(0)
    .fill('62.5');
  await box
    .getByLabel(/^Share of the group, row/)
    .nth(1)
    .fill('37.5');
  // VXUS is the first stock of the box.
  await box
    .getByLabel(/^Shares owned, row/)
    .nth(0)
    .fill('250');
  await box.getByRole('button', { name: 'Done' }).click();
  await save(dialog);

  dialog = await openEditor(page, 'Investments');
  await dialog.getByLabel('Target percent, row 1').fill('40');
  await dialog.getByRole('button', { name: '+ Add group' }).click();
  box = dialog.getByRole('group', { name: /^Group/ });
  await box.getByLabel('Group name, group 1').fill('Corporates');
  await box.getByLabel('Group target percent, group 1').fill('10');
  await box
    .getByLabel(/^Ticker, row/)
    .first()
    .fill('AMZN');
  await box.getByLabel("Move one of the category's stocks into the group").selectOption({ label: 'AAPL' });
  await box.getByRole('button', { name: 'Move in' }).click();
  await box.getByRole('button', { name: 'Done' }).click();
  await save(dialog);

  const data = await stored(page);
  expect(data.categories.find((c) => c.name === 'Pension')!.targets).toEqual([
    { ticker: 'VOO', percent: 60 },
    { ticker: 'VXUS', percent: 25, group: 'Abroad' },
    { ticker: 'BND', percent: 15, group: 'Abroad' },
  ]);
  expect(data.categories.find((c) => c.name === 'Pension')!.holdings).toEqual({ VOO: 40, VXUS: 250, BND: 60 });
  expect(data.categories.find((c) => c.name === 'Investments')!.targets).toEqual([
    { ticker: 'QQQ', percent: 40 },
    { ticker: 'VOO', percent: 30 },
    { ticker: 'GLD', percent: 20 },
    { ticker: 'AAPL', percent: 5, group: 'Corporates' },
    { ticker: 'AMZN', percent: 5, group: 'Corporates' },
  ]);
}

/** Types AMZN's price on the Invest page, as the market has none. */
async function typeMissingAmznPrice(page: Page) {
  const banner = page.getByRole('alert').filter({ hasText: 'Some prices are missing.' });
  await expect(banner).toBeVisible();
  await banner.getByLabel('Price of AMZN in USD').fill(String(AMZN_PRICE));
  await banner.getByRole('button', { name: 'Use this price' }).click();
  await expect(banner).toBeHidden();
}

interface ShownRow {
  ticker: string;
  group: string;
  buy: number;
  cost: number;
  now: string;
  after: string;
  target: string;
}
interface ShownPlan {
  orders: { ticker: string; shares: number; priceUsd: number; costUsd: number; owners: Record<string, number> }[];
  cats: Record<string, { budgetIls: number; spentIls: number; leftoverIls: number; rows: ShownRow[] }>;
  convertIls: number;
  totalUsd: number;
  warnings: string;
}

/** Everything the Invest page shows about the plan, read from the page. */
async function readPlan(page: Page): Promise<ShownPlan> {
  await expect(page.getByRole('region', { name: 'What to do' })).toBeVisible();
  const raw = await page.evaluate(() => {
    const text = (el: Element | null | undefined) => (el?.textContent ?? '').trim();
    const ordersSection = [...document.querySelectorAll('section')].find(
      (s) => text(s.querySelector('h2')) === 'Orders to place',
    );
    const orders = ordersSection
      ? [...ordersSection.querySelectorAll('tbody tr:not(.excluded-row)')].map((tr) => {
          const td = tr.querySelectorAll('td');
          return {
            ticker: text(td[1]),
            shares: text(td[2]),
            price: text(td[3]),
            cost: text(td[4]),
            owners: [...td[5].querySelectorAll('.owner-chip')].map((c) => text(c)),
          };
        })
      : [];
    const total = ordersSection ? text(ordersSection.querySelector('tfoot td:nth-child(5)')) : '';
    const cats = [...document.querySelectorAll('section[aria-label$=" plan"]')].map((s) => ({
      name: s.getAttribute('aria-label')!.replace(/ plan$/, ''),
      money: [...s.querySelectorAll('.plan-money > span')].map((x) => text(x)),
      rows: [...s.querySelectorAll('tbody tr')].map((tr) => {
        const td = tr.querySelectorAll('td');
        return {
          ticker: text(td[0].querySelector('.ticker')),
          group: text(td[0].querySelector('.small-text')),
          buy: text(td[1]),
          cost: text(td[2]),
          now: text(td[4]),
          after: text(td[5]),
          target: text(td[6]),
        };
      }),
    }));
    const convert = [...document.querySelectorAll('.headline-items > div')].find((d) =>
      text(d).startsWith('1. Convert'),
    );
    const warn = document.querySelector('.banner.warn ul');
    return { orders, total, cats, convert: text(convert?.querySelector('.big-number')), warnings: text(warn) };
  });
  const plan: ShownPlan = {
    orders: raw.orders.map((o) => ({
      ticker: o.ticker,
      shares: num(o.shares),
      priceUsd: money(o.price),
      costUsd: money(o.cost),
      owners: Object.fromEntries(
        o.owners.map((chip) => {
          const m = /^(.*) ([\d,.]+)$/.exec(chip)!;
          return [m[1], num(m[2])];
        }),
      ),
    })),
    cats: {},
    convertIls: raw.convert ? money(raw.convert) : 0,
    totalUsd: raw.total ? money(raw.total) : 0,
    warnings: raw.warnings,
  };
  for (const c of raw.cats) {
    const part = (label: string) => money(c.money.find((m) => m.startsWith(label))!.slice(label.length));
    plan.cats[c.name] = {
      budgetIls: part('Budget'),
      spentIls: part('Buying'),
      leftoverIls: part('Left as cash'),
      rows: c.rows.map((r) => ({
        ticker: r.ticker,
        group: r.group,
        buy: r.buy === '—' ? 0 : num(r.buy),
        cost: r.cost === '' ? 0 : money(r.cost),
        now: r.now,
        after: r.after,
        target: r.target,
      })),
    };
  }
  return plan;
}

interface Options {
  strategy: 'balance' | 'fewest';
  wholeShares: boolean;
  maxTickers: number | null;
  minOrder: number | null;
}

async function setOptions(page: Page, o: Options) {
  const options = page.locator('details.options');
  if (!(await options.evaluate((d) => (d as HTMLDetailsElement).open))) await options.locator('summary').click();
  await options
    .getByRole('radio', { name: o.strategy === 'fewest' ? /^Fewest orders/ : /^Balance all stocks/ })
    .check();
  await options.getByRole('checkbox', { name: 'My broker only sells whole shares' }).setChecked(o.wholeShares);
  await options.getByRole('textbox', { name: /^Minimum order/ }).fill(o.minOrder === null ? '' : String(o.minOrder));
  await options
    .getByRole('textbox', { name: /^Max different stocks/ })
    .fill(o.maxTickers === null ? '' : String(o.maxTickers));
  // The summary line says what the plan below was made with.
  const summary = [
    o.strategy === 'fewest' ? 'Fewest orders' : 'Balance all stocks',
    o.wholeShares ? 'whole shares' : 'fractional shares',
    o.minOrder ? `orders of at least $${o.minOrder.toLocaleString('en-US')}` : 'no minimum order',
    o.maxTickers ? `at most ${o.maxTickers} different stock${o.maxTickers === 1 ? '' : 's'}` : 'any number of stocks',
  ].join(' · ');
  await expect(options.locator('summary')).toContainText(summary);
}

/**
 * The plan as shown must agree with itself, with the prices, the stored categories and the options:
 * orders = the sum of the categories' parts, no category spends more than its budget, nothing is
 * pushed past its target (with whole shares: no stock ends further from its target than before), a
 * group above its target gets nothing, and the order limits hold. Returns the number of different
 * stocks each category buys.
 */
async function checkPlan(
  page: Page,
  plan: ShownPlan,
  o: Options,
  price: Record<string, number>,
  names: readonly string[] = NAMES,
  excluded: readonly string[] = [],
): Promise<Record<string, number>> {
  const data = await stored(page);
  expect(plan.orders.length, 'the plan buys something').toBeGreaterThan(0);
  let spentUsd = 0;
  for (const order of plan.orders) {
    const what = `order ${order.ticker}`;
    if (o.wholeShares) expect(Number.isInteger(order.shares), `${what}: whole shares`).toBe(true);
    expect(order.priceUsd, `${what}: today's price`).toBe(price[order.ticker]);
    expect(order.costUsd, `${what}: cost = shares × price`).toBeCloseTo(order.shares * order.priceUsd, 1);
    if (o.minOrder)
      expect(order.costUsd, `${what}: at least the minimum order`).toBeGreaterThanOrEqual(o.minOrder - 0.01);
    spentUsd += order.costUsd;
    // The order is what the categories get, and the "For" chips say who gets it.
    const parts = names.reduce((s, n) => s + (plan.cats[n]?.rows.find((r) => r.ticker === order.ticker)?.buy ?? 0), 0);
    expect(parts, `${what}: the categories' parts add up to the order`).toBeCloseTo(order.shares, 3);
    for (const n of names) {
      const buy = plan.cats[n]?.rows.find((r) => r.ticker === order.ticker)?.buy ?? 0;
      expect(order.owners[n] ?? 0, `${what}: "For" chip of ${n}`).toBeCloseTo(buy, 4);
    }
  }
  if (o.maxTickers !== null)
    expect(plan.orders.length, 'at most max different stocks').toBeLessThanOrEqual(o.maxTickers);
  expect(plan.totalUsd, 'orders total').toBeCloseTo(spentUsd, 1);
  // Shown in whole shekels (and the costs above in cents).
  expect(Math.abs(plan.convertIls - spentUsd * RATE), 'ILS to convert').toBeLessThanOrEqual(0.6);

  const distinct: Record<string, number> = {};
  for (const name of names) {
    const card = plan.cats[name];
    const cat = data.categories.find((c) => c.name === name)!;
    const what = `${name}`;
    expect(card, `${name} has a plan card`).toBeDefined();
    expect(card.spentIls, `${what} spends at most its budget`).toBeLessThanOrEqual(card.budgetIls + 0.005);
    expect(round(card.spentIls + card.leftoverIls, 2), `${what}: buying + left = budget`).toBeCloseTo(
      card.budgetIls,
      2,
    );
    const bought = card.rows.filter((r) => r.buy > 0);
    distinct[name] = bought.length;
    let cost = 0;
    for (const r of bought) {
      expect(r.cost, `${what} ${r.ticker}: cost = shares × price`).toBeCloseTo(r.buy * price[r.ticker], 1);
      cost += r.cost;
    }
    expect(card.spentIls, `${what}: buying = its buys' cost`).toBeCloseTo(cost * RATE, 0);

    // Units: single stocks and groups. An unticked stock of a group leaves its part to the group's
    // other stocks; any other unticked stock is left out and the other targets scaled up.
    const units = new Map<string, string[]>();
    for (const t of cat.targets)
      units.set(t.group ? `group ${t.group}` : t.ticker, [
        ...(units.get(t.group ? `group ${t.group}` : t.ticker) ?? []),
        t.ticker,
      ]);
    for (const [unit, tickers] of units) if (tickers.every((t) => excluded.includes(t))) units.delete(unit);
    const unitPercent = (tickers: string[]) =>
      cat.targets.filter((t) => tickers.includes(t.ticker)).reduce((s, t) => s + t.percent, 0);
    // Targets as fractions; T = invested now + budget.
    const tsum = [...units.values()].reduce((s, tickers) => s + unitPercent(tickers), 0);
    const valueNow = (t: string) => (cat.holdings[t] ?? 0) * price[t];
    const invested = Object.keys(cat.holdings).reduce((s, t) => s + valueNow(t), 0);
    const T = invested + card.budgetIls / RATE;
    const buyOf = (t: string) => card.rows.find((r) => r.ticker === t)?.buy ?? 0;
    for (const t of excluded) expect(buyOf(t), `${what} does not buy ${t}, which was unticked`).toBe(0);
    for (const [unit, tickers] of units) {
      const w = unitPercent(tickers) / tsum;
      const before = tickers.reduce((s, t) => s + valueNow(t), 0);
      const after = tickers.reduce((s, t) => s + valueNow(t) + buyOf(t) * price[t], 0);
      const buys = tickers.some((t) => buyOf(t) > 0);
      if (!buys) continue;
      const target = w * T;
      expect(before, `${what}: ${unit} was below its target when bought`).toBeLessThan(target);
      if (o.wholeShares) {
        // An extra whole share may pass the target, but never further than it was below it.
        expect(after - target, `${what}: ${unit} ends no further from its target`).toBeLessThanOrEqual(
          target - before + 0.05,
        );
      } else {
        expect(after, `${what}: ${unit} is not pushed past its target`).toBeLessThanOrEqual(target + 0.05);
      }
    }
    // The table shows each stock's target and its weight after buying.
    const investedAfter = Object.keys({
      ...cat.holdings,
      ...Object.fromEntries(bought.map((r) => [r.ticker, 0])),
    }).reduce((s, t) => s + valueNow(t) + buyOf(t) * price[t], 0);
    const allTargets = cat.targets.reduce((s, t) => s + t.percent, 0);
    for (const r of card.rows) {
      const t = cat.targets.find((x) => x.ticker === r.ticker);
      // The category's own targets (not this purchase's, with unticked stocks left out).
      expect(r.target, `${what} ${r.ticker}: target`).toBe(t ? pctText((t.percent / allTargets) * 100) : '—');
      expect(r.group, `${what} ${r.ticker}: group label`).toBe(t?.group ?? '');
      expect(r.after, `${what} ${r.ticker}: weight after`).toBe(
        pctText(((valueNow(r.ticker) + r.buy * price[r.ticker]) / investedAfter) * 100),
      );
      expect(r.now, `${what} ${r.ticker}: weight now`).toBe(pctText((valueNow(r.ticker) / invested) * 100));
    }
  }
  return distinct;
}

test('plans with groups: balance and fewest orders, whole and fractional shares, max stocks and minimum order', async ({
  page,
}) => {
  await loadSample(page);
  await setUpGroups(page);
  const price: Record<string, number> = { ...PRICES, AMZN: AMZN_PRICE };

  await gotoTab(page, 'Invest');
  await page.getByLabel('Amount to invest in ILS').fill('10000');
  await typeMissingAmznPrice(page);
  await expect(page.getByRole('region', { name: 'Orders to place' })).toBeVisible();

  for (const amount of [10000, 30000]) {
    await page.getByLabel('Amount to invest in ILS').fill(String(amount));
    // Pension gets 70% of what is left after Kids' ₪1,000; Investments the rest; Kids adds its ₪250 cash.
    const budgets: Record<Name, number> = {
      Kids: 1250,
      Pension: round((amount - 1000) * 0.7, 2),
      Investments: round((amount - 1000) * 0.3, 2),
    };
    for (const wholeShares of [true, false]) {
      for (const [maxTickers, minOrder] of [
        [null, null],
        [2, null],
        [1, null],
        [null, 500],
        [3, 1000],
      ] as const) {
        const distinct: Partial<Record<Options['strategy'], Record<string, number>>> = {};
        const orderCount: Partial<Record<Options['strategy'], number>> = {};
        for (const strategy of ['balance', 'fewest'] as const) {
          const o: Options = { strategy, wholeShares, maxTickers, minOrder };
          await test.step(`₪${amount}, ${JSON.stringify(o)}`, async () => {
            await setOptions(page, o);
            const plan = await readPlan(page);
            for (const n of NAMES) expect(plan.cats[n].budgetIls, `${n}: budget`).toBeCloseTo(budgets[n], 2);
            distinct[strategy] = await checkPlan(page, plan, o, price);
            orderCount[strategy] = plan.orders.length;
            // Abroad (Pension) is above its target: none of its stocks is bought, although BND is
            // below its own part of the group.
            expect(
              plan.cats.Pension.rows.filter((r) => r.group === 'Abroad' && r.buy > 0),
              'Pension buys nothing in Abroad',
            ).toEqual([]);
          });
        }
        // Fewest orders never buys more different stocks in a category than balancing.
        for (const n of NAMES) {
          expect(
            distinct.fewest![n],
            `₪${amount} ${wholeShares ? 'whole' : 'fractional'} max ${maxTickers} min ${minOrder}: ${n} fewest ≤ balance`,
          ).toBeLessThanOrEqual(distinct.balance![n]);
        }
        expect(orderCount.fewest!).toBeLessThanOrEqual(orderCount.balance!);
      }
    }
  }
});

test('unticking stocks: a grouped stock leaves its part to the group, a single stock to the rest; targets still cap', async ({
  page,
}) => {
  await loadSample(page);
  await setUpGroups(page);
  const price: Record<string, number> = { ...PRICES, AMZN: AMZN_PRICE };
  await gotoTab(page, 'Invest');
  // With ₪30,000 every stock and group below target is filled exactly up to it (fractional shares).
  await page.getByLabel('Amount to invest in ILS').fill('30000');
  await typeMissingAmznPrice(page);
  const o: Options = { strategy: 'balance', wholeShares: false, maxTickers: null, minOrder: null };
  await setOptions(page, o);
  const orders = page.getByRole('region', { name: 'Orders to place' });
  let plan = await readPlan(page);
  await checkPlan(page, plan, o, price);
  expect(plan.orders.map((x) => x.ticker)).toContain('AMZN');

  // Untick AMZN: Corporates keeps its 10%, so its money goes to AAPL — and only up to the group's target.
  await orders.getByRole('checkbox', { name: 'Buy AMZN' }).uncheck();
  await expect(orders.locator('tr.excluded-row', { hasText: 'AMZN' })).toContainText('Skipped this time');
  plan = await readPlan(page);
  await checkPlan(page, plan, o, price, NAMES, ['AMZN']);
  const inv = await storedCategory(page, 'Investments');
  const invested = Object.entries(inv.holdings).reduce((s, [t, n]) => s + n * price[t], 0);
  const T = invested + plan.cats.Investments.budgetIls / RATE;
  const aapl = plan.cats.Investments.rows.find((r) => r.ticker === 'AAPL')!;
  expect(aapl.buy, 'AAPL takes AMZN’s part of Corporates').toBeGreaterThan(0);
  expect(inv.holdings.AAPL * price.AAPL + aapl.cost, 'Corporates reaches its 10% exactly').toBeCloseTo(0.1 * T, 1);

  // Untick VOO too: Pension's only other target is Abroad, which now gets all of Pension's money.
  await orders.getByRole('checkbox', { name: 'Buy VOO' }).uncheck();
  await expect(orders.locator('tr.excluded-row')).toHaveCount(2);
  plan = await readPlan(page);
  await checkPlan(page, plan, o, price, NAMES, ['AMZN', 'VOO']);
  expect(
    plan.cats.Pension.rows.filter((r) => r.group === 'Abroad' && r.buy > 0).length,
    'Pension buys into Abroad now',
  ).toBeGreaterThan(0);
  expect(plan.cats.Pension.spentIls, 'Pension spends its whole budget').toBeCloseTo(plan.cats.Pension.budgetIls, 0);

  // Tick them again: the first plan comes back.
  await orders.getByRole('checkbox', { name: 'Buy VOO' }).check();
  await orders.getByRole('checkbox', { name: 'Buy AMZN' }).check();
  await expect(orders.locator('tr.excluded-row')).toHaveCount(0);
  await checkPlan(page, await readPlan(page), o, price);

  // The same with "Fewest orders" and whole shares (Corporates' small gap buys no AMZN share now):
  // the unticked VOO is not bought, and nothing passes a target.
  const f: Options = { strategy: 'fewest', wholeShares: true, maxTickers: null, minOrder: null };
  await setOptions(page, f);
  plan = await readPlan(page);
  await checkPlan(page, plan, f, price);
  expect(plan.orders.map((x) => x.ticker)).toContain('VOO');
  await orders.getByRole('checkbox', { name: 'Buy VOO' }).uncheck();
  await expect(orders.locator('tr.excluded-row', { hasText: 'VOO' })).toContainText('Skipped this time');
  plan = await readPlan(page);
  await checkPlan(page, plan, f, price, NAMES, ['VOO']);
  // Kids (VOO 80 · BND 20) can only buy BND now. Pension's only other target is Abroad, now its whole
  // target: fewest orders fills one of its stocks (the one furthest below its part), not both.
  expect(plan.cats.Kids.rows.filter((r) => r.buy > 0).map((r) => r.ticker)).toEqual(['BND']);
  const pensionBuys = plan.cats.Pension.rows.filter((r) => r.buy > 0);
  expect(
    pensionBuys.map((r) => r.group),
    'Pension buys one stock, in Abroad',
  ).toEqual(['Abroad']);
  await orders.getByRole('checkbox', { name: 'Buy VOO' }).check();
  await expect(orders.locator('tr.excluded-row')).toHaveCount(0);
});

// =====================================================================================
// 3. Merge and split, then the category pages and a plan
// =====================================================================================

/** Opens a category's own page from the Categories page. */
async function openCategoryPage(page: Page, name: string) {
  await gotoTab(page, 'Categories');
  await categoryCard(page, name).getByRole('link', { name, exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
}

/**
 * A category's page agrees with its stored holdings, targets and the prices: the summary, the two
 * donuts and their legend (with each grouped stock's group), and the stocks table with its group row.
 */
async function checkCategoryPage(page: Page, name: string, price: Record<string, number>) {
  const cat = await storedCategory(page, name);
  await openCategoryPage(page, name);
  const tsum = cat.targets.reduce((s, t) => s + t.percent, 0);
  const targetTickers = cat.targets.map((t) => t.ticker);
  const tickers = [
    ...targetTickers,
    ...Object.keys(cat.holdings)
      .filter((t) => !targetTickers.includes(t) && cat.holdings[t] !== 0)
      .sort(),
  ];
  const value = (t: string) => (cat.holdings[t] ?? 0) * price[t];
  const invested = tickers.reduce((s, t) => s + value(t), 0);
  const nowPct = (t: string) => (value(t) / invested) * 100;
  const targetPct = (t: string) => ((cat.targets.find((x) => x.ticker === t)?.percent ?? 0) / tsum) * 100;
  const usd0 = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;

  const summary = page.getByRole('region', { name: 'Summary' });
  await expect(summary.locator('.grid > div', { hasText: 'In stocks' }).locator('.big-number')).toHaveText(
    usd0(invested),
  );

  // Donuts: same stocks, same order, now and target.
  const shown = tickers.filter((t) => value(t) > 0 || targetPct(t) > 0);
  expect(shown.length, 'at most six slices: no "Other" in this test').toBeLessThanOrEqual(6);
  await expect(page.getByRole('img', { name: /^Now:/ })).toHaveAttribute(
    'aria-label',
    `Now: ${shown
      .filter((t) => value(t) > 0)
      .map((t) => `${t} ${pctText(nowPct(t))}`)
      .join(', ')}`,
  );
  await expect(page.getByRole('img', { name: /^Target:/ })).toHaveAttribute(
    'aria-label',
    `Target: ${shown
      .filter((t) => targetPct(t) > 0)
      .map((t) => `${t} ${pctText(targetPct(t))}`)
      .join(', ')}`,
  );
  const legend = page.locator('table.donut-legend tbody tr');
  await expect(legend).toHaveText(
    shown.map((t) => {
      const group = cat.targets.find((x) => x.ticker === t)?.group;
      return new RegExp(
        `^${t}${group ? ` · ${group}` : ''}\\s*${pctText(nowPct(t)).replace('.', '\\.')}\\s*${targetPct(t) > 0 ? pctText(targetPct(t)).replace('.', '\\.') : '—'}$`,
      );
    }),
  );

  // Stocks table: one row per stock, and a row for each group (its value, weight and target summed).
  const rows = page.locator('table.positions tbody tr');
  const expected: RegExp[] = [];
  const groupsDone = new Set<string>();
  const usd2 = (n: number) =>
    `\\$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace('.', '\\.')}`;
  const pp = (n: number) => {
    const r = Number(n.toFixed(1));
    return r === 0 ? '0\\.0 pp' : `${r > 0 ? '\\+' : '−'}${Math.abs(r).toFixed(1).replace('.', '\\.')} pp`;
  };
  for (const t of tickers) {
    const group = cat.targets.find((x) => x.ticker === t)?.group;
    if (group && !groupsDone.has(group)) {
      groupsDone.add(group);
      const members = cat.targets.filter((x) => x.group === group).map((x) => x.ticker);
      const v = members.reduce((s, m) => s + value(m), 0);
      const w = members.reduce((s, m) => s + nowPct(m), 0);
      const tp = members.reduce((s, m) => s + targetPct(m), 0);
      expected.push(
        new RegExp(
          `^${group}\\s*group\\s*${usd2(v)}\\s*${pctText(w).replace('.', '\\.')}\\s*${pctText(tp).replace('.', '\\.')}\\s*${pp(w - tp)}$`,
        ),
      );
    }
    const isTarget = targetPct(t) > 0;
    const shares = (cat.holdings[t] ?? 0).toLocaleString('en-US', { maximumFractionDigits: 4 });
    expected.push(
      new RegExp(
        `^${t}${isTarget ? '' : ' not a target'}\\s*${shares.replace('.', '\\.')}\\s*${usd2(price[t])}(manual)?\\s*${usd2(value(t))}\\s*${pctText(nowPct(t)).replace('.', '\\.')}\\s*${
          isTarget ? pctText(targetPct(t)).replace('.', '\\.') : '—'
        }\\s*${isTarget ? pp(nowPct(t) - targetPct(t)) : '—'}$`,
      ),
    );
  }
  await expect(rows).toHaveText(expected);
}

test('merge and split categories with groups: category pages and the plan agree with the data', async ({ page }) => {
  await loadSample(page);
  await setUpGroups(page);
  const price: Record<string, number> = { ...PRICES, AMZN: AMZN_PRICE };
  // AMZN has no market price: type it on Investments' page.
  await openCategoryPage(page, 'Investments');
  await page.locator('table.positions tr', { hasText: 'AMZN' }).getByRole('button', { name: 'Enter price' }).click();
  const priceDialog = page.getByRole('dialog', { name: 'Price of AMZN' });
  await priceDialog.getByLabel('Price of AMZN in USD').fill(String(AMZN_PRICE));
  await priceDialog.getByRole('button', { name: 'Save price' }).click();
  await expect(priceDialog).toBeHidden();
  await expect(page.locator('table.positions tr', { hasText: 'AMZN' })).toContainText('$185.00manual');

  // Merge Kids into Pension, keeping Pension's targets (with its group).
  await gotoTab(page, 'Categories');
  await categoryCard(page, 'Kids').getByRole('button', { name: 'Merge' }).click();
  let dialog = page.getByRole('dialog', { name: 'Merge Kids' });
  await dialog.getByRole('combobox', { name: 'Merge with' }).selectOption({ label: 'Pension' });
  await dialog.getByRole('radio', { name: 'Pension' }).check();
  await expect(dialog.getByRole('textbox', { name: 'Name of the merged category' })).toHaveValue('Pension');
  await expect(dialog.getByText('will own 43.5 VOO, 250 VXUS, 65 BND and ₪250.00 cash')).toBeVisible();
  await dialog.getByRole('button', { name: 'Merge', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('status')).toHaveText('Kids and Pension were merged into Pension.');
  let pension = await storedCategory(page, 'Pension');
  expect((await stored(page)).categories.map((c) => c.name)).toEqual(['Pension', 'Investments']);
  expect(pension.holdings).toEqual({ VOO: 43.5, VXUS: 250, BND: 65 });
  expect(pension.cashIls).toBe(250);
  expect(pension.targets).toEqual([
    { ticker: 'VOO', percent: 60 },
    { ticker: 'VXUS', percent: 25, group: 'Abroad' },
    { ticker: 'BND', percent: 15, group: 'Abroad' },
  ]);
  await checkCategoryPage(page, 'Pension', price);

  // Split half of Pension off into "Pension B", with the same targets (the group comes along).
  await gotoTab(page, 'Categories');
  await categoryCard(page, 'Pension').getByRole('button', { name: 'Split' }).click();
  dialog = page.getByRole('dialog', { name: 'Split Pension' });
  await dialog.getByRole('textbox', { name: 'Name of the new category' }).fill('Pension B');
  await dialog.getByLabel('Percent to move').fill('50');
  await dialog.getByRole('button', { name: 'Move this % of everything' }).click();
  await expect(dialog.getByLabel('Shares of VOO to move')).toHaveValue('21.75');
  await expect(dialog.getByLabel('Cash to move')).toHaveValue('125');
  await dialog.getByRole('button', { name: 'Split', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('status')).toHaveText('Pension B was split off from Pension.');
  pension = await storedCategory(page, 'Pension');
  const pensionB = await storedCategory(page, 'Pension B');
  expect((await stored(page)).categories.map((c) => c.name)).toEqual(['Pension', 'Pension B', 'Investments']);
  expect(pension.holdings).toEqual({ VOO: 21.75, VXUS: 125, BND: 32.5 });
  expect(pensionB.holdings).toEqual({ VOO: 21.75, VXUS: 125, BND: 32.5 });
  expect(pension.cashIls).toBe(125);
  expect(pensionB.cashIls).toBe(125);
  expect(pensionB.targets).toEqual(pension.targets);
  expect(pensionB.contribution).toEqual({ kind: 'none' });
  await expect(categoryCard(page, 'Pension B')).toContainText('Abroad 40% (VXUS 62.5%, BND 37.5%)');
  await checkCategoryPage(page, 'Pension', price);
  await checkCategoryPage(page, 'Pension B', price);
  await checkCategoryPage(page, 'Investments', price);

  // A plan for the three: Pension B gets ₪2,000 typed for this purchase.
  await gotoTab(page, 'Invest');
  await page.getByLabel('Amount to invest in ILS').fill('12000');
  await page.getByLabel('New money for Pension B', { exact: true }).fill('2000');
  const names = ['Pension', 'Pension B', 'Investments'];
  for (const strategy of ['balance', 'fewest'] as const) {
    for (const wholeShares of [true, false]) {
      const o: Options = { strategy, wholeShares, maxTickers: null, minOrder: null };
      await test.step(JSON.stringify(o), async () => {
        await setOptions(page, o);
        const plan = await readPlan(page);
        // Pension: 70% of ₪12,000 + ₪125 cash; Investments: the other 30%; Pension B: ₪2,000 + ₪125.
        expect(plan.cats.Pension.budgetIls).toBeCloseTo(8525, 2);
        expect(plan.cats['Pension B'].budgetIls).toBeCloseTo(2125, 2);
        expect(plan.cats.Investments.budgetIls).toBeCloseTo(3600, 2);
        await checkPlan(page, plan, o, price, names);
      });
    }
  }

  // Record it exactly as planned (fractional, fewest orders) and check the pages again.
  const plan = await readPlan(page);
  const before = await stored(page);
  await page.getByRole('button', { name: 'I made a purchase' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Record purchase' }).click();
  await expect(page.getByText(/Purchase recorded/)).toBeVisible();
  const after = await stored(page);
  expect(after.transactions).toHaveLength(1);
  for (const n of names) {
    const b = before.categories.find((c) => c.name === n)!;
    const a = after.categories.find((c) => c.name === n)!;
    for (const r of plan.cats[n].rows) {
      expect(a.holdings[r.ticker] ?? 0, `${n} ${r.ticker}: holdings after the purchase`).toBeCloseTo(
        (b.holdings[r.ticker] ?? 0) + r.buy,
        3,
      );
    }
    expect(a.cashIls, `${n}: cash after the purchase`).toBeCloseTo(plan.cats[n].leftoverIls, 2);
    await checkCategoryPage(page, n, price);
  }
});
