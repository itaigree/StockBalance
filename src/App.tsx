import { useEffect } from 'react';
import { PAGES, useRoute } from './lib/router';
import { useApp } from './state/AppState';
import { PortfolioPage } from './pages/PortfolioPage';
import { InvestPage } from './pages/InvestPage';
import { CategoriesPage } from './pages/CategoriesPage';
import { CategoryPage } from './pages/CategoryPage';
import { SettingsPage } from './pages/SettingsPage';

export function App() {
  const route = useRoute();
  const { loadError, saveError } = useApp();
  const tab = route.page === 'category' ? 'categories' : route.page;
  const where = route.page === 'category' ? `category/${route.categoryId}` : route.page;

  // Start each page at the top.
  useEffect(() => {
    window.scrollTo?.(0, 0);
  }, [where]);

  return (
    <>
      <header className="app-header">
        <div className="app-header-inner">
          <div className="brand">⚖️ StockBalance</div>
          <nav className="tabs" aria-label="Main">
            {PAGES.map((p) => (
              <a key={p.id} href={`#/${p.id}`} aria-current={tab === p.id ? 'page' : undefined}>
                {p.label}
              </a>
            ))}
          </nav>
        </div>
      </header>
      <main>
        {loadError && (
          <div className="banner error" role="alert">
            {loadError}
          </div>
        )}
        {saveError && (
          <div className="banner error" role="alert">
            Your changes could not be saved in this browser: {saveError} Export a backup from Settings to keep them.
          </div>
        )}
        {route.page === 'portfolio' && <PortfolioPage />}
        {route.page === 'invest' && <InvestPage />}
        {route.page === 'categories' && <CategoriesPage />}
        {route.page === 'category' && <CategoryPage categoryId={route.categoryId} />}
        {route.page === 'settings' && <SettingsPage />}
      </main>
    </>
  );
}
