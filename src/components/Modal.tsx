import { useEffect, useRef, useState, type ReactNode } from 'react';

interface Props {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Buttons shown at the bottom. */
  footer?: ReactNode;
  wide?: boolean;
}

/** Simple accessible modal dialog. Closes on Escape or backdrop click. */
export function Modal({ title, onClose, children, footer, wide }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  // Where focus was when the dialog opened, read while rendering — before an autoFocus field inside
  // the dialog takes it — so it can go back there on close.
  const [previous] = useState(() => document.activeElement as HTMLElement | null);
  /** The field inside the dialog that took focus on opening (autoFocus), to keep it there. */
  const initialFocus = useRef<HTMLElement | null>(null);

  // Runs once per opening: parents often pass a new onClose on every render, and re-running this
  // would steal focus from inputs inside the dialog.
  useEffect(() => {
    if (ref.current?.contains(document.activeElement)) initialFocus.current = document.activeElement as HTMLElement;
    // In development React runs this twice, and the first cleanup has given focus back to `previous`.
    else (initialFocus.current ?? ref.current)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
  }, [previous]);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onCloseRef.current()}>
      <div
        className={`modal${wide ? ' wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        tabIndex={-1}
        ref={ref}
      >
        <header className="modal-header">
          <h2 id="modal-title">{title}</h2>
          <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-footer">{footer}</footer>}
      </div>
    </div>
  );
}
