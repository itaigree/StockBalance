import { useState } from 'react';
import { useApp } from '../state/AppState';
import { fmtAgo, fmtUsd } from '../lib/format';
import { Modal } from './Modal';
import { NumberField } from './NumberField';

const SOURCE_LABEL = { yahoo: 'Yahoo Finance', finnhub: 'Finnhub', manual: 'entered manually' };

/** Dialog to type a stock's USD price by hand. */
export function PriceEditModal({ ticker, onClose }: { ticker: string; onClose: () => void }) {
  const { data, actions } = useApp();
  const quote = data.prices[ticker];
  const [price, setPrice] = useState<number | null>(quote?.priceUsd ?? null);
  const valid = price !== null && price > 0;

  const save = () => {
    if (!valid) return;
    actions.setManualPrice(ticker, price);
    onClose();
  };

  return (
    <Modal
      title={`Price of ${ticker}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="price-edit-form" disabled={!valid}>
            Save price
          </button>
        </>
      }
    >
      <form
        id="price-edit-form"
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        {quote && (
          <p className="muted small-text">
            Current: {fmtUsd(quote.priceUsd)} ({SOURCE_LABEL[quote.source]}, {fmtAgo(quote.asOf)}).
          </p>
        )}
        <label className="field">
          Price per share (USD)
          <NumberField value={price} onChange={setPrice} prefix="$" aria-label={`Price of ${ticker} in USD`} autoFocus />
          <span className="hint">The next price refresh will replace this with the live price.</span>
        </label>
      </form>
    </Modal>
  );
}
