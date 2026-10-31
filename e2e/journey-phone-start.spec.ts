import { expect, test, PRICES } from './fixtures';
import type { Locator, Page } from '@playwright/test';

/*
 * Getting started on a phone: a first run, categories made by hand (one with a group whose split
 * isn't equal, set up in the group box) or the sample data, a monthly purchase with whole shares
 * recorded exactly, and then every page — Portfolio totals, the Broker view and each category's
 * own page — must agree with what was bought, also after a reload. No screen may scroll sideways.
 */

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

const RATE = PRICES['ILS=X'];
/** SCHD has no stubbed market price: the user types it in, as on a real phone with no price source. */
const SCHD_PRICE = 27.5;

interface StoredCategory {
  id: string;
  name: string;
  holdings: Record<string, number>;
  cashIls: number;
  targets: { ticker: string; percent: number; group?: string }[];
}
interface StoredData {
  categories: StoredCategory[];
  prices: Record<string, { priceUsd: number; source: string }>;
  fx: { usdIls: number } | null;
  transactions: {
    orders: { ticker: string; shares: number; priceUsd: number }[];
    allocations: { categoryId: string; ticker: string; shares: number; costUsd: number; priceUsd?: number }[];
    cash: { categoryId: string; newMoneyIls: number; spentIls: number }[];
  }[];
}

/** Plan as read from the Invest page. */
interface ReadPlan {
  orders: { ticker: string; shares: number; priceUsd: number; costUsd: number }[];
  /** Category name → its plan card. */
  categories: Record<
    string,
    { budgetIls: number; spentIls: number; leftoverIls: number; buys: Record<string, number> }
  >;
  convertIls: number;
}

// ---------- error watching ----------

let problems: string[] = [];
test.beforeEach(({ page }, testInfo) => {
  // Long journeys: many pages, two reloads.
  testInfo.setTimeout(120_000);
  problems = [];
  page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    // The stubbed market answers 404 for a symbol it doesn't know (as Yahoo does), and refuses the
    // other price sources; the browser logs those network answers as console errors. They are
    // expected answers, not app errors.
    const url = m.location().url ?? '';
    if (/Failed to load resource/.test(m.text()) && /\/api\/yahoo\/|finnhub|frankfurter|open\.er-api/.test(url)) return;
    problems.push(`console error: ${m.text()} (${url})`);
  });
});
test.afterEach(() => {
  expect(problems, 'no page errors or console errors').toEqual([]);
});

// ---------- helpers ----------

/** "$1,234.56" / "₪1,235" / "−₪3.00" → number. */
function money(text: string | null): number {
  const t = (text ?? '').replace(/[\s,$₪]/g, '').replace('−', '-');
  const m = /-?\d+(\.\d+)?/.exec(t);
  if (!m) throw new Error(`no amount in "${text}"`);
  return Number(m[0]);
}
const usd = (n: number, whole = false) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    ...(whole ? { maximumFractionDigits: 0 } : {}),
  }).format(whole ? Math.round(n) : Math.round(n * 100) / 100);
const ils = (n: number, whole = false) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'ILS',
    ...(whole ? { maximumFractionDigits: 0 } : {}),
  }).format(whole ? Math.round(n) : Math.round(n * 100) / 100);
const sharesText = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 4 });

/** Nothing on the page — or in an open dialog — makes it scroll sideways. */
async function expectNoSidewaysScroll(page: Page, where: string) {
  const over = await page.evaluate(() => {
    const out: { what: string; by: number; culprits: string[] }[] = [];
    const vw = document.documentElement.clientWidth;
    const culprits = (root: Element) =>
      [...root.querySelectorAll('*')]
        .filter((el) => {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.right <= vw + 1) return false;
          // Inside a box that scrolls on its own (a wide table), it doesn't move the page — unless it is
          // positioned absolutely, which takes it out of that box.
          if (getComputedStyle(el).position === 'absolute') return true;
          for (let p = el.parentElement; p && p !== root; p = p.parentElement) {
            const ox = getComputedStyle(p).overflowX;
            if (ox === 'auto' || ox === 'scroll' || ox === 'hidden') return false;
          }
          return true;
        })
        .slice(0, 5)
        .map((el) => `${el.tagName.toLowerCase()}.${el.className} "${(el.textContent ?? '').trim().slice(0, 30)}"`);
    const doc = document.scrollingElement!;
    out.push({ what: 'page', by: doc.scrollWidth - doc.clientWidth, culprits: culprits(document.body) });
    for (const el of document.querySelectorAll('.modal-backdrop')) {
      out.push({ what: 'dialog', by: el.scrollWidth - el.clientWidth, culprits: culprits(el) });
    }
    return out;
  });
  for (const o of over) {
    expect
      .soft(o.by, `${where}: the ${o.what} scrolls sideways by ${o.by}px (${o.culprits.join('; ')})`)
      .toBeLessThanOrEqual(0);
  }
}

async function stored(page: Page): Promise<StoredData> {
  return page.evaluate(() => JSON.parse(localStorage.getItem('stockbalance:data')!));
}

function priceOf(data: StoredData, ticker: string): number {
  return data.prices[ticker].priceUsd;
}
function investedUsd(data: StoredData, c: StoredCategory): number {
  return Object.entries(c.holdings).reduce((s, [t, n]) => s + n * priceOf(data, t), 0);
}

async function gotoTab(page: Page, name: 'Portfolio' | 'Invest' | 'Categories' | 'Settings') {
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name, exact: true }).click();
}

function bigNumber(region: Locator, label: string): Locator {
  return region.locator('.grid > div', { has: region.page().getByText(label, { exact: true }) }).locator('.big-number');
}

/** Read the plan shown on the Invest page. */
async function readPlan(page: Page, categoryNames: string[]): Promise<ReadPlan> {
  const orders: ReadPlan['orders'] = [];
  const rows = page.getByRole('region', { name: 'Orders to place' }).locator('tbody tr:not(.excluded-row)');
  const n = await rows.count();
  for (let i = 0; i < n; i++) {
    const cells = rows.nth(i).locator('td');
    orders.push({
      ticker: (await cells.nth(1).textContent())!.trim(),
      shares: Number((await cells.nth(2).textContent())!.replace(/,/g, '')),
      priceUsd: money(await cells.nth(3).textContent()),
      costUsd: money(await cells.nth(4).textContent()),
    });
  }
  const categories: ReadPlan['categories'] = {};
  for (const name of categoryNames) {
    const card = page.getByRole('region', { name: `${name} plan`, exact: true });
    if ((await card.count()) === 0) continue;
    const moneyOf = async (label: string) =>
      money(await card.locator('.plan-money > span', { hasText: label }).textContent());
    const buys: Record<string, number> = {};
    const trs = card.locator('tbody tr');
    for (let i = 0; i < (await trs.count()); i++) {
      const cells = trs.nth(i).locator('td');
      const ticker = (await cells.nth(0).locator('.ticker').textContent())!.trim();
      const buy = (await cells.nth(1).textContent())!.trim();
      if (buy !== '—') buys[ticker] = Number(buy.replace(/,/g, ''));
    }
    categories[name] = {
      budgetIls: await moneyOf('Budget'),
      spentIls: await moneyOf('Buying'),
      leftoverIls: await moneyOf('Left as cash'),
      buys,
    };
  }
  const convert = page
    .getByRole('region', { name: 'What to do' })
    .locator('.headline-items > div', { hasText: '1. Convert' });
  return { orders, categories, convertIls: money(await convert.locator('.big-number').textContent()) };
}

/** The plan is consistent with itself: whole shares, costs, per-category parts and money. */
function checkPlan(plan: ReadPlan) {
  expect(plan.orders.length).toBeGreaterThan(0);
  expect(new Set(plan.orders.map((o) => o.ticker)).size).toBe(plan.orders.length);
  let spentUsd = 0;
  for (const o of plan.orders) {
    expect(Number.isInteger(o.shares), `${o.ticker}: whole shares`).toBe(true);
    expect(o.shares).toBeGreaterThan(0);
    expect(o.priceUsd, `${o.ticker}: the live price`).toBe(PRICES[o.ticker] ?? SCHD_PRICE);
    expect(o.costUsd).toBeCloseTo(o.shares * o.priceUsd, 2);
    spentUsd += o.costUsd;
    // The categories' parts of one order add up to the order.
    const parts = Object.values(plan.categories).reduce((s, c) => s + (c.buys[o.ticker] ?? 0), 0);
    expect(parts, `${o.ticker}: the categories' parts add up to the order`).toBeCloseTo(o.shares, 3);
  }
  expect(plan.convertIls).toBeCloseTo(Math.round(spentUsd * RATE), 0);
  for (const [name, c] of Object.entries(plan.categories)) {
    expect(c.spentIls, `${name} spends at most its budget`).toBeLessThanOrEqual(c.budgetIls + 0.005);
    expect(c.spentIls + c.leftoverIls, `${name}: buying + left = budget`).toBeCloseTo(c.budgetIls, 2);
  }
}

/** Every page shows what is stored, and what is stored is what was bought. */
async function checkAllPagesAgree(page: Page, data: StoredData, newMoney: Record<string, number>) {
  const rate = data.fx!.usdIls;
  expect(rate).toBe(RATE);
  const invested = data.categories.map((c) => investedUsd(data, c));
  const totalInvested = invested.reduce((a, b) => a + b, 0);
  const totalCash = data.categories.reduce((s, c) => s + c.cashIls, 0);

  // Portfolio: the summary and each category's card.
  await gotoTab(page, 'Portfolio');
  await expect(page.getByRole('heading', { level: 1, name: 'Portfolio' })).toBeVisible();
  const summary = page.getByRole('region', { name: 'Summary' });
  await expect(bigNumber(summary, 'Total value')).toHaveText(ils(totalInvested * rate + totalCash, true));
  await expect(bigNumber(summary, 'In stocks')).toHaveText(usd(totalInvested, true));
  await expect(bigNumber(summary, 'Not invested yet')).toHaveText(ils(totalCash, true));
  for (const [i, c] of data.categories.entries()) {
    const card = page.getByRole('region', { name: c.name, exact: true });
    await expect(card.locator('.category-totals')).toContainText(`Stocks ${usd(invested[i])}`);
    if (Math.abs(c.cashIls) >= 0.005)
      await expect(card.locator('.category-totals')).toContainText(`Cash ${ils(c.cashIls)}`);
    else await expect(card.locator('.category-totals')).not.toContainText('Cash');
    for (const [t, n] of Object.entries(c.holdings)) {
      const row = card.locator('table.positions tbody tr:not(.group-row)', {
        has: page.locator('.ticker', { hasText: new RegExp(`^${t}$`) }),
      });
      await expect(row.locator('td').nth(1), `${c.name} ${t} shares on Portfolio`).toHaveText(sharesText(n));
    }
  }
  await expectNoSidewaysScroll(page, 'Portfolio');

  // Broker view: one row per stock, the total of every category's shares.
  await page.locator('.broker-view summary').click();
  const broker = page.locator('.broker-view');
  const tickers = [...new Set(data.categories.flatMap((c) => Object.keys(c.holdings)))].sort();
  await expect(broker.locator('tbody tr')).toHaveCount(tickers.length);
  let brokerTotal = 0;
  for (const t of tickers) {
    const owners = data.categories.filter((c) => (c.holdings[t] ?? 0) > 0);
    const total = owners.reduce((s, c) => s + c.holdings[t], 0);
    const row = broker.locator('tbody tr', { has: page.locator('td.ticker', { hasText: new RegExp(`^${t}$`) }) });
    const cells = row.locator('td');
    await expect(cells.nth(1), `Broker view: total ${t}`).toHaveText(sharesText(total));
    await expect(cells.nth(2)).toHaveText(usd(priceOf(data, t)));
    await expect(cells.nth(3)).toHaveText(usd(total * priceOf(data, t)));
    for (const o of owners) await expect(cells.nth(4)).toContainText(`${o.name} ${sharesText(o.holdings[t])}`);
    brokerTotal += total * priceOf(data, t);
  }
  if (tickers.length === 0) await expect(broker).toContainText("You don't own any shares yet.");
  else await expect(broker.locator('tfoot td').nth(3)).toHaveText(usd(brokerTotal));
  expect(brokerTotal).toBeCloseTo(totalInvested, 6);
  await expectNoSidewaysScroll(page, 'Portfolio with the Broker view open');

  // The Categories page: what each category owns, and its cash.
  await gotoTab(page, 'Categories');
  for (const c of data.categories) {
    const item = page.locator('.category-list > li', { has: page.getByRole('link', { name: c.name, exact: true }) });
    const held = Object.entries(c.holdings).filter(([, n]) => n > 0);
    const owns = held.length > 0 ? held.map(([t, n]) => `${sharesText(n)} ${t}`).join(', ') : 'no shares';
    const cash = Math.abs(c.cashIls) >= 0.005 ? ` · ${ils(c.cashIls)} cash` : '';
    if (held.length > 0 || cash) await expect(item.getByText(/^Owns /)).toHaveText(`Owns ${owns}${cash}`);
  }
  await expectNoSidewaysScroll(page, 'Categories');

  // Each category's own page.
  for (const [i, c] of data.categories.entries()) {
    await gotoTab(page, 'Portfolio');
    await page.getByRole('region', { name: c.name, exact: true }).getByRole('link', { name: c.name }).click();
    await expect(page.getByRole('heading', { level: 1, name: c.name })).toBeVisible();
    const s = page.getByRole('region', { name: 'Summary' });
    await expect(bigNumber(s, 'Total value')).toHaveText(ils(invested[i] * rate + c.cashIls, true));
    await expect(bigNumber(s, 'In stocks')).toHaveText(usd(invested[i], true));
    await expect(bigNumber(s, 'Cash')).toHaveText(ils(c.cashIls, true));
    for (const [t, n] of Object.entries(c.holdings)) {
      const row = page.locator('table.positions tbody tr:not(.group-row)', {
        has: page.locator('.ticker', { hasText: new RegExp(`^${t}$`) }),
      });
      await expect(row.locator('td').nth(1), `${c.name} ${t} shares on its page`).toHaveText(sharesText(n));
    }
    // The donut "Now" shows the stocks' value.
    await expect(page.getByRole('img', { name: /^Now/ })).toBeVisible();

    // Its purchases: what this category got of the recorded purchase.
    const allocations = data.transactions.flatMap((tx) => tx.allocations.filter((a) => a.categoryId === c.id));
    const cash = data.transactions.flatMap((tx) => tx.cash.filter((x) => x.categoryId === c.id));
    const put = cash.reduce((s, x) => s + x.newMoneyIls, 0);
    const spentIls = cash.reduce((s, x) => s + x.spentIls, 0);
    const spentUsd = allocations.reduce((s, a) => s + a.costUsd, 0);
    if (data.transactions.length > 0) {
      expect(put, `${c.name}: the new money recorded`).toBeCloseTo(newMoney[c.name] ?? 0, 2);
      const totals = page.getByRole('region', { name: `${c.name} totals` });
      await expect(bigNumber(totals, 'Money put in')).toHaveText(ils(put, true));
      await expect(bigNumber(totals, 'Spent on stocks')).toHaveText(usd(spentUsd, true));
      await expect(bigNumber(totals, 'Left over')).toHaveText(ils(put - spentIls, true));
      const bought = new Map<string, number>();
      for (const a of allocations) bought.set(a.ticker, (bought.get(a.ticker) ?? 0) + a.shares);
      for (const [t, n] of bought) {
        const paid = data.transactions.flatMap((tx) => tx.orders).find((o) => o.ticker === t)!.priceUsd;
        await expect(totals).toContainText(`${sharesText(n)} ${t} avg ${usd(paid)}`);
      }
      const table = page.getByRole('region', { name: `${c.name} purchases` });
      await expect(table.locator('tbody tr')).toHaveCount(data.transactions.length);
      const last = table.locator('tbody tr').last();
      await expect(last.locator('td').nth(1)).toHaveText(ils(put));
      await expect(last.locator('td').nth(2)).toHaveText(RATE.toFixed(4));
      await expect(last.locator('td').last()).toHaveText(ils(spentIls));
    }
    await expectNoSidewaysScroll(page, `${c.name}'s page`);
  }
}

// ---------- steps of the journeys ----------

/**
 * From the first-run screen, make two categories by hand: Pension (VOO 60%, BND 35% and a group
 * "Corporates" 5% split VTI 60% / AAPL 40% of the group, made in the group box; whatever is left of
 * the money) and Kids (VXUS 80%, SCHD 20%; a fixed ₪1,500 a month). `shares`: what they own now.
 */
async function makeCategoriesByHand(
  page: Page,
  shares: { VOO: string; BND: string; VXUS: string; SCHD: string } | null,
) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Welcome to StockBalance' })).toBeVisible();
  await expectNoSidewaysScroll(page, 'Welcome');

  await page.getByRole('button', { name: 'Set up categories' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Categories' })).toBeVisible();
  await expectNoSidewaysScroll(page, 'Categories (empty)');
  await page.getByRole('button', { name: 'Add your first category' }).click();
  const dialog = page.getByRole('dialog', { name: 'New category' });
  await expect(dialog).toBeVisible();
  await expectNoSidewaysScroll(page, 'New category');
  await dialog.getByLabel('Name').fill('Pension');
  await dialog.getByLabel('Ticker, row 1').fill('voo');
  await dialog.getByLabel('Target percent, row 1').fill('60');
  if (shares) await dialog.getByLabel('Shares owned, row 1').fill(shares.VOO);
  await dialog.getByRole('button', { name: '+ Add stock' }).click();
  await dialog.getByLabel('Ticker, row 2').fill('BND');
  await dialog.getByLabel('Target percent, row 2').fill('35');
  if (shares) await dialog.getByLabel('Shares owned, row 2').fill(shares.BND);
  await expect(dialog.getByText('Targets add up to 95%')).toBeVisible();

  // The group box: the group's name and target first, then its stocks and how it is split.
  await dialog.getByRole('button', { name: '+ Add group' }).click();
  const box = dialog.getByRole('group', { name: /^Group/ });
  await expect(box).toBeVisible();
  await expect(box.getByLabel('Group name, group 1')).toBeFocused();
  await box.getByLabel('Group name, group 1').fill('Corporates');
  await box.getByLabel('Group target percent, group 1').fill('5');
  await box.getByLabel('Ticker, row 3').fill('VTI');
  await box.getByRole('button', { name: '+ Add stock' }).click();
  await box.getByLabel('Ticker, row 4').fill('AAPL');
  // Split equally at first: 50% of the group each, 2.5% of the category.
  await expect(box.getByRole('radio', { name: 'Equally' })).toBeChecked();
  await expect(box.getByText('= 2.5% of the category')).toHaveCount(2);
  await box.getByRole('radio', { name: /My own split/ }).check();
  await expect(box.getByLabel('Share of the group, row 3')).toHaveValue('50');
  await expect(box.getByLabel('Share of the group, row 4')).toHaveValue('50');
  await box.getByLabel('Share of the group, row 3').fill('60');
  await expect(box.getByText('Shares add up to 110%')).toBeVisible();
  await box.getByLabel('Share of the group, row 4').fill('40');
  await expect(box.getByText('Shares add up to 100%')).toBeVisible();
  await expect(box.getByText('= 3% of the category')).toBeVisible();
  await expect(box.getByText('= 2% of the category')).toBeVisible();
  await expect(box.getByText('Category targets add up to 100%')).toBeVisible();
  await expectNoSidewaysScroll(page, 'the group box');
  await box.getByRole('button', { name: 'Done' }).click();
  await expect(box).toBeHidden();
  // Back in the list, the group is one line: its name, target and stocks with their shares.
  await expect(dialog.getByRole('button', { name: 'Corporates', exact: true })).toBeVisible();
  await expect(dialog.getByLabel('Group target percent, group 1')).toHaveValue('5');
  await expect(dialog.getByText('VTI 60% · AAPL 40%')).toBeVisible();
  await expect(dialog.getByText('Targets add up to 100%')).toBeVisible();
  await expectNoSidewaysScroll(page, 'New category with a group');
  await dialog.getByRole('button', { name: 'Save category' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('(VTI 60%, AAPL 40%)')).toBeVisible();

  // Opened again, the group comes back with its own split.
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  const edit = page.getByRole('dialog', { name: 'Edit Pension' });
  await expect(edit.getByText('VTI 60% · AAPL 40%')).toBeVisible();
  await expect(edit.getByLabel('Group target percent, group 1')).toHaveValue('5');
  await edit.getByRole('button', { name: 'Edit group Corporates' }).click();
  const box2 = edit.getByRole('group', { name: 'Group Corporates' });
  await expect(box2.getByRole('radio', { name: /My own split/ })).toBeChecked();
  await expect(box2.getByLabel('Share of the group, row 3')).toHaveValue('60');
  await expect(box2.getByLabel('Share of the group, row 4')).toHaveValue('40');
  await expectNoSidewaysScroll(page, 'the reopened group box');
  await box2.getByRole('button', { name: '‹ All stocks' }).click();
  await edit.getByRole('button', { name: 'Cancel' }).click();
  await expect(edit).toBeHidden();

  // Kids: a fixed ₪1,500 a month, with a stock the market doesn't price (its price is typed in).
  await page.getByRole('button', { name: 'Add category' }).click();
  const kids = page.getByRole('dialog', { name: 'New category' });
  await kids.getByLabel('Name').fill('Kids');
  await kids.getByLabel('Ticker, row 1').fill('VXUS');
  await kids.getByLabel('Target percent, row 1').fill('80');
  if (shares) await kids.getByLabel('Shares owned, row 1').fill(shares.VXUS);
  await kids.getByRole('button', { name: '+ Add stock' }).click();
  await kids.getByLabel('Ticker, row 2').fill('SCHD');
  await kids.getByLabel('Target percent, row 2').fill('20');
  if (shares) await kids.getByLabel('Shares owned, row 2').fill(shares.SCHD);
  await kids.getByLabel('How this category gets money').selectOption('fixed');
  await kids.getByLabel('Fixed amount in ILS').fill('1500');
  await kids.getByRole('button', { name: 'Save category' }).click();
  await expect(kids).toBeHidden();
  await expect(page.getByText('VXUS 80%')).toBeVisible();
  await expectNoSidewaysScroll(page, 'Categories');

  const data = await stored(page);
  expect(data.categories.map((c) => c.name)).toEqual(['Pension', 'Kids']);
  const targets = Object.fromEntries(data.categories[0].targets.map((t) => [t.ticker, t]));
  expect(targets.VOO).toEqual({ ticker: 'VOO', percent: 60 });
  expect(targets.BND).toEqual({ ticker: 'BND', percent: 35 });
  expect(targets.VTI).toMatchObject({ group: 'Corporates' });
  expect(targets.AAPL).toMatchObject({ group: 'Corporates' });
  expect(targets.VTI.percent).toBeCloseTo(3, 9);
  expect(targets.AAPL.percent).toBeCloseTo(2, 9);
  expect(data.categories[0].holdings).toEqual(shares ? { VOO: Number(shares.VOO), BND: Number(shares.BND) } : {});
  expect(data.categories[1].holdings).toEqual(shares ? { VXUS: Number(shares.VXUS), SCHD: Number(shares.SCHD) } : {});

  // Portfolio: the live prices and rate came in; SCHD's price is typed by hand.
  await gotoTab(page, 'Portfolio');
  const market = page.getByRole('region', { name: 'Market data' });
  await expect(market).toContainText('3.6512');
  await expect(market).toContainText('1 missing (SCHD)');
  await expectNoSidewaysScroll(page, 'Portfolio before the SCHD price');
  await page.getByRole('region', { name: 'Kids', exact: true }).getByRole('button', { name: 'enter price' }).click();
  const priceDialog = page.getByRole('dialog', { name: 'Price of SCHD' });
  await priceDialog.getByLabel('Price of SCHD in USD').fill(String(SCHD_PRICE));
  await priceDialog.getByRole('button', { name: 'Save price' }).click();
  await expect(priceDialog).toBeHidden();
  await expect(market).not.toContainText('missing');
}

/** Plan the amount on the Invest page (the split by the rules is checked), and read the plan. */
async function planOnInvestPage(page: Page, amount: string, split: Record<string, string>): Promise<ReadPlan> {
  await gotoTab(page, 'Invest');
  await page.getByLabel('Amount to invest in ILS').fill(amount);
  for (const [name, value] of Object.entries(split))
    await expect(page.getByLabel(`New money for ${name}`)).toHaveValue(value);
  await expect(page.getByRole('region', { name: 'Orders to place' })).toBeVisible();
  await expectNoSidewaysScroll(page, 'Invest with a plan');
  const plan = await readPlan(page, Object.keys(split));
  checkPlan(plan);
  return plan;
}

/** Record exactly what was recommended. */
async function recordExactly(page: Page, plan: ReadPlan) {
  await page
    .getByRole('region', { name: 'Orders to place' })
    .getByRole('button', { name: 'I made a purchase' })
    .click();
  const record = page.getByRole('dialog', { name: 'Record the purchase' });
  await expect(record.getByRole('radio', { name: 'I bought exactly what was recommended' })).toBeChecked();
  for (const o of plan.orders) await expect(record).toContainText(`${o.shares} × ${o.ticker} @ ${usd(o.priceUsd)}`);
  await expectNoSidewaysScroll(page, 'Record the purchase');
  await record.getByRole('button', { name: 'Record purchase' }).click();
  await expect(record).toBeHidden();
  await expect(page.getByRole('status')).toContainText('Purchase recorded');
}

/** What is stored is the holdings from before plus each category's part of the orders, and the money left. */
function checkRecorded(before: StoredData, data: StoredData, plan: ReadPlan, newMoney: Record<string, number>) {
  expect(data.transactions).toHaveLength(before.transactions.length + 1);
  const tx = data.transactions.at(-1)!;
  expect(tx.orders.map((o) => [o.ticker, o.shares, o.priceUsd])).toEqual(
    plan.orders.map((o) => [o.ticker, o.shares, o.priceUsd]),
  );
  for (const c of data.categories) {
    const b = before.categories.find((x) => x.id === c.id)!;
    const p = plan.categories[c.name] ?? { budgetIls: 0, spentIls: 0, leftoverIls: 0, buys: {} };
    for (const t of new Set([...Object.keys(b.holdings), ...Object.keys(c.holdings)])) {
      expect(c.holdings[t] ?? 0, `${c.name} ${t}: before + bought`).toBeCloseTo(
        (b.holdings[t] ?? 0) + (p.buys[t] ?? 0),
        3,
      );
    }
    expect(c.cashIls, `${c.name}: cash = earlier cash + new money − spent`).toBeCloseTo(
      b.cashIls + newMoney[c.name] - p.spentIls,
      2,
    );
    const part = tx.cash.find((x) => x.categoryId === c.id)!;
    expect(part.newMoneyIls).toBe(newMoney[c.name]);
    expect(part.spentIls).toBeCloseTo(p.spentIls, 2);
  }
  for (const o of plan.orders) {
    const total = (d: StoredData) => d.categories.reduce((s, c) => s + (c.holdings[o.ticker] ?? 0), 0);
    expect(total(data), `${o.ticker}: the categories together got the whole order`).toBeCloseTo(
      total(before) + o.shares,
      9,
    );
  }
}

/** After a reload everything is still there, every page still agrees, and nothing is planned again. */
async function reloadAndCheck(page: Page, data: StoredData, newMoney: Record<string, number>) {
  await page.reload();
  await gotoTab(page, 'Portfolio');
  await expect(page.getByRole('region', { name: 'Market data' })).toContainText('3.6512');
  const reloaded = await stored(page);
  expect(reloaded.categories).toEqual(data.categories);
  expect(reloaded.transactions).toEqual(data.transactions);
  await checkAllPagesAgree(page, reloaded, newMoney);
  await gotoTab(page, 'Portfolio');
  await page.locator('.all-purchases > summary').click();
  await expect(page.getByRole('article')).toHaveCount(data.transactions.length);
  // The purchase as recorded: its orders, its total, and each category's part of it.
  const tx = data.transactions.at(-1)!;
  const card = page.getByRole('article').first();
  const totalUsd = tx.orders.reduce((s, o) => s + o.shares * o.priceUsd, 0);
  await expect(card).toContainText(`${usd(totalUsd)} · ${ils(totalUsd * RATE)} at ${RATE.toFixed(4)}`);
  for (const o of tx.orders)
    await expect(card.locator('.tx-orders')).toContainText(`${o.shares} × ${o.ticker} @ ${usd(o.priceUsd)}`);
  await card.getByText('By category').click();
  for (const c of data.categories) {
    const part = tx.cash.find((x) => x.categoryId === c.id)!;
    const row = card.locator('tbody tr', { hasText: c.name });
    const bought = tx.allocations
      .filter((a) => a.categoryId === c.id)
      .map((a) => `${sharesText(a.shares)} ${a.ticker}`);
    await expect(row.locator('td').nth(1)).toHaveText(bought.length > 0 ? bought.join(', ') : '—');
    await expect(row.locator('td').nth(2)).toHaveText(ils(part.newMoneyIls));
    await expect(row.locator('td').nth(3)).toHaveText(ils(part.spentIls));
    const change = part.newMoneyIls - part.spentIls;
    await expect(row.locator('td').nth(4)).toHaveText(`${change < -0.005 ? '−' : '+'}${ils(Math.abs(change))}`);
  }
  await expectNoSidewaysScroll(page, 'All purchases');
  await gotoTab(page, 'Invest');
  await expect(page.getByLabel('Amount to invest in ILS')).toHaveValue('');
  await expect(page.getByText('Enter an amount to see what to buy.')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Orders to place' })).toHaveCount(0);
  await expectNoSidewaysScroll(page, 'Invest after the reload');
  return reloaded;
}

// ---------- the journeys ----------

test('phone, first run by hand: a 60/40 group made in the group box, ₪15,000 in whole shares recorded exactly, and every page agrees, also after a reload', async ({
  page,
}) => {
  await makeCategoriesByHand(page, { VOO: '30', BND: '100', VXUS: '30', SCHD: '40' });

  // Before investing: 30 × $575.30 + 100 × $72.90, and 30 × $66.10 + 40 × $27.50.
  await expect(page.getByRole('region', { name: 'Pension', exact: true }).locator('.category-totals')).toContainText(
    'Stocks $24,549.00',
  );
  await expect(page.getByRole('region', { name: 'Kids', exact: true }).locator('.category-totals')).toContainText(
    'Stocks $3,083.00',
  );
  await expect(bigNumber(page.getByRole('region', { name: 'Summary' }), 'In stocks')).toHaveText('$27,632');
  const before = await stored(page);
  await checkAllPagesAgree(page, before, {});

  // Kids gets its fixed ₪1,500, Pension the rest.
  const plan = await planOnInvestPage(page, '15000', { Pension: '13,500', Kids: '1,500' });
  expect(plan.categories.Pension.budgetIls).toBe(13500);
  expect(plan.categories.Kids.budgetIls).toBe(1500);
  // The Corporates group is far below its 5%: Pension buys both of its stocks.
  expect(Object.keys(plan.categories.Pension.buys)).toEqual(expect.arrayContaining(['VTI', 'AAPL']));
  await expect(page.getByRole('region', { name: 'Pension plan' }).getByText('Corporates')).toHaveCount(2);

  // On a phone the browser often reloads the tab while the user places the orders in the broker's
  // app: the same plan comes back, to be recorded as it was.
  await page.reload();
  await expect(page.getByRole('status').filter({ hasText: 'This is the plan you made' })).toBeVisible();
  await expect(page.getByLabel('Amount to invest in ILS')).toHaveValue('15,000');
  expect(await readPlan(page, ['Pension', 'Kids'])).toEqual(plan);

  // The user looks at "I bought something different" (the planned orders are filled in, and a
  // stock can be added) before choosing "exactly what was recommended".
  await page
    .getByRole('region', { name: 'Orders to place' })
    .getByRole('button', { name: 'I made a purchase' })
    .click();
  const record = page.getByRole('dialog', { name: 'Record the purchase' });
  await record.getByRole('radio', { name: 'I bought something different' }).check();
  for (const o of plan.orders) {
    await expect(record.getByLabel(`Shares of ${o.ticker} bought`)).toHaveValue(String(o.shares));
    await expect(record.getByLabel(`Price paid for ${o.ticker}`)).toHaveValue(String(o.priceUsd));
  }
  await expectNoSidewaysScroll(page, 'Record the purchase: something different');
  await record.getByRole('button', { name: '+ Add a stock I bought instead' }).click();
  await expect(record.getByLabel('Added stock 1', { exact: true })).toBeVisible();
  await expectNoSidewaysScroll(page, 'Record the purchase: something different, with a stock added');
  await record.getByRole('button', { name: 'Remove added stock 1' }).click();
  await record.getByRole('radio', { name: 'I bought exactly what was recommended' }).check();
  await record.getByRole('button', { name: 'Cancel' }).click();
  await expect(record).toBeHidden();
  await recordExactly(page, plan);

  const newMoney = { Pension: 13500, Kids: 1500 };
  const data = await stored(page);
  checkRecorded(before, data, plan, newMoney);
  await checkAllPagesAgree(page, data, newMoney);

  const reloaded = await reloadAndCheck(page, data, newMoney);
  expect(reloaded.prices.SCHD).toMatchObject({ priceUsd: SCHD_PRICE, source: 'manual' });
  await gotoTab(page, 'Categories');
  await expect(page.getByText('(VTI 60%, AAPL 40%)')).toBeVisible();
});

test('phone, first run by hand as a new investor (no shares yet): ₪15,000 in whole shares recorded exactly, and every page agrees, also after a reload', async ({
  page,
}) => {
  await makeCategoriesByHand(page, null);
  await expect(bigNumber(page.getByRole('region', { name: 'Summary' }), 'In stocks')).toHaveText('$0');
  const before = await stored(page);
  await checkAllPagesAgree(page, before, {});

  const plan = await planOnInvestPage(page, '15000', { Pension: '13,500', Kids: '1,500' });
  await recordExactly(page, plan);

  const newMoney = { Pension: 13500, Kids: 1500 };
  const data = await stored(page);
  checkRecorded(before, data, plan, newMoney);
  await checkAllPagesAgree(page, data, newMoney);
  await reloadAndCheck(page, data, newMoney);
});

test('phone, first run with the sample data and a 62.5/37.5 group made in the group box: ₪8,000 in whole shares recorded exactly, and every page agrees, also after a reload', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Welcome to StockBalance' })).toBeVisible();
  await expectNoSidewaysScroll(page, 'Welcome');
  await page.getByRole('button', { name: 'Load sample data' }).click();
  await expect(page.getByRole('region', { name: 'Market data' })).toContainText('3.6512');
  // The live (stubbed) prices replace the sample's (the price column is hidden on a phone).
  await expect.poll(async () => (await stored(page)).prices.VOO.priceUsd).toBe(PRICES.VOO);
  for (const t of ['VOO', 'VXUS', 'BND', 'QQQ', 'GLD', 'AAPL']) expect(priceOf(await stored(page), t)).toBe(PRICES[t]);

  // Pension's VXUS 25% and BND 15% become a group "Abroad" (40%), split 62.5% / 37.5% of the group
  // in the group box, so each keeps its part of the category.
  await gotoTab(page, 'Categories');
  await page.getByRole('button', { name: 'Edit', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Edit Pension' });
  await dialog.getByRole('button', { name: '+ Add group' }).click();
  const box = dialog.getByRole('group', { name: /^Group/ });
  await box.getByLabel('Group name, group 1').fill('Abroad');
  const moveIn = box.getByLabel("Move one of the category's stocks into the group");
  await moveIn.selectOption({ label: 'VXUS (25%)' });
  await box.getByRole('button', { name: 'Move in' }).click();
  await moveIn.selectOption({ label: 'BND (15%)' });
  await box.getByRole('button', { name: 'Move in' }).click();
  await expect(box.getByLabel('Group target percent, group 1')).toHaveValue('40');
  await box.getByRole('radio', { name: /My own split/ }).check();
  await box.getByLabel('Share of the group, row 2').fill('62.5');
  await box.getByLabel('Share of the group, row 3').fill('37.5');
  await expect(box.getByText('Shares add up to 100%')).toBeVisible();
  await expect(box.getByText('= 25% of the category')).toBeVisible();
  await expect(box.getByText('= 15% of the category')).toBeVisible();
  await expectNoSidewaysScroll(page, 'the group box');
  await box.getByRole('button', { name: 'Done' }).click();
  await expect(dialog.getByText('VXUS 62.5% · BND 37.5%')).toBeVisible();
  await expect(dialog.getByText('Targets add up to 100%')).toBeVisible();
  await dialog.getByRole('button', { name: 'Save category' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('(VXUS 62.5%, BND 37.5%)')).toBeVisible();
  const before = await stored(page);
  expect(before.categories[0].targets).toEqual([
    { ticker: 'VOO', percent: 60 },
    { ticker: 'VXUS', percent: 25, group: 'Abroad' },
    { ticker: 'BND', percent: 15, group: 'Abroad' },
  ]);
  await checkAllPagesAgree(page, before, {});

  // Kids: a fixed ₪1,000; Pension: 70% of the remaining ₪7,000; Investments: the rest.
  const plan = await planOnInvestPage(page, '8000', { Pension: '4,900', Kids: '1,000', Investments: '2,100' });
  // Kids also spends the ₪250 left from before.
  expect(plan.categories.Kids.budgetIls).toBe(1250);
  await recordExactly(page, plan);

  const newMoney = { Pension: 4900, Kids: 1000, Investments: 2100 };
  const data = await stored(page);
  checkRecorded(before, data, plan, newMoney);
  await checkAllPagesAgree(page, data, newMoney);
  await reloadAndCheck(page, data, newMoney);
});
