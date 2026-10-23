# StockBalance — design

## What the app does

1. **Track holdings.** The user has one broker account holding US stocks/ETFs (priced in USD).
   They split it into *categories* (e.g. "Pension", "Kids – Noa", "Investments"). Each category
   owns some number of shares of some tickers and has *target weights* (e.g. VOO 60%, BND 30%,
   GLD 10%). Categories are virtual: the same ticker may be owned by several categories, and a
   category can own a fractional number of shares.
2. **Plan a purchase.** The user types how much money (ILS) they have to invest now. The amount is
   split between categories (by each category's contribution rule, editable per purchase). The
   app then computes what to buy so every category moves toward its targets, and **merges all
   categories' buys into one order per ticker** (it is one broker account, and the user wants as
   few transactions as possible). It shows how much ILS to convert to USD.
3. **Record the purchase.** After placing the orders, the user records what was actually bought
   (shares, price, FX rate). Shares are attributed to categories, cash leftovers stay with their
   category, and the purchase goes into the history (and can be undone).

Buy-only: the app never suggests selling.

## Units and conversions

- Prices: USD per share. FX: `usdIls` = ILS per 1 USD.
- Effective ILS cost of 1 USD: `usdIls * (1 + fxFeePercent / 100)`.
- `budgetUsd = budgetIls / (usdIls * (1 + fxFeePercent/100))`.
- `spentIls = spentUsd * usdIls * (1 + fxFeePercent/100)`.
- Category "invested value" = Σ shares × price (USD). Current weight of a ticker = its value /
  the category's invested value (cash excluded). Target weights are percentages of invested value.

## Splitting the money between categories (`splitContribution`)

Input: total ILS and each category's `ContributionRule`.

1. `fixed` categories get their amount. If the fixed amounts exceed the total, they are scaled down
   proportionally (warning) and everyone else gets 0.
2. `percent` categories get `percent%` of what is left after fixed amounts. If the percents sum
   to more than 100, they are scaled down proportionally (warning).
3. Whatever is still left is split equally between `remainder` categories.
   If there are none, it is reported as `unassignedIls` (warning).
4. `none` categories get 0.

Amounts are rounded to 0.01 ILS using largest-remainder rounding so that the amounts plus
`unassignedIls` add up to exactly the total. Negative or non-finite totals are an error → all 0.

In the planner the user can override any category's amount; the split is only the default.
Each category's budget for the plan = its amount of new money + (optionally, default on) its
carried-over `cashIls`, floored at 0 — leftovers add to the budget and an earlier overspend
(negative cash) is taken back from it.

## The allocation algorithm (`planPurchase`)

Notation for category `c`: budget `B_c` (USD), price `p_t`, current value `V_ct = shares × p_t`,
target fraction `w_ct` (targets normalised to sum to 1; tickers with 0% or no price are excluded),
and `T_c = Σ_t V_ct + B_c` (value after investing everything, counting all holdings, also
non-target ones).

### Balance objective

The plan tries to minimise, over all categories,

    E = Σ_c Σ_t (V'_ct − w_ct · T_c)² / w_ct

where `V'_ct` is the value after buying and `T_c` stays fixed (uninvested cash counts as part of
`T_c`, so leaving money uninvested is "worse" only when buying actually brings stocks closer to
target). Under the constraints "buy only" and "spend exactly `B_c`" the minimiser of this objective
is **ratio water-filling** (below), which raises every bought ticker to the same ratio
`V'_ct / w_ct`: under-weight stocks are topped up proportionally to their targets, so small
targets are not starved.

### Step 1 — ideal (fractional) buys per category: water-filling

For category `c` restricted to an *allowed* set of tickers `S` (initially all its target tickers
with weight > 0 and a valid price): find level `λ ≥ 0` with

    Σ_{t∈S} max(0, w_ct · λ − V_ct) = B_c

and buy `x_ct = max(0, w_ct · λ − V_ct)` dollars of each. (Sort by `V_ct / w_ct`, add tickers one
by one; standard.) `w_ct` stays normalised over the category's *full* target set, so if a ticker is
not allowed, its money flows to the allowed ones — but the level is capped at `λ ≤ T_c`, so no ticker
is ever pushed above its full target value `w_ct · T_c`; money that can't be placed that way stays
uninvested (cash). With all targets allowed the cap is never binding. If `S` is empty, the budget
stays uninvested.

### Step 2 — merge across categories and apply the "fewer transactions" constraints

`X_t = Σ_c x_ct` is the amount the combined order for ticker `t` should have.
Repeat until nothing changes:

- If `maxTickers` is set and more than `maxTickers` tickers have `X_t > 0`, drop (for this round)
  the ticker with the smallest `X_t` and redo step 1.
- If `minOrderUsd > 0` and some ticker has `0 < X_t < minOrderUsd`, drop the one with the smallest
  `X_t` and redo step 1. With whole shares, a ticker whose single share already costs at least
  `minOrderUsd` is not dropped here: its order will be 0 or ≥ 1 share, which is checked after
  rounding.

Dropping a ticker never lowers the other tickers' `X_t`, so this terminates. A category whose
tickers were all dropped keeps its budget as cash (warning: it will be included next time via
`cashIls`, so it gets its turn — the constraints act like a lazy round-robin).

### Step 3 — whole shares (only when `wholeShares`)

- `shares_t = floor(X_t / p_t)` (with a small epsilon for floating point).
- Attribute the shares of each order to the categories in proportion to `x_ct`:
  `q_ct = shares_t · x_ct / X_t` (fractional shares per category are fine). This never exceeds
  any category's budget.
- **Top-up with leftovers.** Repeatedly consider buying one more share of an allowed ticker `t`:
  - Who pays: categories that have `t` as an allowed target, are still below their target value
    for it (gap `g = w_ct·T_c − V'_ct > 0`) and have leftover money. Each pays at most
    `min(leftover, 2g)` — so no paying category ends further from its own target than before. The
    price is split in proportion to the gaps (capped), and anything not covered that way in
    proportion to the remaining room (capped). If the caps together are less than `p_t`, `t` is not
    a candidate.
  - A new order (ticker not bought yet) must respect `maxTickers`, and every order must end up at
    least `minOrderUsd`.
  - Pick the candidate that decreases `E` the most; stop when no candidate decreases `E`.
- If an order ended below `minOrderUsd` after rounding, ban that ticker and start again from step 1.
- If some tickers were dropped in step 2 and a ticker that kept its place couldn't buy even one
  share, ban those wasted tickers and start again from step 1, so the dropped tickers get another
  chance. Both rules only add to the banned set, so this terminates.

When `wholeShares` is false, orders are `X_t` dollars (`shares = X_t / p_t`), no rounding.

### Output

- `orders`: one per ticker with shares > 0 (shares, price, cost), sorted by cost descending.
- Per category: budget (ILS and USD), buys (ticker, shares, cost), spent (USD, ILS), leftover
  (ILS), and before/after positions with current vs target weight.
- Totals: budget ILS, spent USD, ILS to convert (spent including fee), leftover ILS.
- `warnings` (non-blocking, human readable) and `errors` (blocking: invalid FX rate, a held or
  target ticker without a price, negative budget …). With errors, no orders are produced.

Invariants (tested with property-based tests):
- Every category spends ≤ its budget (+1e-6 tolerance); no negative buys.
- The plan never makes any single category's part of `E` worse than buying nothing (no stock is
  pushed above its target value by the ideal buys, and extra whole shares are only paid for by
  categories they don't push further from target).
- Σ_c q_ct = shares_t for every order; whole shares when `wholeShares`.
- Number of orders ≤ `maxTickers` (when set and satisfiable); every order ≥ `minOrderUsd`.
- Only target tickers with weight > 0 are bought by a category.
- Water-filling result equals the analytical optimum on small cases; with a budget at least the
  sum of deficits every target is met exactly (fractional mode).

## Recording a purchase (`transactionFromPlan`, `applyTransaction`, `revertTransaction`)

The user confirms or edits the executed shares and price of each planned order and the FX rate.
For each ticker the executed shares are split between categories in proportion to the planned
category shares (`q_ct`), rounded to 6 decimals with largest-remainder so they add up exactly.
Category cost = shares × executed price; `spentIls` uses the executed FX rate and fee and is
rounded to agorot, as is `cashIls`.
Applying a transaction adds the shares to `holdings` and adds `newMoneyIls − spentIls` to
`cashIls`. Reverting does the opposite (removing tickers whose shares become ~0).

When a plan buys nothing (e.g. too little money for a share), the user can still record it with no
orders: the new money is added to each category's cash and is included next time.

The plan shown on the Invest page is saved in the browser (with its inputs) until it is recorded or
the inputs are cleared. After a reload — which also refreshes prices — that saved plan is shown
and recorded as it was, instead of a recalculation with new prices; the user can choose to
recalculate.

## Persistence

Everything is stored in the browser's `localStorage` (key `stockbalance:data`) as `AppData`
(versioned, validated with zod on load and on import). Backup = download the JSON; restore =
import the JSON file. Nothing is sent anywhere except price/FX requests (ticker symbols only).

## Prices and FX

- Yahoo Finance chart API via the local Vite proxy (`/api/yahoo/v8/finance/chart/{symbol}`),
  price = `chart.result[0].meta.regularMarketPrice`; FX symbol `ILS=X`. Yahoo uses `-` where other
  sources use `.` (BRK.B → BRK-B).
- Finnhub `https://finnhub.io/api/v1/quote?symbol=X&token=KEY`, price = `c` (0 means unknown).
- FX fallbacks: Frankfurter `https://api.frankfurter.dev/v1/latest?base=USD&symbols=ILS` →
  `rates.ILS`; then open.er-api `https://open.er-api.com/v6/latest/USD` → `rates.ILS`.
- Any price or the FX rate can be overridden manually; manual values are kept until the next
  successful refresh of that ticker.
