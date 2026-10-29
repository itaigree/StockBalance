import { expect, test, PRICES } from './fixtures';
import type { Locator, Page } from '@playwright/test';

/*
 * Several months of investing on a desktop, starting from the sample data:
 *
 *   June    — a purchase where Pension's amount is typed and Investments gets "The rest";
 *   July    — a purchase with BND unticked in the orders list;
 *   August  — "I made a purchase" with what was really bought: other shares and prices, another
 *             exchange rate, and an added stock (SCHD, which has no market price, so the user types
 *             it) for Investments.
 *
 * After each purchase the test keeps its own book of what every category should own and how much
 * cash it should have (from what the Invest page showed and what was typed). Each category's page —
 * its purchase table, totals and positions — the Portfolio page and "All purchases" must agree with
 * that book. Then the middle purchase is undone from "All purchases", and everything is checked
 * again, also after a reload.
 */

const RATE = PRICES['ILS=X'];
/** SCHD has no stubbed price: the price paid is typed when recording, today's price on Portfolio. */
const SCHD_PAID = 27.5;
const SCHD_TODAY = 27.9;
const NAMES = ['Pension', 'Kids', 'Investments'] as const;
type Name = (typeof NAMES)[number];
const ID: Record<Name, string> = { Pension: 'sample-pension', Kids: 'sample-kids', Investments: 'sample-investments' };

// Dates and amounts are read as an en-US browser shows them.
test.use({ locale: 'en-US' });

// ---------- error watching ----------

let problems: string[] = [];
test.beforeEach(({ page }) => {
  problems = [];
  page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    // The stubbed market answers 404 for a symbol it doesn't know (SCHD, as Yahoo does) and refuses
    // the other price sources; the browser logs those network answers. They are not app errors.
    const url = m.location().url ?? '';
    if (/Failed to load resource/.test(m.text()) && /\/api\/yahoo\/|finnhub|frankfurter|open\.er-api/.test(url)) return;
    problems.push(`console error: ${m.text()} (${url})`);
  });
});
test.afterEach(() => {
  expect(problems, 'no page errors or console errors').toEqual([]);
});

// ---------- formatting, as the app shows numbers ----------

/** "$1,234.56" / "₪1,235" / "−₪3.00" / "+₪3.00" → number. */
function money(text: string | null): number {
  const t = (text ?? '').replace(/[\s,$₪+]/g, '').replace('−', '-');
  const m = /-?\d+(\.\d+)?/.exec(t);
  if (!m) throw new Error(`no amount in "${text}"`);
  return Number(m[0]);
}
const round = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;
const usd = (n: number, whole = false) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    ...(whole ? { maximumFractionDigits: 0 } : {}),
  }).format(whole ? Math.round(n) : round(n, 2));
const ils = (n: number, whole = false) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'ILS',
    ...(whole ? { maximumFractionDigits: 0 } : {}),
  }).format(whole ? Math.round(n) : round(n, 2));
const sharesText = (n: number) => (Math.abs(n) < 1e-9 ? 0 : n).toLocaleString('en-US', { maximumFractionDigits: 4 });
const num = (text: string | null) => Number((text ?? '').replace(/,/g, '').trim());
const dateText = (ymd: string) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d, 12).toLocaleDateString('en-US', { dateStyle: 'medium' });
};

// ---------- the test's own book ----------

interface Part {
  shares: number;
  priceUsd: number;
  costUsd: number;
}
interface Purchase {
  date: string;
  note?: string;
  usdIls: number;
  feePercent: number;
  orders: { ticker: string; shares: number; priceUsd: number }[];
  newMoney: Record<Name, number>;
  /** What each category got: ticker → part; and what it cost in ILS (with the fee). */
  parts: Record<Name, { buys: Record<string, Part>; spentIls: number }>;
}
type Book = Record<Name, { holdings: Record<string, number>; cash: number }>;

function initialBook(): Book {
  return {
    Pension: { holdings: { VOO: 40, VXUS: 150, BND: 60 }, cash: 0 },
    Kids: { holdings: { VOO: 3.5, BND: 5 }, cash: 250 },
    Investments: { holdings: { QQQ: 8, VOO: 4, GLD: 6, AAPL: 5 }, cash: 0 },
  };
}
function bookAfter(purchases: Purchase[]): Book {
  const book = initialBook();
  for (const p of purchases) {
    for (const name of NAMES) {
      const c = book[name];
      for (const [t, part] of Object.entries(p.parts[name].buys)) c.holdings[t] = (c.holdings[t] ?? 0) + part.shares;
      c.cash = round(c.cash + p.newMoney[name] - p.parts[name].spentIls, 2);
    }
  }
  return book;
}

// ---------- stored data ----------

interface StoredData {
  categories: { id: string; name: string; holdings: Record<string, number>; cashIls: number }[];
  prices: Record<string, { priceUsd: number; source: string }>;
  fx: { usdIls: number } | null;
  transactions: {
    id: string;
    date: string;
    usdIls: number;
    fxFeePercent: number;
    orders: { ticker: string; shares: number; priceUsd: number }[];
    allocations: { categoryId: string; ticker: string; shares: number; costUsd: number; priceUsd?: number }[];
    cash: { categoryId: string; newMoneyIls: number; spentIls: number }[];
  }[];
}
async function stored(page: Page): Promise<StoredData> {
  return page.evaluate(() => JSON.parse(localStorage.getItem('stockbalance:data')!));
}
/** The saved data once it shows `ready` (the app saves right after a change is shown). */
async function storedWhen(page: Page, ready: (d: StoredData) => boolean): Promise<StoredData> {
  await expect.poll(async () => ready(await stored(page)), { message: 'the change is saved' }).toBe(true);
  return stored(page);
}
const purchasesSaved = (page: Page, n: number) => storedWhen(page, (d) => d.transactions.length === n);

/** The stored data is the book: holdings, cash, and every purchase's parts and cash. */
function checkStored(data: StoredData, purchases: Purchase[]) {
  const book = bookAfter(purchases);
  expect(data.transactions).toHaveLength(purchases.length);
  for (const name of NAMES) {
    const c = data.categories.find((x) => x.id === ID[name])!;
    const tickers = new Set([...Object.keys(c.holdings), ...Object.keys(book[name].holdings)]);
    for (const t of tickers) {
      expect(c.holdings[t] ?? 0, `${name} ${t}: stored shares`).toBeCloseTo(book[name].holdings[t] ?? 0, 3);
    }
    expect(c.cashIls, `${name}: stored cash`).toBeCloseTo(book[name].cash, 1);
  }
  // Stored data is consistent with itself, exactly: holdings = sample + every purchase's parts.
  const start = initialBook();
  for (const name of NAMES) {
    const c = data.categories.find((x) => x.id === ID[name])!;
    const expected: Record<string, number> = { ...start[name].holdings };
    let cash = start[name].cash;
    for (const tx of data.transactions) {
      for (const a of tx.allocations.filter((x) => x.categoryId === ID[name]))
        expected[a.ticker] = (expected[a.ticker] ?? 0) + a.shares;
      for (const x of tx.cash.filter((y) => y.categoryId === ID[name])) cash += x.newMoneyIls - x.spentIls;
    }
    for (const t of new Set([...Object.keys(expected), ...Object.keys(c.holdings)])) {
      expect(c.holdings[t] ?? 0, `${name} ${t}: holdings = sample + purchases`).toBeCloseTo(expected[t] ?? 0, 8);
    }
    expect(c.cashIls, `${name}: cash = sample + purchases`).toBeCloseTo(cash, 6);
  }
  for (const [i, tx] of data.transactions.entries()) {
    const p = purchases[i];
    expect(tx.usdIls).toBe(p.usdIls);
    expect(tx.fxFeePercent).toBe(p.feePercent);
    expect(tx.orders.map((o) => [o.ticker, o.shares, o.priceUsd])).toEqual(
      p.orders.map((o) => [o.ticker, o.shares, o.priceUsd]),
    );
    // The parts of each order add up to the order, in shares and in dollars.
    for (const o of tx.orders) {
      const parts = tx.allocations.filter((a) => a.ticker === o.ticker && a.priceUsd === o.priceUsd);
      expect(
        parts.reduce((s, a) => s + a.shares, 0),
        `${o.ticker}: parts add up`,
      ).toBeCloseTo(o.shares, 9);
      expect(
        parts.reduce((s, a) => s + a.costUsd, 0),
        `${o.ticker}: costs add up`,
      ).toBeCloseTo(o.shares * o.priceUsd, 6);
    }
    for (const name of NAMES) {
      const cash = tx.cash.find((x) => x.categoryId === ID[name]);
      expect(cash?.newMoneyIls ?? 0, `purchase ${i + 1}, ${name}: new money`).toBeCloseTo(p.newMoney[name], 2);
      expect(cash?.spentIls ?? 0, `purchase ${i + 1}, ${name}: spent`).toBeCloseTo(p.parts[name].spentIls, 1);
      const spentUsd = tx.allocations.filter((a) => a.categoryId === ID[name]).reduce((s, a) => s + a.costUsd, 0);
      expect(cash?.spentIls ?? 0, `purchase ${i + 1}, ${name}: spent ILS = USD × rate with fee`).toBe(
        round(spentUsd * tx.usdIls * (1 + tx.fxFeePercent / 100), 2),
      );
    }
  }
}

// ---------- reading the app ----------

async function gotoTab(page: Page, name: 'Portfolio' | 'Invest' | 'Categories' | 'Settings') {
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name, exact: true }).click();
  if (name !== 'Categories') await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
}

function bigNumber(region: Locator, label: string): Locator {
  return region.locator('.grid > div', { has: region.page().getByText(label, { exact: true }) }).locator('.big-number');
}

/** New money and "to invest now" of each category in the split table. */
async function readSplit(page: Page): Promise<Record<Name, { newMoney: number; budget: number }>> {
  const out = {} as Record<Name, { newMoney: number; budget: number }>;
  for (const name of NAMES) {
    const field = page.getByLabel(`New money for ${name}`, { exact: true });
    const text = await field.evaluate((el) => (el instanceof HTMLInputElement ? el.value : el.textContent));
    const row = page.locator('table.split-table tbody tr', { has: page.getByText(name, { exact: true }) });
    out[name] = { newMoney: money(text), budget: money(await row.locator('td').last().textContent()) };
  }
  return out;
}

interface ReadPlan {
  orders: { ticker: string; shares: number; priceUsd: number; costUsd: number }[];
  categories: Record<Name, { budgetIls: number; spentIls: number; leftoverIls: number; buys: Record<string, Part> }>;
  convertIls: number;
}
async function readPlan(page: Page): Promise<ReadPlan> {
  const orders: ReadPlan['orders'] = [];
  const rows = page.getByRole('region', { name: 'Orders to place' }).locator('tbody tr:not(.excluded-row)');
  for (let i = 0; i < (await rows.count()); i++) {
    const cells = rows.nth(i).locator('td');
    orders.push({
      ticker: (await cells.nth(1).textContent())!.trim(),
      shares: num(await cells.nth(2).textContent()),
      priceUsd: money(await cells.nth(3).textContent()),
      costUsd: money(await cells.nth(4).textContent()),
    });
  }
  const categories = {} as ReadPlan['categories'];
  for (const name of NAMES) {
    const card = page.getByRole('region', { name: `${name} plan`, exact: true });
    await expect(card).toBeVisible();
    const moneyOf = async (label: string) =>
      money(await card.locator('.plan-money > span', { hasText: label }).textContent());
    const buys: Record<string, Part> = {};
    const trs = card.locator('tbody tr');
    for (let i = 0; i < (await trs.count()); i++) {
      const cells = trs.nth(i).locator('td');
      const ticker = (await cells.nth(0).locator('.ticker').textContent())!.trim();
      const buy = (await cells.nth(1).textContent())!.trim();
      if (buy !== '—') {
        buys[ticker] = { shares: num(buy), priceUsd: PRICES[ticker], costUsd: money(await cells.nth(2).textContent()) };
      }
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

/** The plan agrees with itself and with the split table. */
function checkPlan(plan: ReadPlan, split: Record<Name, { newMoney: number; budget: number }>, feePercent: number) {
  expect(plan.orders.length).toBeGreaterThan(0);
  let spentUsd = 0;
  for (const o of plan.orders) {
    expect(Number.isInteger(o.shares), `${o.ticker}: whole shares`).toBe(true);
    expect(o.priceUsd, `${o.ticker}: today's price`).toBe(PRICES[o.ticker]);
    expect(o.costUsd).toBeCloseTo(o.shares * o.priceUsd, 2);
    spentUsd += o.costUsd;
    const parts = NAMES.reduce((s, n) => s + (plan.categories[n].buys[o.ticker]?.shares ?? 0), 0);
    expect(parts, `${o.ticker}: the categories' parts add up to the order`).toBeCloseTo(o.shares, 3);
  }
  expect(plan.convertIls).toBeCloseTo(Math.round(spentUsd * RATE * (1 + feePercent / 100)), 0);
  for (const name of NAMES) {
    const c = plan.categories[name];
    expect(c.budgetIls, `${name}: plan budget = "to invest now"`).toBeCloseTo(split[name].budget, 2);
    expect(c.spentIls, `${name} spends at most its budget`).toBeLessThanOrEqual(c.budgetIls + 0.005);
    expect(round(c.spentIls + c.leftoverIls, 2), `${name}: buying + left = budget`).toBeCloseTo(c.budgetIls, 2);
    const cost = Object.values(c.buys).reduce((s, b) => s + b.costUsd, 0);
    expect(c.spentIls, `${name}: buying (₪) = its buys' cost`).toBeCloseTo(cost * RATE * (1 + feePercent / 100), 0);
  }
}

/** A recorded-as-planned purchase in the book. */
function purchaseFromPlan(
  plan: ReadPlan,
  split: Record<Name, { newMoney: number }>,
  date: string,
  feePercent: number,
): Purchase {
  return {
    date,
    usdIls: RATE,
    feePercent,
    orders: plan.orders.map((o) => ({ ticker: o.ticker, shares: o.shares, priceUsd: o.priceUsd })),
    newMoney: Object.fromEntries(NAMES.map((n) => [n, split[n].newMoney])) as Record<Name, number>,
    parts: Object.fromEntries(
      NAMES.map((n) => [n, { buys: plan.categories[n].buys, spentIls: plan.categories[n].spentIls }]),
    ) as Purchase['parts'],
  };
}

/** After recording a plan as it was, each category's cash is what the plan said would be left. */
function checkCashIsPlannedLeftover(data: StoredData, plan: ReadPlan) {
  for (const name of NAMES) {
    const c = data.categories.find((x) => x.id === ID[name])!;
    expect(c.cashIls, `${name}: cash = "Left as cash" in the plan`).toBeCloseTo(plan.categories[name].leftoverIls, 2);
  }
}

/** One category's purchases table, as shown. */
interface ShownRow {
  date: string;
  moneyIls: string;
  rate: string;
  moneyUsd: string;
  buys: Record<string, { shares: string; price: string }>;
  spentUsd: string;
  spentIls: string;
}
async function readPurchaseTable(table: Locator): Promise<{ tickers: string[]; rows: ShownRow[]; total: ShownRow }> {
  const heads = await table.locator('thead th').allTextContents();
  const tickers = heads.slice(4, -2).map((h) => h.replace(' bought · price', '').trim());
  const read = async (tr: Locator): Promise<ShownRow> => {
    const cells = (await tr.locator('td').allTextContents()).map((s) => s.trim());
    const buys: ShownRow['buys'] = {};
    tickers.forEach((t, i) => (buys[t] = { shares: cells[4 + 2 * i], price: cells[5 + 2 * i] }));
    return {
      date: cells[0],
      moneyIls: cells[1],
      rate: cells[2],
      moneyUsd: cells[3],
      buys,
      spentUsd: cells[cells.length - 2],
      spentIls: cells[cells.length - 1],
    };
  };
  const trs = table.locator('tbody tr');
  const rows: ShownRow[] = [];
  for (let i = 0; i < (await trs.count()); i++) rows.push(await read(trs.nth(i)));
  return { tickers, rows, total: await read(table.locator('tfoot tr')) };
}

function sharesOf(text: string): number {
  return text === '' ? 0 : num(text);
}

/**
 * Each category's page: positions = the book; its purchase table = the purchases (row by row and the
 * totals); its totals card; and the totals add up to the change in holdings since the sample data.
 */
async function checkCategoryPages(page: Page, purchases: Purchase[]) {
  const book = bookAfter(purchases);
  const start = initialBook();
  const data = await stored(page);
  for (const name of NAMES) {
    await gotoTab(page, 'Portfolio');
    await page.getByRole('region', { name, exact: true }).getByRole('link', { name }).click();
    await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
    const c = book[name];
    // Money is compared with the stored numbers (the book only knows shares to 4 decimals); the
    // stored numbers were checked against the book.
    const sc = data.categories.find((x) => x.id === ID[name])!;

    // Value and cash.
    const invested = Object.entries(sc.holdings).reduce((s, [t, n]) => s + n * data.prices[t].priceUsd, 0);
    const summary = page.getByRole('region', { name: 'Summary' });
    await expect(bigNumber(summary, 'Cash'), `${name}: cash on its page`).toHaveText(ils(sc.cashIls, true));
    await expect(bigNumber(summary, 'In stocks'), `${name}: stocks on its page`).toHaveText(usd(invested, true));
    await expect(bigNumber(summary, 'Total value')).toHaveText(ils(invested * RATE + sc.cashIls, true));

    // Positions: what it owns now.
    const positions = page.locator('table.positions tbody tr:not(.group-row)');
    const shownHoldings: Record<string, number> = {};
    for (let i = 0; i < (await positions.count()); i++) {
      const cells = positions.nth(i).locator('td');
      shownHoldings[(await cells.nth(0).locator('.ticker').textContent())!.trim()] = num(
        await cells.nth(1).textContent(),
      );
    }
    for (const [t, n] of Object.entries(c.holdings)) {
      expect(shownHoldings[t], `${name} ${t}: shares on its page`).toBeCloseTo(n, 3);
    }

    // Purchases, oldest first.
    const mine = purchases.filter((p) => p.newMoney[name] !== 0 || Object.keys(p.parts[name].buys).length > 0);
    const table = page.getByRole('region', { name: `${name} purchases` });
    await expect(table.locator('tbody tr')).toHaveCount(mine.length);
    const shown = await readPurchaseTable(table);
    for (const [i, p] of mine.entries()) {
      const r = shown.rows[i];
      const what = `${name}, purchase of ${p.date}`;
      expect(r.date, what).toBe(dateText(p.date) + (p.note ?? ''));
      expect(r.moneyIls, `${what}: money (₪)`).toBe(ils(p.newMoney[name]));
      expect(r.rate, `${what}: rate`).toBe(p.usdIls.toFixed(4));
      expect(money(r.moneyUsd), `${what}: money ($) after the fee`).toBeCloseTo(
        p.newMoney[name] / (p.usdIls * (1 + p.feePercent / 100)),
        2,
      );
      for (const t of shown.tickers) {
        const part = p.parts[name].buys[t];
        expect(sharesOf(r.buys[t].shares), `${what}: ${t} shares`).toBeCloseTo(part?.shares ?? 0, 3);
        if (part) expect(r.buys[t].price, `${what}: ${t} price paid`).toBe(usd(part.priceUsd));
        else expect(r.buys[t].price, `${what}: ${t} no price`).toBe('');
      }
      for (const t of Object.keys(p.parts[name].buys)) expect(shown.tickers, `${what}: a column for ${t}`).toContain(t);
      const spentUsd = Object.values(p.parts[name].buys).reduce((s, b) => s + b.costUsd, 0);
      expect(money(r.spentUsd), `${what}: bought ($)`).toBeCloseTo(spentUsd, 1);
      expect(money(r.spentIls), `${what}: bought (₪)`).toBeCloseTo(p.parts[name].spentIls, 1);
      // …and exactly what was recorded.
      const tx = data.transactions.find((x) => x.date.slice(0, 7) === p.date.slice(0, 7))!;
      const txUsd = tx.allocations.filter((a) => a.categoryId === ID[name]).reduce((s, a) => s + a.costUsd, 0);
      expect(r.spentUsd, `${what}: bought ($) as recorded`).toBe(usd(txUsd));
      expect(r.spentIls, `${what}: bought (₪) as recorded`).toBe(
        ils(tx.cash.find((x) => x.categoryId === ID[name])?.spentIls ?? 0),
      );
    }
    // The totals row is the sum of the rows, and its shares are the change in holdings.
    const sumOf = (f: (r: ShownRow) => number) => shown.rows.reduce((s, r) => s + f(r), 0);
    expect(money(shown.total.moneyIls), `${name}: total money (₪)`).toBeCloseTo(
      sumOf((r) => money(r.moneyIls)),
      2,
    );
    expect(money(shown.total.moneyUsd), `${name}: total money ($)`).toBeCloseTo(
      sumOf((r) => money(r.moneyUsd)),
      1,
    );
    expect(money(shown.total.spentUsd), `${name}: total bought ($)`).toBeCloseTo(
      sumOf((r) => money(r.spentUsd)),
      1,
    );
    expect(money(shown.total.spentIls), `${name}: total bought (₪)`).toBeCloseTo(
      sumOf((r) => money(r.spentIls)),
      1,
    );
    for (const t of shown.tickers) {
      const total = sharesOf(shown.total.buys[t].shares);
      expect(total, `${name} ${t}: total = sum of rows`).toBeCloseTo(
        sumOf((r) => sharesOf(r.buys[t].shares)),
        3,
      );
      const change = (c.holdings[t] ?? 0) - (start[name].holdings[t] ?? 0);
      expect(total, `${name} ${t}: shares bought = change in holdings`).toBeCloseTo(change, 3);
      expect(total, `${name} ${t}: shares bought = change in shown holdings`).toBeCloseTo(
        (shownHoldings[t] ?? 0) - (start[name].holdings[t] ?? 0),
        3,
      );
    }

    // The totals card.
    const totals = page.getByRole('region', { name: `${name} totals` });
    const put = mine.reduce((s, p) => s + p.newMoney[name], 0);
    const spentIls = mine.reduce((s, p) => s + p.parts[name].spentIls, 0);
    const spentUsd = mine.reduce((s, p) => s + Object.values(p.parts[name].buys).reduce((a, b) => a + b.costUsd, 0), 0);
    const rec = data.transactions.flatMap((tx) => tx.cash.filter((x) => x.categoryId === ID[name]));
    const recIls = rec.reduce((s, x) => s + x.spentIls, 0);
    const recUsd = data.transactions
      .flatMap((tx) => tx.allocations.filter((a) => a.categoryId === ID[name]))
      .reduce((s, a) => s + a.costUsd, 0);
    expect(recIls).toBeCloseTo(spentIls, 1);
    expect(recUsd).toBeCloseTo(spentUsd, 1);
    await expect(bigNumber(totals, 'Money put in')).toHaveText(ils(put, true));
    await expect(bigNumber(totals, 'Spent on stocks')).toHaveText(usd(recUsd, true));
    await expect(bigNumber(totals, 'Left over')).toHaveText(ils(put - recIls, true));
    expect(round(start[name].cash + put - spentIls, 2), `${name}: cash = before + left over`).toBeCloseTo(c.cash, 1);
    expect(round(start[name].cash + put - recIls, 2), `${name}: stored cash = before + left over`).toBeCloseTo(
      sc.cashIls,
      6,
    );
    if (Math.abs(sc.cashIls - (put - recIls)) >= 0.5)
      await expect(totals).toContainText(`Cash now: ${ils(sc.cashIls)}`);
    for (const t of shown.tickers) {
      const n = mine.reduce((s, p) => s + (p.parts[name].buys[t]?.shares ?? 0), 0);
      if (n <= 0) continue;
      const avg =
        mine.reduce(
          (s, p) => s + (p.parts[name].buys[t] ? p.parts[name].buys[t].shares * p.parts[name].buys[t].priceUsd : 0),
          0,
        ) / n;
      const parts = data.transactions.flatMap((tx) =>
        tx.allocations.filter((x) => x.categoryId === ID[name] && x.ticker === t),
      );
      const recN = parts.reduce((s, x) => s + x.shares, 0);
      const recAvg = parts.reduce((s, x) => s + x.shares * x.priceUsd!, 0) / recN;
      expect(recN, `${name} ${t}: shares bought as recorded`).toBeCloseTo(n, 3);
      expect(recAvg, `${name} ${t}: average price as recorded`).toBeCloseTo(avg, 2);
      await expect(totals, `${name} ${t}: shares bought and average price`).toContainText(
        `${sharesText(recN)} ${t} avg ${usd(recAvg)}`,
      );
    }
  }
}

/** Portfolio: summary, each category's card and the Broker view show the book. */
async function checkPortfolio(page: Page, purchases: Purchase[]) {
  const book = bookAfter(purchases);
  const data = await stored(page);
  await gotoTab(page, 'Portfolio');
  let invested = 0;
  let cash = 0;
  for (const name of NAMES) {
    // Holdings and cash as stored (checked against the book, which knows shares to 4 decimals).
    const c = data.categories.find((x) => x.id === ID[name])!;
    const value = Object.entries(c.holdings).reduce((s, [t, n]) => s + n * data.prices[t].priceUsd, 0);
    invested += value;
    cash += c.cashIls;
    const card = page.getByRole('region', { name, exact: true });
    await expect(card.locator('.category-totals'), `${name} card: stocks`).toContainText(`Stocks ${usd(value)}`);
    if (Math.abs(c.cashIls) >= 0.005)
      await expect(card.locator('.category-totals'), `${name} card: cash`).toContainText(`Cash ${ils(c.cashIls)}`);
    else await expect(card.locator('.category-totals')).not.toContainText('Cash');
  }
  const summary = page.getByRole('region', { name: 'Summary' });
  await expect(bigNumber(summary, 'In stocks')).toHaveText(usd(invested, true));
  await expect(bigNumber(summary, 'Not invested yet')).toHaveText(ils(cash, true));
  await expect(bigNumber(summary, 'Total value')).toHaveText(ils(invested * RATE + cash, true));

  const broker = page.locator('.broker-view');
  if (!(await broker.evaluate((d) => (d as HTMLDetailsElement).open))) await broker.locator('summary').click();
  const tickers = [...new Set(NAMES.flatMap((n) => Object.keys(book[n].holdings)))].sort();
  await expect(broker.locator('tbody tr')).toHaveCount(tickers.length);
  for (const t of tickers) {
    const total = NAMES.reduce((s, n) => s + (book[n].holdings[t] ?? 0), 0);
    const row = broker.locator('tbody tr', {
      has: page.locator('td.ticker', { hasText: new RegExp(`^${t.replace('.', '\\.')}$`) }),
    });
    expect(num(await row.locator('td').nth(1).textContent()), `Broker view: total ${t}`).toBeCloseTo(total, 3);
  }
}

/** "All purchases" on Portfolio: newest first, each with its orders and per-category money. */
async function checkAllPurchases(page: Page, purchases: Purchase[]) {
  await gotoTab(page, 'Portfolio');
  const list = page.locator('details.all-purchases');
  if (!(await list.evaluate((d) => (d as HTMLDetailsElement).open))) await list.locator('summary').first().click();
  const cards = list.getByRole('article');
  await expect(cards).toHaveCount(purchases.length);
  const newestFirst = [...purchases].reverse();
  for (const [i, p] of newestFirst.entries()) {
    const card = cards.nth(i);
    await expect(card).toHaveAttribute('aria-label', `Purchase on ${dateText(p.date)}`);
    const totalUsd = p.orders.reduce((s, o) => s + o.shares * o.priceUsd, 0);
    await expect(card.locator('.card-header .muted')).toContainText(
      `${usd(totalUsd)} · ${ils(totalUsd * p.usdIls * (1 + p.feePercent / 100))} at ${p.usdIls.toFixed(4)}`,
    );
    if (p.note) await expect(card.locator('.tx-note')).toHaveText(p.note);
    else await expect(card.locator('.tx-note')).toHaveCount(0);
    await expect(card.locator('.tx-orders li')).toHaveText(
      p.orders.map((o) => `${o.shares.toLocaleString('en-US')} × ${o.ticker} @ ${usd(o.priceUsd)}`),
    );
    await card.locator('details > summary', { hasText: 'By category' }).click();
    for (const name of NAMES) {
      const row = card.locator('tbody tr', { hasText: name });
      const cells = row.locator('td');
      await expect(cells.nth(2), `${p.date} ${name}: new money`).toHaveText(ils(p.newMoney[name]));
      expect(money(await cells.nth(3).textContent()), `${p.date} ${name}: spent`).toBeCloseTo(
        p.parts[name].spentIls,
        1,
      );
      expect(money(await cells.nth(4).textContent()), `${p.date} ${name}: cash change`).toBeCloseTo(
        p.newMoney[name] - p.parts[name].spentIls,
        1,
      );
    }
    await card.locator('details > summary', { hasText: 'By category' }).click();
  }
}

/** Invest: each category's cash from before (what the next purchase adds to its budget). */
async function checkInvestCash(page: Page) {
  const data = await stored(page);
  await gotoTab(page, 'Invest');
  await expect(page.getByLabel('Amount to invest in ILS')).toHaveValue('');
  for (const name of NAMES) {
    const c = data.categories.find((x) => x.id === ID[name])!;
    const row = page.locator('table.split-table tbody tr', { has: page.getByText(name, { exact: true }) });
    await expect(row.locator('td').nth(2), `${name}: cash from before on Invest`).toHaveText(
      Math.abs(c.cashIls) < 0.005 ? '—' : ils(c.cashIls),
    );
    await expect(row.locator('td').nth(3), `${name}: to invest now, with no new money`).toHaveText(
      ils(Math.max(0, c.cashIls)),
    );
  }
}

async function checkEverything(page: Page, purchases: Purchase[]) {
  checkStored(await stored(page), purchases);
  await checkPortfolio(page, purchases);
  await checkAllPurchases(page, purchases);
  await checkCategoryPages(page, purchases);
  await checkInvestCash(page);
}

async function recordExactly(page: Page, date: string) {
  await page.getByRole('button', { name: 'I made a purchase' }).click();
  const dialog = page.getByRole('dialog', { name: 'Record the purchase' });
  await expect(dialog.getByRole('radio', { name: 'I bought exactly what was recommended' })).toBeChecked();
  await dialog.getByLabel('Date').fill(date);
  await dialog.getByRole('button', { name: 'Record purchase' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('status').filter({ hasText: 'Purchase recorded' })).toBeVisible();
}

// ---------- the journey ----------

test('months of investing on a desktop: "The rest", an unticked stock, a different purchase with an added stock; pages add up; undo the middle one; reload', async ({
  page,
}) => {
  const purchases: Purchase[] = [];

  await test.step('load the sample data and wait for live prices', async () => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Load sample data' }).click();
    await expect(page.getByRole('region', { name: 'Market data' })).toContainText(RATE.toFixed(4));
    await expect(
      page.getByRole('region', { name: 'Pension' }).getByRole('button', { name: /\$575\.30/ }),
    ).toBeVisible();
    checkStored(await storedWhen(page, (d) => d.categories.length === 3), []);
  });

  await test.step('June: ₪9,000 — Pension ₪5,000 typed, Investments gets "The rest"', async () => {
    await gotoTab(page, 'Invest');
    await page.getByLabel('Amount to invest in ILS').fill('9000');
    await page.getByLabel('New money for Pension', { exact: true }).fill('5000');
    await page.getByRole('button', { name: 'All the rest to Investments' }).click();
    await expect(page.getByRole('button', { name: 'All the rest to Investments' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    const split = await readSplit(page);
    // Kids keeps its rule (₪1,000 first) and its ₪250 cash; Investments gets 9,000 − 5,000 − 1,000.
    expect(split.Pension).toEqual({ newMoney: 5000, budget: 5000 });
    expect(split.Kids).toEqual({ newMoney: 1000, budget: 1250 });
    expect(split.Investments).toEqual({ newMoney: 3000, budget: 3000 });
    await expect(page.locator('table.split-table tfoot td').nth(1)).toHaveText(ils(9000));
    await expect(page.getByRole('region', { name: 'Orders to place' })).toBeVisible();
    const plan = await readPlan(page);
    checkPlan(plan, split, 0);
    await recordExactly(page, '2026-06-10');
    purchases.push(purchaseFromPlan(plan, split, '2026-06-10', 0));
    checkStored(await purchasesSaved(page, 1), purchases);
    checkCashIsPlannedLeftover(await stored(page), plan);
  });

  await test.step('July: ₪12,000 by the rules, BND unticked', async () => {
    await expect(page.getByLabel('Amount to invest in ILS')).toHaveValue('');
    await page.getByLabel('Amount to invest in ILS').fill('12000');
    const split = await readSplit(page);
    const book = bookAfter(purchases);
    // Kids ₪1,000 first; Pension 70% of the other ₪11,000; Investments the rest.
    expect(split.Kids.newMoney).toBe(1000);
    expect(split.Pension.newMoney).toBe(7700);
    expect(split.Investments.newMoney).toBe(3300);
    for (const n of NAMES)
      expect(split[n].budget, `${n}: new money + its cash`).toBeCloseTo(split[n].newMoney + book[n].cash, 2);
    const orders = page.getByRole('region', { name: 'Orders to place' });
    await expect(orders.getByRole('checkbox', { name: 'Buy BND' })).toBeChecked();
    await orders.getByRole('checkbox', { name: 'Buy BND' }).uncheck();
    await expect(orders.locator('tr.excluded-row')).toContainText('BND');
    await expect(orders.getByRole('checkbox', { name: 'Buy BND' })).not.toBeChecked();
    const plan = await readPlan(page);
    expect(plan.orders.map((o) => o.ticker)).not.toContain('BND');
    for (const n of NAMES) expect(plan.categories[n].buys.BND, `${n} buys no BND`).toBeUndefined();
    checkPlan(plan, split, 0);
    await recordExactly(page, '2026-07-12');
    purchases.push(purchaseFromPlan(plan, split, '2026-07-12', 0));
    checkStored(await purchasesSaved(page, 2), purchases);
    checkCashIsPlannedLeftover(await stored(page), plan);
  });

  await test.step('August: ₪6,000 with a 0.5% fee; bought something different, plus SCHD for Investments', async () => {
    await page.getByLabel('Amount to invest in ILS').fill('6000');
    await page.locator('details.options > summary').click();
    await page.getByLabel('Currency conversion fee').fill('0.5');
    await expect(page.locator('details.options > summary')).toContainText('+ 0.5% fee');
    // The stock unticked in July is back in this purchase.
    await expect(page.locator('tr.excluded-row')).toHaveCount(0);
    const split = await readSplit(page);
    expect(split.Kids.newMoney).toBe(1000);
    expect(split.Pension.newMoney).toBe(3500);
    expect(split.Investments.newMoney).toBe(1500);
    await expect(page.getByRole('region', { name: 'Orders to place' })).toBeVisible();
    const plan = await readPlan(page);
    checkPlan(plan, split, 0.5);
    expect(plan.orders.length, 'at least two orders to change').toBeGreaterThanOrEqual(2);

    await page.getByRole('button', { name: 'I made a purchase' }).click();
    const dialog = page.getByRole('dialog', { name: 'Record the purchase' });
    await dialog.getByRole('radio', { name: 'I bought something different' }).check();
    // The first order: one share fewer, at a higher price. The second: same shares, lower price.
    const [a, b] = plan.orders;
    const executed = plan.orders.map((o) => ({ ticker: o.ticker, shares: o.shares, priceUsd: o.priceUsd }));
    executed[0] = { ticker: a.ticker, shares: a.shares - 1, priceUsd: round(a.priceUsd + 1.25, 2) };
    executed[1] = { ticker: b.ticker, shares: b.shares, priceUsd: round(b.priceUsd - 0.4, 2) };
    await dialog.getByLabel(`Shares of ${a.ticker} bought`).fill(String(executed[0].shares));
    await dialog.getByLabel(`Price paid for ${a.ticker}`).fill(String(executed[0].priceUsd));
    await dialog.getByLabel(`Price paid for ${b.ticker}`).fill(String(executed[1].priceUsd));
    await dialog.getByRole('button', { name: '+ Add a stock I bought instead' }).click();
    await dialog.getByLabel('Added stock 1', { exact: true }).fill('schd');
    await dialog.getByLabel('Category for added stock 1', { exact: true }).selectOption({ label: 'Investments' });
    await dialog.getByLabel('Shares of added stock 1', { exact: true }).fill('4');
    await dialog.getByLabel('Price of added stock 1', { exact: true }).fill(String(SCHD_PAID));
    const rate = 3.66;
    await dialog.getByLabel('USD/ILS rate you got').fill(String(rate));
    await expect(dialog.getByLabel('Conversion fee percent')).toHaveValue('0.5');
    await dialog.getByLabel('Date').fill('2026-08-14');
    await dialog.getByLabel('Note (optional)').fill('August deposit, and SCHD for Investments');
    const totalUsd = executed.reduce((s, o) => s + o.shares * o.priceUsd, 0) + 4 * SCHD_PAID;
    await expect(dialog.getByText(/^Total \$/)).toHaveText(`Total ${usd(totalUsd)} · ${ils(totalUsd * rate * 1.005)}`);
    await dialog.getByRole('button', { name: 'Record purchase' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('status').filter({ hasText: 'Purchase recorded' })).toBeVisible();

    // The book: planned stocks are split between categories as planned; SCHD is all Investments'.
    const parts = {} as Purchase['parts'];
    for (const n of NAMES) {
      const buys: Record<string, Part> = {};
      for (const o of executed) {
        const planned = plan.categories[n].buys[o.ticker];
        const order = plan.orders.find((x) => x.ticker === o.ticker)!;
        if (!planned || o.shares === 0) continue;
        const shares = (o.shares * planned.costUsd) / order.costUsd;
        buys[o.ticker] = { shares, priceUsd: o.priceUsd, costUsd: shares * o.priceUsd };
      }
      if (n === 'Investments') buys.SCHD = { shares: 4, priceUsd: SCHD_PAID, costUsd: 4 * SCHD_PAID };
      const spentUsd = Object.values(buys).reduce((s, x) => s + x.costUsd, 0);
      parts[n] = { buys, spentIls: round(spentUsd * rate * 1.005, 2) };
    }
    purchases.push({
      date: '2026-08-14',
      note: 'August deposit, and SCHD for Investments',
      usdIls: rate,
      feePercent: 0.5,
      orders: [...executed.filter((o) => o.shares > 0), { ticker: 'SCHD', shares: 4, priceUsd: SCHD_PAID }],
      newMoney: { Pension: split.Pension.newMoney, Kids: split.Kids.newMoney, Investments: split.Investments.newMoney },
      parts,
    });
    checkStored(await purchasesSaved(page, 3), purchases);
  });

  await test.step("SCHD has no market price: type today's price on Portfolio", async () => {
    await gotoTab(page, 'Portfolio');
    await expect(page.getByRole('region', { name: 'Market data' })).toContainText('1 missing (SCHD)');
    const row = page
      .getByRole('region', { name: 'Investments', exact: true })
      .locator('table.positions tbody tr', { has: page.locator('.ticker', { hasText: /^SCHD$/ }) });
    await row.getByRole('button', { name: 'Enter price', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Price of SCHD' });
    await dialog.getByLabel('Price of SCHD in USD').fill(String(SCHD_TODAY));
    await dialog.getByRole('button', { name: 'Save price' }).click();
    await expect(dialog).toBeHidden();
    await expect(row.locator('td').nth(2)).toContainText(usd(SCHD_TODAY));
    await expect(page.getByRole('region', { name: 'Market data' })).not.toContainText('missing');
    await storedWhen(page, (d) => d.prices.SCHD?.priceUsd === SCHD_TODAY);
  });

  await test.step('after three purchases every page adds up', async () => {
    await checkEverything(page, purchases);
  });

  await test.step('undo the middle (July) purchase from "All purchases"', async () => {
    await gotoTab(page, 'Portfolio');
    const list = page.locator('details.all-purchases');
    if (!(await list.evaluate((d) => (d as HTMLDetailsElement).open))) await list.locator('summary').first().click();
    const july = list.getByRole('article', { name: `Purchase on ${dateText('2026-07-12')}` });
    await expect(list.getByRole('article').nth(1)).toHaveAttribute(
      'aria-label',
      `Purchase on ${dateText('2026-07-12')}`,
    );
    await july.getByRole('button', { name: 'Undo' }).click();
    const dialog = page.getByRole('dialog', { name: 'Undo this purchase?' });
    // Every category still owns what July gave it: nothing has to be cut to 0.
    await expect(dialog.locator('.banner.warn')).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Undo purchase' }).click();
    await expect(dialog).toBeHidden();
    await expect(list.getByRole('article')).toHaveCount(2);
    await purchasesSaved(page, 2);
    purchases.splice(1, 1);
    await checkEverything(page, purchases);
  });

  await test.step('reload: the same holdings, cash and purchases', async () => {
    await gotoTab(page, 'Portfolio');
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Portfolio' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Market data' })).toContainText(RATE.toFixed(4));
    await expect(
      page.getByRole('region', { name: 'Pension' }).getByRole('button', { name: /\$575\.30/ }),
    ).toBeVisible();
    // The price typed by hand is kept (the market has none for SCHD).
    expect((await stored(page)).prices.SCHD.priceUsd).toBe(SCHD_TODAY);
    await checkEverything(page, purchases);
  });
});

test('undoing a purchase where a category got one stock from two orders warns when it now owns less than both parts', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Load sample data' }).click();
  await expect(page.getByRole('region', { name: 'Market data' })).toContainText(RATE.toFixed(4));
  await gotoTab(page, 'Invest');
  await page.getByLabel('Amount to invest in ILS').fill('9000');
  await expect(page.getByRole('region', { name: 'Orders to place' })).toBeVisible();
  const plan = await readPlan(page);
  // A stock the plan buys partly for Kids; Kids also gets one more share of it, bought separately.
  const [ticker, part] = Object.entries(plan.categories.Kids.buys)[0];
  const extraPrice = round(PRICES[ticker] - 1, 2);
  await page.getByRole('button', { name: 'I made a purchase' }).click();
  const record = page.getByRole('dialog', { name: 'Record the purchase' });
  await record.getByRole('radio', { name: 'I bought something different' }).check();
  await record.getByRole('button', { name: '+ Add a stock I bought instead' }).click();
  await record.getByLabel('Added stock 1', { exact: true }).fill(ticker);
  await record.getByLabel('Category for added stock 1', { exact: true }).selectOption({ label: 'Kids' });
  await record.getByLabel('Shares of added stock 1', { exact: true }).fill('1');
  await record.getByLabel('Price of added stock 1', { exact: true }).fill(String(extraPrice));
  await record.getByRole('button', { name: 'Record purchase' }).click();
  await expect(record).toBeHidden();
  const tx = (await purchasesSaved(page, 1)).transactions[0];
  const kidsParts = tx.allocations.filter((a) => a.categoryId === ID.Kids && a.ticker === ticker);
  expect(kidsParts.map((a) => a.priceUsd)).toEqual([PRICES[ticker], extraPrice]);
  const added = kidsParts.reduce((s, a) => s + a.shares, 0);
  expect(added).toBeCloseTo(part.shares + 1, 3);

  // Later Kids' holding of it is corrected by hand to less than the purchase added in all, though
  // more than each of its two parts.
  const corrected = round(Math.max(part.shares, 1) + Math.min(part.shares, 1) / 2, 4);
  expect(corrected).toBeLessThan(added);
  await gotoTab(page, 'Portfolio');
  await page.getByRole('region', { name: 'Kids', exact: true }).getByRole('link', { name: 'Kids' }).click();
  await page.getByRole('button', { name: 'Edit category' }).click();
  const editor = page.getByRole('dialog');
  const tickers = editor.getByLabel(/^Ticker, row \d+$/);
  let row = -1;
  for (let i = 0; i < (await tickers.count()); i++) if ((await tickers.nth(i).inputValue()) === ticker) row = i + 1;
  expect(row, `${ticker} is in Kids' editor`).toBeGreaterThan(0);
  await editor.getByLabel(`Shares owned, row ${row}`, { exact: true }).fill(String(corrected));
  await editor.getByRole('button', { name: 'Save category' }).click();
  await expect(editor).toBeHidden();
  await storedWhen(page, (d) => d.categories.find((c) => c.id === ID.Kids)!.holdings[ticker] === corrected);

  // Undo it: the dialog says Kids' holding will be set to 0, as it has less than the purchase added.
  await gotoTab(page, 'Portfolio');
  await page.locator('details.all-purchases > summary').click();
  await page.getByRole('article').getByRole('button', { name: 'Undo' }).click();
  const dialog = page.getByRole('dialog', { name: 'Undo this purchase?' });
  await expect.soft(dialog.locator('.banner.warn'), 'the warning about Kids is shown').toContainText(`Kids: ${ticker}`);
  await dialog.getByRole('button', { name: 'Undo purchase' }).click();
  await expect(dialog).toBeHidden();
  const after = await purchasesSaved(page, 0);
  expect(
    after.categories.find((c) => c.id === ID.Kids)!.holdings[ticker],
    'set to 0, as the dialog says',
  ).toBeUndefined();
});
