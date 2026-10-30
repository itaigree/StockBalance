import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import type { AppData, Category, FxQuote, Id, PriceQuote, Settings, Transaction } from '../types';
import { applyTransaction, revertTransaction } from '../engine';
import { loadData, saveData, STORAGE_KEY } from '../data/storage';
import { parseAppData } from '../data/schema';
import { fetchPrices } from '../data/prices';
import { fetchUsdIls } from '../data/fx';

type Action =
  | { type: 'replace'; data: AppData }
  | { type: 'upsertCategory'; category: Category }
  | { type: 'deleteCategory'; id: Id }
  | { type: 'moveCategory'; id: Id; delta: -1 | 1 }
  | { type: 'setPrices'; quotes: Record<string, PriceQuote> }
  | { type: 'setManualPrice'; ticker: string; priceUsd: number; asOf: string }
  | { type: 'setFx'; fx: FxQuote | null }
  | { type: 'updateSettings'; patch: Partial<Settings> }
  | { type: 'recordTransaction'; tx: Transaction }
  | { type: 'undoTransaction'; id: Id };

export function reducer(state: AppData, action: Action): AppData {
  switch (action.type) {
    case 'replace':
      return action.data;
    case 'upsertCategory': {
      const exists = state.categories.some((c) => c.id === action.category.id);
      const categories = exists
        ? state.categories.map((c) => (c.id === action.category.id ? action.category : c))
        : [...state.categories, action.category];
      return { ...state, categories };
    }
    case 'deleteCategory':
      return { ...state, categories: state.categories.filter((c) => c.id !== action.id) };
    case 'moveCategory': {
      const i = state.categories.findIndex((c) => c.id === action.id);
      const j = i + action.delta;
      if (i < 0 || j < 0 || j >= state.categories.length) return state;
      const categories = [...state.categories];
      [categories[i], categories[j]] = [categories[j], categories[i]];
      return { ...state, categories };
    }
    case 'setPrices':
      return { ...state, prices: { ...state.prices, ...action.quotes } };
    case 'setManualPrice':
      return {
        ...state,
        prices: { ...state.prices, [action.ticker]: { priceUsd: action.priceUsd, asOf: action.asOf, source: 'manual' } },
      };
    case 'setFx':
      return { ...state, fx: action.fx };
    case 'updateSettings':
      return { ...state, settings: { ...state.settings, ...action.patch } };
    case 'recordTransaction':
      return {
        ...state,
        categories: applyTransaction(state.categories, action.tx),
        transactions: [...state.transactions, action.tx],
      };
    case 'undoTransaction': {
      const tx = state.transactions.find((t) => t.id === action.id);
      if (!tx) return state;
      return {
        ...state,
        categories: revertTransaction(state.categories, tx),
        transactions: state.transactions.filter((t) => t !== tx),
      };
    }
  }
}

export interface MarketStatus {
  loading: boolean;
  /** ISO time of the last finished refresh (this session). */
  lastRun: string | null;
  /** Per-ticker reasons from the last refresh. */
  priceFailures: Record<string, string>;
  fxError: string | null;
}

export interface AppActions {
  /** Replace the data with an edited version of it (merge, split, import). */
  replaceData(data: AppData): void;
  /**
   * Replace everything with data from elsewhere (a backup, the sample, or nothing): prices and the
   * exchange rate are fetched again for it.
   */
  startOver(data: AppData): void;
  upsertCategory(category: Category): void;
  deleteCategory(id: Id): void;
  moveCategory(id: Id, delta: -1 | 1): void;
  setManualPrice(ticker: string, priceUsd: number): void;
  setManualFx(usdIls: number): void;
  updateSettings(patch: Partial<Settings>): void;
  recordTransaction(tx: Transaction): void;
  undoTransaction(id: Id): void;
  /** Fetch prices for every held/target ticker (or the given ones) and the USD/ILS rate. */
  refreshMarket(tickers?: string[]): Promise<void>;
}

export interface AppContextValue {
  data: AppData;
  actions: AppActions;
  market: MarketStatus;
  /** Problem loading saved data (shown once as a banner). */
  loadError: string | null;
  /** Problem saving data (e.g. storage full or disabled). */
  saveError: string | null;
}

const AppContext = createContext<AppContextValue | null>(null);

/** Every ticker that is held or targeted by any category, sorted. */
export function allTickers(categories: Category[]): string[] {
  const set = new Set<string>();
  for (const c of categories) {
    for (const t of c.targets) set.add(t.ticker);
    for (const [t, shares] of Object.entries(c.holdings)) if (shares !== 0) set.add(t);
  }
  return [...set].sort();
}

/** ticker → USD price, only for valid (finite, positive) prices. */
export function priceMap(prices: Record<string, PriceQuote>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [t, q] of Object.entries(prices)) if (Number.isFinite(q.priceUsd) && q.priceUsd > 0) out[t] = q.priceUsd;
  return out;
}

export function AppStateProvider({ children, initialData }: { children: ReactNode; initialData?: AppData }) {
  const [initial] = useState(() => (initialData ? { data: initialData } : loadData()));
  const [data, dispatch] = useReducer(reducer, initial.data);
  const [loadError, setLoadError] = useState<string | null>(initial.error ?? null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [market, setMarket] = useState<MarketStatus>({ loading: false, lastRun: null, priceFailures: {}, fxError: null });

  // Persist every change (except data that just came from storage, which is already saved).
  const fromStorage = useRef<AppData | null>(null);
  useEffect(() => {
    if (data === fromStorage.current) return;
    setSaveError(saveData(data).error ?? null);
  }, [data]);

  // Another copy of the app (another tab, or the installed app) saved newer data: take it, so this
  // copy doesn't later save its older data over it.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY || e.newValue === null) return;
      let json: unknown;
      try {
        json = JSON.parse(e.newValue);
      } catch {
        return;
      }
      const parsed = parseAppData(json);
      if (!parsed.ok) return;
      fromStorage.current = parsed.data;
      // What is saved can be read now (e.g. a backup restored in the other copy).
      setLoadError(null);
      dispatch({ type: 'replace', data: parsed.data });
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const dataRef = useRef(data);
  dataRef.current = data;

  /** Tickers already requested this session, so failing ones aren't retried on every change. */
  const requested = useRef(new Set<string>());
  const refreshedOnce = useRef(false);
  /** Bumped by `startOver`, so the refresh below runs even when the stocks are the same. */
  const [generation, setGeneration] = useState(0);
  const inFlight = useRef(0);

  const refreshMarket = useCallback(async (tickers?: string[]) => {
    refreshedOnce.current = true;
    const current = dataRef.current;
    // With manual prices only the exchange rate is fetched.
    const list = current.settings.priceProvider === 'manual' ? [] : (tickers ?? allTickers(current.categories));
    for (const t of list) requested.current.add(t);
    inFlight.current++;
    setMarket((m) => ({ ...m, loading: true }));
    const [priceResult, fxResult] = await Promise.all([
      fetchPrices(list, current.settings),
      // Pricing some tickers (stocks just added) leaves the exchange rate alone, e.g. one typed by hand.
      tickers ? Promise.resolve(null) : fetchUsdIls(current.settings),
    ]);
    inFlight.current--;
    if (Object.keys(priceResult.quotes).length > 0) dispatch({ type: 'setPrices', quotes: priceResult.quotes });
    if (fxResult && 'quote' in fxResult) dispatch({ type: 'setFx', fx: fxResult.quote });
    setMarket((m) => {
      // A refresh of some tickers only replaces what is known about those tickers.
      const failures = tickers ? { ...m.priceFailures } : {};
      for (const t of list) delete failures[t];
      return {
        loading: inFlight.current > 0,
        lastRun: new Date().toISOString(),
        priceFailures: { ...failures, ...priceResult.failures },
        fxError: fxResult === null ? m.fxError : 'error' in fxResult ? fxResult.error : null,
      };
    });
  }, []);

  // Refresh everything once at start-up (as soon as there is something to price), and fetch prices
  // for stocks added later that have none yet.
  const tickersKey = allTickers(data.categories).join(',');
  useEffect(() => {
    if (initialData) return;
    const d = dataRef.current;
    if (d.categories.length === 0) return;
    if (!refreshedOnce.current) {
      void refreshMarket();
      return;
    }
    if (d.settings.priceProvider === 'manual') return;
    const missing = allTickers(d.categories).filter((t) => !(d.prices[t]?.priceUsd > 0) && !requested.current.has(t));
    if (missing.length > 0) void refreshMarket(missing);
  }, [tickersKey, generation, refreshMarket, initialData]);

  const actions = useMemo<AppActions>(
    () => ({
      replaceData: (d) => dispatch({ type: 'replace', data: d }),
      startOver: (d) => {
        // New data: fetch everything again (prices and the exchange rate) once it has stocks.
        requested.current.clear();
        refreshedOnce.current = false;
        // Restoring a backup or starting anew is what the "couldn't be read" message asks for.
        setLoadError(null);
        dispatch({ type: 'replace', data: d });
        setGeneration((g) => g + 1);
      },
      upsertCategory: (category) => dispatch({ type: 'upsertCategory', category }),
      deleteCategory: (id) => dispatch({ type: 'deleteCategory', id }),
      moveCategory: (id, delta) => dispatch({ type: 'moveCategory', id, delta }),
      setManualPrice: (ticker, priceUsd) =>
        dispatch({ type: 'setManualPrice', ticker, priceUsd, asOf: new Date().toISOString() }),
      setManualFx: (usdIls) =>
        dispatch({ type: 'setFx', fx: { usdIls, asOf: new Date().toISOString(), source: 'manual' } }),
      updateSettings: (patch) => dispatch({ type: 'updateSettings', patch }),
      recordTransaction: (tx) => dispatch({ type: 'recordTransaction', tx }),
      undoTransaction: (id) => dispatch({ type: 'undoTransaction', id }),
      refreshMarket,
    }),
    [refreshMarket],
  );

  const value = useMemo(
    () => ({ data, actions, market, loadError, saveError }),
    [data, actions, market, loadError, saveError],
  );
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside <AppStateProvider>');
  return ctx;
}
