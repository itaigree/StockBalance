import { useEffect, useState } from 'react';

export type Page = 'portfolio' | 'invest' | 'categories' | 'settings';

/** The main tabs. */
export const PAGES: { id: Page; label: string }[] = [
  { id: 'portfolio', label: 'Portfolio' },
  { id: 'invest', label: 'Invest' },
  { id: 'categories', label: 'Categories' },
  { id: 'settings', label: 'Settings' },
];

/** Where the app is: a main page, or one category's own page (under Categories). */
export type Route = { page: Page } | { page: 'category'; categoryId: string };

export function routeFromHash(hash: string): Route {
  const path = hash.replace(/^#\/?/, '');
  const m = /^category\/(.+)$/.exec(path);
  if (m) return { page: 'category', categoryId: decodeURIComponent(m[1]) };
  return { page: PAGES.some((p) => p.id === path) ? (path as Page) : 'portfolio' };
}

/** The current route, following changes of the URL hash (e.g. "#/invest", "#/category/abc"). */
export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => routeFromHash(window.location.hash));

  useEffect(() => {
    const onHash = () => setRoute(routeFromHash(window.location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  return route;
}

/** Link to a category's own page. */
export function categoryHref(categoryId: string): string {
  return `#/category/${encodeURIComponent(categoryId)}`;
}

/** Go to another page (for buttons deep in the tree). */
export function navigateTo(page: Page): void {
  window.location.hash = `#/${page}`;
  window.scrollTo?.(0, 0);
}
