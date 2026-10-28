import { useMemo, useState } from 'react';
import { valueCategory } from '../engine';
import { priceMap, useApp } from '../state/AppState';
import { navigateTo } from '../lib/router';
import { describeRule } from '../lib/rules';
import { fmtIls, fmtUsd, isZeroMoney } from '../lib/format';
import { CategoryEditor } from '../components/CategoryEditor';
import { CategoryPurchases } from '../components/CategoryPurchases';
import { PositionsTable } from '../components/PositionsTable';
import { PriceEditModal } from '../components/PriceEditModal';
import { StockDonuts } from '../components/StockDonuts';

/** One category in detail: its value, its mix of stocks now vs target, and its purchases. */
export function CategoryPage({ categoryId }: { categoryId: string }) {
  const { data, actions } = useApp();
  const [editing, setEditing] = useState(false);
  const [editingPrice, setEditingPrice] = useState<string | null>(null);
  const prices = useMemo(() => priceMap(data.prices), [data.prices]);
  const category = data.categories.find((c) => c.id === categoryId);

  if (!category) {
    return (
      <section className="card empty">
        <p>This category no longer exists — it may have been deleted or merged into another one.</p>
        <button type="button" onClick={() => navigateTo('categories')}>
          See all categories
        </button>
      </section>
    );
  }

  const valuation = valueCategory(category, prices);
  const rate = data.fx?.usdIls ?? null;
  const negativeCash = category.cashIls < 0 && !isZeroMoney(category.cashIls);

  return (
    <>
      <a href="#/categories" className="back-link">
        ‹ All categories
      </a>
      <div className="page-header">
        <div>
          <h1 className="row">
            <span className="dot" style={{ background: category.color }} />
            {category.name}
          </h1>
          <p className="muted">{describeRule(category.contribution)}</p>
        </div>
        <button type="button" className="secondary" onClick={() => setEditing(true)}>
          Edit category
        </button>
      </div>

      <section className="card summary" aria-label="Summary">
        <div className="grid">
          <div>
            <div className="muted small-text">Total value</div>
            <div className="big-number">
              {rate ? fmtIls(valuation.investedUsd * rate + category.cashIls, true) : fmtUsd(valuation.investedUsd, true)}
            </div>
            <div className="muted small-text">{rate ? 'Stocks and cash' : 'Set the USD/ILS rate to see shekel values'}</div>
          </div>
          <div>
            <div className="muted small-text">In stocks</div>
            <div className="big-number">{fmtUsd(valuation.investedUsd, true)}</div>
            {rate && <div className="muted small-text">{fmtIls(valuation.investedUsd * rate, true)}</div>}
          </div>
          <div>
            <div className="muted small-text">Cash</div>
            <div className={`big-number${negativeCash ? ' bad-text' : ''}`}>{fmtIls(category.cashIls, true)}</div>
            <div className="muted small-text">Kept for the next purchase</div>
          </div>
        </div>
      </section>

      <section className="card" aria-labelledby="mix-title">
        <h2 id="mix-title">Stocks now and target</h2>
        {valuation.positions.length > 0 ? (
          <>
            <StockDonuts category={category} valuation={valuation} />
            <PositionsTable category={category} valuation={valuation} onEditPrice={setEditingPrice} />
          </>
        ) : (
          <p className="muted">
            No stocks yet.{' '}
            <button type="button" className="link-button" onClick={() => setEditing(true)}>
              Choose its stocks
            </button>
          </p>
        )}
      </section>

      <h2 className="section-title">Purchases</h2>
      <CategoryPurchases category={category} transactions={data.transactions} />
      {data.transactions.length > 0 && (
        <p className="muted small-text">To undo a purchase, open "All purchases" at the bottom of the Portfolio page.</p>
      )}

      {editing && (
        <CategoryEditor
          category={category}
          existing={data.categories}
          onClose={() => setEditing(false)}
          onSave={(c) => {
            actions.upsertCategory(c);
            setEditing(false);
          }}
        />
      )}
      {editingPrice && <PriceEditModal ticker={editingPrice} onClose={() => setEditingPrice(null)} />}
    </>
  );
}
