import { test as base, type Page } from '@playwright/test';

/** Live-looking prices served instead of the real APIs (the tests never touch the network). */
export const PRICES: Record<string, number> = { VOO: 575.3, VXUS: 66.1, BND: 72.9, QQQ: 560.2, GLD: 310.5, AAPL: 235.4, VTI: 300, 'ILS=X': 3.6512 };

async function stubMarket(page: Page) {
  await page.route('**/api/yahoo/**', (route) => {
    const symbol = decodeURIComponent(route.request().url().split('/chart/')[1].split('?')[0]);
    if (!(symbol in PRICES)) {
      return route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ chart: { result: null, error: { code: 'Not Found', description: 'No data found, symbol may be delisted' } } }),
      });
    }
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        chart: { result: [{ meta: { currency: symbol === 'ILS=X' ? 'ILS' : 'USD', regularMarketPrice: PRICES[symbol] } }], error: null },
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
