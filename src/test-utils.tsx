import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AppData } from './types';
import { App } from './App';
import { AppStateProvider } from './state/AppState';
import { emptyData } from './data/schema';
import { sampleData } from './data/sample';

/**
 * Render the whole app at a route (e.g. "invest" or "category/sample-kids") with the given data
 * (no storage load, no start-up refresh).
 */
export function renderApp(route: string, data: AppData = emptyData()) {
  window.location.hash = `#/${route}`;
  const user = userEvent.setup();
  const utils = render(
    <AppStateProvider initialData={data}>
      <App />
    </AppStateProvider>,
  );
  return { user, ...utils };
}

/** Sample data with fixed timestamps. */
export const sample = () => sampleData(new Date('2026-10-23T10:00:00Z'));

/** The data currently saved by the app. */
export function savedData(): AppData {
  return JSON.parse(window.localStorage.getItem('stockbalance:data') ?? 'null') as AppData;
}
