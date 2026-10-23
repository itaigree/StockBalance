import { PAGES, usePage } from './lib/router';
import { useApp } from './state/AppState';
import { PortfolioPage } from './pages/PortfolioPage';
import { InvestPage } from './pages/InvestPage';
import { HistoryPage } from './pages/HistoryPage';
import { CategoriesPage } from './pages/CategoriesPage';
import { SettingsPage } from './pages/SettingsPage';

export function App() {
  const [page] = usePage();
  const { loadError, saveError } = useApp();

  return (
    <>
      <header className="app-header">
        <div className="app-header-inner">
          <div className="brand">⚖️ StockBalance</div>
          <nav className="tabs" aria-label="Main">
            {PAGES.map((p) => (
              <a key={p.id} href={`#/${p.id}`} aria-current={page === p.id ? 'page' : undefined}>
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
        {page === 'portfolio' && <PortfolioPage />}
        {page === 'invest' && <InvestPage />}
        {page === 'history' && <HistoryPage />}
        {page === 'categories' && <CategoriesPage />}
        {page === 'settings' && <SettingsPage />}
      </main>
    </>
  );
}
