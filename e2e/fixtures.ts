import { expect, test as base, type Locator, type Page } from '@playwright/test';

/** Live-looking prices served instead of the real APIs (the tests never touch the network). */
export const PRICES: Record<string, number> = {
  VOO: 575.3,
  VXUS: 66.1,
  BND: 72.9,
  QQQ: 560.2,
  GLD: 310.5,
  AAPL: 235.4,
  VTI: 300,
  'ILS=X': 3.6512,
};

async function stubMarket(page: Page) {
  await page.route('**/api/yahoo/**', (route) => {
    const url = route.request().url();
    if (url.includes('/v1/finance/search')) {
      // Yahoo's search: the stubbed stocks whose ticker starts like the one typed.
      const q = (new URL(url).searchParams.get('q') ?? '').toUpperCase();
      const quotes = Object.keys(PRICES)
        .filter((s) => s !== 'ILS=X' && q && s[0] === q[0])
        .map((symbol) => ({ symbol, quoteType: 'EQUITY', exchange: 'NMS', shortname: `${symbol} Inc.` }));
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ quotes }) });
    }
    const symbol = decodeURIComponent(url.split('/chart/')[1].split('?')[0]);
    if (!(symbol in PRICES)) {
      return route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({
          chart: { result: null, error: { code: 'Not Found', description: 'No data found, symbol may be delisted' } },
        }),
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

export const test = base.extend({
  page: async ({ page }, use) => {
    await stubMarket(page);
    await use(page);
  },
});
export { expect } from '@playwright/test';

/**
 * Press "Save category". When it asks about a stock no price was found for (one the stub doesn't
 * know, e.g. AMZN), keep it as a user who meant it would: press Save again.
 */
export async function saveCategory(dialog: Locator) {
  await dialog.getByRole('button', { name: 'Save category' }).click();
  const again = dialog.getByText(/press Save again to keep/);
  await expect(async () => {
    if (await again.isVisible()) await dialog.getByRole('button', { name: 'Save category' }).click();
    await expect(dialog).toBeHidden({ timeout: 500 });
  }).toPass();
}
