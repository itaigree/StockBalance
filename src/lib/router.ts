import { useCallback, useEffect, useState } from 'react';

export type Page = 'portfolio' | 'invest' | 'history' | 'categories' | 'settings';

export const PAGES: { id: Page; label: string }[] = [
  { id: 'portfolio', label: 'Portfolio' },
  { id: 'invest', label: 'Invest' },
  { id: 'history', label: 'History' },
  { id: 'categories', label: 'Categories' },
  { id: 'settings', label: 'Settings' },
];

function pageFromHash(hash: string): Page {
  const id = hash.replace(/^#\/?/, '');
  return PAGES.some((p) => p.id === id) ? (id as Page) : 'portfolio';
}

/** Current page (from the URL hash, e.g. "#/invest") and a function to go to another page. */
export function usePage(): [Page, (page: Page) => void] {
  const [page, setPage] = useState<Page>(() => pageFromHash(window.location.hash));

  useEffect(() => {
    const onHash = () => setPage(pageFromHash(window.location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const navigate = useCallback((next: Page) => {
    window.location.hash = `#/${next}`;
    window.scrollTo?.(0, 0);
  }, []);

  return [page, navigate];
}

/** Navigate without the hook (for buttons deep in the tree). */
export function navigateTo(page: Page): void {
  window.location.hash = `#/${page}`;
  window.scrollTo?.(0, 0);
}
