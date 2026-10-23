import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Tests never reach the network; code that fetches without an injected fetch sees an offline browser.
globalThis.fetch = () => Promise.reject(new TypeError('Network is disabled in tests'));

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.location.hash = '';
});
