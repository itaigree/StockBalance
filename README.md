# StockBalance

A personal app to keep track of your stocks by category, and to calculate **what to buy** each time
you invest so that every category stays balanced the way you want.

- **Categories** (e.g. Pension, Kids, Investments): each has target weights for its stocks
  (e.g. VOO 60%, VXUS 25%, BND 15%) and tracks how many shares it owns.
- **One broker account.** Categories are labels you keep in the app. The same stock can belong
  to several categories, and a category can own part of a share.
- **Invest.** Enter how much money (₪) you have. The app splits it between categories using your
  rules (fixed amounts, percentages, "whatever is left"), and you can change the split for this
  purchase. Then it calculates the buys that bring each category closest to its targets, and
  **merges them into one order per stock**, so you place as few orders as possible. It also tells
  you how many shekels to convert to dollars.
- **Record.** After you buy, record what was actually bought. The shares go to the right
  categories, any leftover money stays with its category for next time, and the purchase is kept
  in History, where it can be undone.
- **Private.** Everything is stored only in your browser. Nothing is uploaded. Only ticker symbols are
  sent to the price services. Use *Settings → Download backup* to keep a copy.

The app only suggests purchases. It never suggests selling.

## Running it

You need [Node.js](https://nodejs.org) 22.12 or newer (the current LTS version is fine).

```bash
npm install
npm start          # opens http://localhost:5173
```

Run it with `npm start` and stock prices and the USD/ILS rate are fetched from Yahoo Finance
automatically, with no key needed. The local server forwards these requests because Yahoo blocks
them from a browser page.

### Price sources (Settings → Prices)

| Source | Needs | Works when |
| --- | --- | --- |
| Automatic (default) | – | Tries Yahoo first, then Finnhub if you set a key |
| Yahoo Finance | – | The app runs on your computer with `npm start` / `npm run preview` |
| Finnhub | Free API key from [finnhub.io](https://finnhub.io/register) | Always, including a hosted copy |
| Manual | – | You type the prices yourself |

The USD/ILS rate comes from Yahoo, then Frankfurter (ECB rates), then open.er-api.com. You can
always type any price or the rate yourself.

### Using it on your phone (GitHub Pages)

Every push to `main` builds the app and publishes it to
`https://itaigree.github.io/StockBalance/` (see `.github/workflows/deploy.yml`). One-time setup:
in the repository's **Settings → Pages**, set **Source** to **GitHub Actions**. Free GitHub Pages
needs a public repository.

On the phone, open the address and use **Add to Home Screen**. On the hosted copy the Yahoo
forwarding doesn't exist, so get a free key at [finnhub.io](https://finnhub.io/register) and paste
it in **Settings → Prices** (or type prices yourself).

Each browser keeps its own data: the phone and the computer don't share it. To move data, use
**Settings → Download backup** on one and **Restore from backup** on the other.

### Prices for every exchange (free price forwarder)

On the hosted copy, Finnhub's free key only covers US stocks. To get prices for any stock Yahoo
Finance knows, including London-listed ones like `MXWO.L`, set up your own free price forwarder.
It's a tiny Cloudflare Worker that fetches prices from Yahoo for the app
([`worker/yahoo-proxy.js`](worker/yahoo-proxy.js)). It only forwards price requests, nothing else.

1. Create a free account at [dash.cloudflare.com](https://dash.cloudflare.com/sign-up).
2. Go to **Workers & Pages → Create → Create Worker** (start from "Hello World"), name it e.g.
   `stockbalance-prices`, and click **Deploy**.
3. Click **Edit code**, replace everything with the contents of `worker/yahoo-proxy.js`, and click
   **Deploy** again.
4. Copy the Worker's address (like `https://stockbalance-prices.yourname.workers.dev`).
5. In the app: **Settings → Prices → Price forwarder address**, paste it, press **Test**, and choose
   **Automatic** or **Yahoo Finance** as the price source.

The free plan allows 100,000 requests a day; refreshing prices uses one per stock.

## How the calculation works

See [docs/DESIGN.md](docs/DESIGN.md) for the details. In short:

1. Each category gets its budget (₪ → $ at the current rate, minus the conversion fee if you set
   one).
2. Inside each category, the money goes to the stocks that are furthest below their target, in
   proportion to their targets, until they are all equally close to target. Stocks above their
   target get nothing.
3. All categories' buys of the same stock are added together into one order. Optional limits help
   you place fewer orders:
   - **minimum order**: skip stocks that would get less than $X this time.
   - **max different stocks**: buy at most N stocks this time.

   The money that doesn't fit these limits goes to the category's other stocks, or stays as cash
   for next time.
4. If your broker only sells whole shares, each order is rounded down to whole shares. Leftovers
   then buy extra shares only when that brings a category closer to its targets.

## Development

```bash
npm run dev         # dev server
npm test            # unit tests (Vitest)
npm run e2e         # end-to-end tests (Playwright; run `npx playwright install chromium` once first)
npm run check       # typecheck + unit tests + production build
```

The code is organised like this:

- `src/types.ts`: the data model
- `src/engine/`: the calculation (split, plan, ledger), pure and fully tested
- `src/data/`: storage, backup, price and exchange-rate fetching, sample data
- `src/state/`: app state, persistence and market-data refresh
- `src/pages/`, `src/components/`: the user interface
