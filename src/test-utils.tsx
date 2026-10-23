import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AppData } from './types';
import { App } from './App';
import { AppStateProvider } from './state/AppState';
import type { Page } from './lib/router';
import { emptyData } from './data/schema';
import { sampleData } from './data/sample';

/** Render the whole app on a page with the given data (no storage load, no start-up refresh). */
export function renderApp(page: Page, data: AppData = emptyData()) {
  window.location.hash = `#/${page}`;
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
