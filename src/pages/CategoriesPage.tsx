import { useState } from 'react';
import type { Category } from '../types';
import { splitContribution } from '../engine';
import { useApp } from '../state/AppState';
import { fmtIls, fmtPercent, fmtShares, isZeroMoney } from '../lib/format';
import { describeRule } from '../lib/rules';
import { CategoryEditor } from '../components/CategoryEditor';
import { Modal } from '../components/Modal';
import { NumberField } from '../components/NumberField';
import './CategoriesPage.css';

export function CategoriesPage() {
  const { data, actions } = useApp();
  const [editing, setEditing] = useState<Category | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Category | null>(null);

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Categories</h1>
          <p className="muted">What each part of your money is for, which stocks it holds, and in what proportions.</p>
        </div>
        <button type="button" onClick={() => setEditing('new')}>
          Add category
        </button>
      </div>

      {data.categories.length === 0 ? (
        <section className="card empty">
          <p>
            No categories yet. Add one for each purpose — for example "Pension", "Kids" and "Investments" — and list the
            stocks it should hold.
          </p>
          <button type="button" onClick={() => setEditing('new')}>
            Add your first category
          </button>
        </section>
      ) : (
        <ul className="category-list">
          {data.categories.map((c, i) => (
            <li key={c.id} className="card">
              <div className="category-row">
                <div className="category-info">
                  <h2 className="row">
                    <span className="dot" style={{ background: c.color }} />
                    {c.name}
                  </h2>
                  <div className="muted small-text">{describeRule(c.contribution)}</div>
                  <div className="targets-summary">
                    {c.targets.length > 0 ? (
                      c.targets.map((t) => (
                        <span key={t.ticker} className="target-chip">
                          <span className="ticker">{t.ticker}</span> {fmtPercent(t.percent, t.percent % 1 === 0 ? 0 : 1)}
                        </span>
                      ))
                    ) : (
                      <span className="warn-text small-text">No target stocks</span>
                    )}
                  </div>
                  <HoldingsSummary category={c} />
                </div>
                <div className="category-actions">
                  <button
                    type="button"
                    className="secondary small"
                    aria-label={`Move ${c.name} up`}
                    disabled={i === 0}
                    onClick={() => actions.moveCategory(c.id, -1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="secondary small"
                    aria-label={`Move ${c.name} down`}
                    disabled={i === data.categories.length - 1}
                    onClick={() => actions.moveCategory(c.id, 1)}
                  >
                    ↓
                  </button>
                  <button type="button" className="secondary small" onClick={() => setEditing(c)}>
                    Edit
                  </button>
                  <button type="button" className="secondary small" onClick={() => setDeleting(c)}>
                    Delete
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {data.categories.length > 0 && <SplitPreview />}

      {editing && (
        <CategoryEditor
          category={editing === 'new' ? null : editing}
          existing={data.categories}
          onClose={() => setEditing(null)}
          onSave={(c) => {
            actions.upsertCategory(c);
            setEditing(null);
          }}
        />
      )}

      {deleting && (
        <Modal
          title={`Delete ${deleting.name}?`}
          onClose={() => setDeleting(null)}
          footer={
            <>
              <button type="button" className="secondary" onClick={() => setDeleting(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="danger"
                onClick={() => {
                  actions.deleteCategory(deleting.id);
                  setDeleting(null);
                }}
              >
                Delete category
              </button>
            </>
          }
        >
          <p>
            {Object.keys(deleting.holdings).length > 0
              ? `Its holdings (${Object.keys(deleting.holdings).length} stock${Object.keys(deleting.holdings).length === 1 ? '' : 's'}) will no longer be tracked. `
              : ''}
            {!isZeroMoney(deleting.cashIls) ? `Its cash (${fmtIls(deleting.cashIls)}) will be forgotten too. ` : ''}
            Past purchases stay in History.
          </p>
          <p className="muted small-text">This can't be undone, except by restoring a backup.</p>
        </Modal>
      )}
    </>
  );
}

function HoldingsSummary({ category }: { category: Category }) {
  const held = Object.entries(category.holdings).filter(([, n]) => n > 0);
  if (held.length === 0 && isZeroMoney(category.cashIls)) return null;
  return (
    <div className="muted small-text">
      Owns{' '}
      {held.length > 0
        ? held.map(([t, n]) => `${fmtShares(n)} ${t}`).join(', ')
        : 'no shares'}
      {!isZeroMoney(category.cashIls) && ` · ${fmtIls(category.cashIls)} cash`}
    </div>
  );
}

function SplitPreview() {
  const { data } = useApp();
  const [total, setTotal] = useState<number | null>(10000);
  const split = splitContribution(total ?? 0, data.categories);

  return (
    <section className="card split-preview" aria-labelledby="split-preview-title">
      <div className="card-header">
        <h2 id="split-preview-title">How money is split</h2>
        <label className="row">
          <span className="muted">If you invest</span>
          <NumberField value={total} onChange={setTotal} prefix="₪" aria-label="Example amount to invest" />
        </label>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Category</th>
              <th>Rule</th>
              <th className="num">Gets</th>
            </tr>
          </thead>
          <tbody>
            {data.categories.map((c) => (
              <tr key={c.id}>
                <td>
                  <span className="dot" style={{ background: c.color }} />
                  {c.name}
                </td>
                <td className="muted">{describeRule(c.contribution)}</td>
                <td className="num">{fmtIls(split.amounts[c.id] ?? 0)}</td>
              </tr>
            ))}
            {split.unassignedIls > 0 && (
              <tr>
                <td colSpan={2} className="warn-text">
                  Not assigned to any category
                </td>
                <td className="num warn-text">{fmtIls(split.unassignedIls)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {split.warnings.length > 0 && (
        <div className="banner warn">
          {split.warnings.map((w) => (
            <div key={w}>{w}</div>
          ))}
        </div>
      )}
      <p className="muted small-text">You can still change each amount on the Invest page before buying.</p>
    </section>
  );
}
