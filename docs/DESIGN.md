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
   category, and the purchase is kept (shown per category, and in a list of all purchases where it
   can be undone).

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

## Fewest orders (`PlanOptions.strategy = 'fewest'`)

A preference (Settings → Purchase defaults, and per purchase on the Invest page) for buying fewer
different stocks. Step 1 changes: instead of water-filling, each category fills the allowed stock
furthest below its target value first — the largest gap `w_ct · T_c − V_ct`, which is the largest
shortfall in percentage points of the category after investing — up to that target, then the next
largest gap, until the money runs out (ties go to the earlier target). A stock in a group aims at
its part of the group's target (among the group's allowed stocks), and the group's stocks together
never go past what is left of the group's target, so a group at or above target gets nothing and a
group's total gap never outranks a single stock that could take the money alone. As with
water-filling nothing is pushed above its target, and with fractional shares the whole budget is
spent (the positive gaps add up to at least the budget). A category never buys more different
stocks than with water-filling (property-tested on whole plans, with groups).

With whole shares: the top-up only adds shares to stocks the plan already chose (it never opens a
new order for leftovers, which stay as the category's cash); and a chosen stock that can't buy even
one share is banned and planning starts again, so its money goes to the next stock in line. Order
limits (`maxTickers`, `minOrderUsd`) apply as before.

## Recording a purchase (`transactionFromPlan`, `applyTransaction`, `revertTransaction`)

The user confirms or edits the executed shares and price of each planned order and the FX rate.
For each ticker the executed shares are split between categories in proportion to the planned
category shares (`q_ct`), rounded to 6 decimals with largest-remainder so they add up exactly.
A category's cost is its exact proportion of the order's cost (not the rounded shares × price, which
could charge a fraction of an agora more than it planned to spend); `spentIls` uses the executed FX
rate and fee and is rounded to agorot, as is `cashIls`. In the per-category purchase summary, dollar
amounts of new money are after the conversion fee, like the amounts spent, so they compare, and the
price shown for a stock is the price of the orders the category's shares came from (not cost ÷
rounded shares): each part of a purchase keeps its order's price (`priceUsd`), so when one stock is
bought in two orders at different prices each category shows what it paid. Purchases recorded before
that was kept show the average price of the stock's orders; merging categories combines the prices
of matching parts weighted by shares.
Applying a transaction adds the shares to `holdings` and adds `newMoneyIls − spentIls` to
`cashIls`. Reverting does the opposite (removing tickers whose shares become ~0).

When a plan buys nothing (e.g. too little money for a share), the user can still record it with no
orders: the new money is added to each category's cash and is included next time.

The plan shown on the Invest page is saved in the browser (with its inputs, and a fingerprint of
what it depends on in the categories: ids, targets, money rules, holdings and cash) until it is
recorded or the inputs are cleared. It is saved again whenever anything in it changes, including the
exchange rate. It also keeps a fingerprint of all the purchases, so a purchase recorded or undone
since (also an older one) means nothing is restored. After a reload — which also refreshes prices — that saved plan is shown and recorded
as it was, instead of a recalculation with new prices; the user can choose to recalculate. If the
categories changed since (edited, deleted, merged, a backup restored…), the saved plan is not used:
the inputs come back and the plan is made again for the categories as they are. If a purchase was
recorded or undone since (e.g. in another tab), nothing is restored, and an open Invest page starts
over, so the same money isn't planned and recorded twice. Plans saved by older versions (without
these fingerprints) are restored when all their categories still exist.
An empty fee means no fee; a negative amount (the total or a category's), minimum order or fee
stops planning with a message, and so does a number that can't be read ("0,5", "1000..") in the
amount, a category's amount (unless it gets "the rest") or an option: it isn't read as empty, it
stays as typed when the field is left (until "Reset to rules" or starting over), no plan is offered
(not even a restored one), and the saved plan is kept while it is being corrected; emptying the total
of the saved plan forgets it. An amount of 0 plans with the cash carried over from
earlier purchases (only an empty amount means "not started"; the page suggests 0 only when some
category has cash left).
The record dialog records the plan as it was when "I made a purchase" was pressed, even if prices
or the rate change while it is open; it closes when any purchase is recorded or undone elsewhere,
and an added stock's price that can't be read isn't replaced by the market price. The
"Purchase recorded" banner's Undo undoes the purchase this page recorded, and goes away once another
purchase is the newest. Undoing warns about each stock a category now owns less of than the purchase
gave it, adding up all the parts the purchase gave that category.

## Persistence

Everything is stored in the browser's `localStorage` (key `stockbalance:data`) as `AppData`
(versioned, validated with zod on load and on import). Backup = download the JSON; restore =
import the JSON file. Nothing is sent anywhere except price/FX requests (ticker symbols only).
When another copy of the app in the same browser (another tab, or the installed app) saves, this
copy takes that data (the `storage` event), so it never saves its older data over it. Starting over
with other data (restore, sample, delete all) fetches prices and the exchange rate again; editing
the data (merge, split, import, a new stock) only prices stocks that have no price yet and leaves the
exchange rate (and anything typed by hand) alone.

Where the device can share files (phones), the backup can also go through the share sheet (Drive,
iCloud, email…). Some browsers share only plain-text files, so it is then the same JSON named
`.txt`; restore accepts both. *Back up now* uses the share sheet on touch devices and a download
elsewhere.

The browser remembers its last backup (`stockbalance:backup`: time, a fingerprint of the
categories, purchases and settings, and the newest purchase's id — not part of `AppData`). The
Portfolio page shows a reminder when there is data and no backup yet, when purchases changed since
the last backup (recorded or undone — a fingerprint of all purchase ids), or when it is 30 days old
and anything else changed. *Later* hides it for 7 days. Deleting all data forgets the last backup.
The fingerprint doesn't depend on the order of keys in the data (saved categories and reloaded
ones list their fields in different orders). Open copies of the app follow each other's backups,
and *Later* adds to the mark as stored now, so it never forgets a backup made in another copy.
Marks saved by earlier versions (whose fingerprint depended on key order) still count. The "saved
data couldn't be read" message goes away once the user restores a backup, loads the sample or
deletes all data, here or in another open copy (a start-over writes `stockbalance:started-over`, so
other copies hear of it even when the data itself doesn't change).

## Prices and FX

- Yahoo Finance chart API via the local Vite proxy (`/api/yahoo/v8/finance/chart/{symbol}`),
  price = `chart.result[0].meta.regularMarketPrice`; FX symbol `ILS=X`. Yahoo uses `-` for US share
  classes (BRK.B → BRK-B) but keeps exchange suffixes (MXWO.L).
- On a hosted copy, Yahoo requests can go through the user's own Cloudflare Worker
  (`worker/yahoo-proxy.js`, address in `settings.yahooProxyUrl`), which forwards only
  `/v8/finance/chart/*` and adds CORS headers. Used for prices and for the `ILS=X` rate.
  If the first request finds no proxy or forwarder (an HTML page, a 404), the other tickers aren't
  requested. Yahoo limiting requests (429) or failing (5xx) is reported per ticker as temporary,
  and the other tickers are still asked for.
- Finnhub `https://finnhub.io/api/v1/quote?symbol=X&token=KEY`, price = `c` (0 means unknown). A 401
  means the key is wrong (the other tickers aren't requested); a 403 is one symbol the plan doesn't
  cover (e.g. non-US listings on the free plan) and the others are still priced.
- FX fallbacks: Frankfurter `https://api.frankfurter.dev/v1/latest?base=USD&symbols=ILS` →
  `rates.ILS`; then open.er-api `https://open.er-api.com/v6/latest/USD` → `rates.ILS`.
- Any price or the FX rate can be overridden manually; manual values are kept until the next
  successful refresh of that ticker.

## Importing holdings

Settings → Import holdings reads a Yahoo Finance portfolio export (CSV). In the preview the user
chooses, per portfolio, an existing category (its holdings are replaced; targets, rules and cash are
kept), a new category (name editable; defaults to the portfolio name), or "don't import". The
default is the category with the same name, if any. Portfolios sent to the same category are added
together. Shares are buys minus sells; non-USD rows are skipped. Yahoo's share-class symbols are
turned into the app's form (BRK-B → BRK.B), so they match targets typed in the app. The same rule
applies to every ticker typed in the app and to saved data when it loads.

## Merging and splitting categories (`mergeCategories`, `splitCategory`)

- **Merge** two categories: holdings and cash are added; the targets, money rule, color and place
  in the list of the category the user chooses are kept, and the other category is removed. Past
  purchases of the removed category are re-pointed to the kept one (entries that then collide are
  added together), so the per-category history and undo stay correct.
- **Split** a category: the user chooses how many shares of each stock and how much cash (up to what
  it has) move to a new category, placed right after it, optionally with a copy of its targets;
  the new category's money rule starts as "nothing by default". Past purchases stay with the
  original category.
- Both clear the saved Invest plan, which may refer to the old categories.
- Editing or splitting a category works from what it has when it is saved: shares and cash the
  user didn't change in the editor are taken as stored then (a purchase recorded in another copy
  of the app while the editor was open is kept), and saving is refused, with a message, when a
  number the user changed was also changed elsewhere or the category was deleted or merged
  meanwhile. A split moves only stocks the category still has.

## Stock groups

A category's targets can include a group, e.g. "Corporates" 5% with AMZN and TSLA. It is stored as
ordinary per-stock targets with a `group` label (AMZN 2.5% and TSLA 2.5%, both `group: "Corporates"`),
and the group's target is the sum of its stocks' targets.

In the category editor a group takes one line: its name, its target in the category and its stocks'
names (with their shares when the split isn't equal). Clicking it opens the group's box, where the
user sets the group's target in the category first, then how it is split between its stocks: equally,
or as each stock's share of the group (e.g. AMZN 60% + TSLA 40%), which must add up to 100% (with a
"Scale to 100%"). Saving writes each stock's target as the group's target × its share. A group whose
saved stock targets differ opens with its own split: the shares are shown rounded to 0.01% (adding
up to exactly 100%), and the exact shares behind them count while none of them was retyped (once one
is, the shares shown count, so the stocks' targets always add up to the group's). A group left as it
was saved (same target, split, stocks and shares — not shares made anew by switching the split,
scaling or moving stocks) writes back its stocks' saved targets unchanged, so opening and saving a
category never changes them. Switching to an own split starts from the equal shares.
In the box another single stock of the category can be moved into the group (chosen in a list, then
"Move in"), and a stock taken out of it; the targets move with it so the category's total doesn't
change. Moving in raises the group's target by the stock's target and keeps every stock's part of the
category, so an equal split becomes the group's own split when the parts differ (VXUS 25% and BND
15% → 40%, split 62.5% / 37.5%). A stock without a target joins an equal split as one more equal
part; in an own split, or when the group has no target yet, the others keep their shares and the
stock's share is left to set. Taking out gives the stock its part of the group's target, rounded to
0.01%, and lowers the group's target by exactly that (the others' shares grow to fill the group
again); the last stock taken out gets the group's whole target, and the group is removed with any
blank rows.
Scaling targets to 100% (single stocks and groups) and splitting into shares use largest-remainder
rounding to 0.01%, so no target ends up below 0. A number that can't be read (a stock's target,
share or shares, or a group's target) keeps its text, and blocks saving, also while the stock list
and a group box take turns on screen; when saving is
refused because of something the open group box doesn't show, the box closes so it can be seen.

In the plan a group is balanced as one unit. Step 1 water-fills the category's single stocks and
groups (a group's weight is its total target, its value that of all its stocks together); a group's
money is then water-filled between its allowed stocks, so it goes to those furthest below their part.
So a group at or above its target gets nothing, even when one of its stocks is below its own target.
In the top-up, a category pays for a share of a grouped stock only while it is below target for both
the stock (its part of the group's target among the allowed stocks) and the whole group, at most
2 × the smaller gap, and the objective change counts both. In the balance objective `E` (and the
tests' invariants) a group is one term.

## Skipping stocks in a purchase

On the Invest page the user can untick stocks in the orders list (`PlanOptions.excludeTickers`).
An excluded stock in a group leaves its target to the group's other stocks: the group keeps its
target, and the excluded stock's holdings still count toward it. Otherwise (or when all of a group's
stocks are excluded) the excluded target is dropped and the category's remaining targets are scaled
up proportionally, so the money that would have gone to it is spread over the other stocks (the cap
at the target value then applies to these scaled targets). A category whose stocks are all excluded
keeps its budget as cash.

## Recording what was actually bought

When recording, the user chooses "I bought exactly what was recommended" (the plan is recorded as
is) or "I bought something different": shares and prices of the recommended orders can be changed
(0 = not bought), and stocks that weren't recommended can be added, each for one chosen category
(`ExecutedPurchase.orders[].categoryId`).

## Pages

Portfolio (all categories, the broker view and all purchases with undo), Invest, Categories (the
list and their setup) and Settings. Each category also has its own page (`#/category/<id>`): its
value and cash, its stocks now vs target as two donuts (now and target, same color per stock, at
most six slices with the smallest folded into "Other") with a legend and the full table, and its
purchases. There is no separate history page: purchases show per category, and the full list is on
the Portfolio page.
