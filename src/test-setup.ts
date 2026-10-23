import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Tests never reach the network; code that fetches without an injected fetch sees an offline browser.
globalThis.fetch = () => Promise.reject(new TypeError('Network is disabled in tests'));

afterEach(() => {
  // Some test files run in the plain Node environment, without a DOM.
  if (typeof window === 'undefined') return;
  cleanup();
  window.localStorage.clear();
  window.location.hash = '';
});
