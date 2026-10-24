/// <reference types="vitest/config" />
import { defineConfig, type ProxyOptions } from 'vite';
import react from '@vitejs/plugin-react';

// Yahoo Finance does not allow browser (CORS) requests, so when the app runs
// through `npm start` / `npm run preview`, requests to /api/yahoo/* are
// forwarded by the local Vite server. On static hosting this path does not
// exist and the app falls back to the other price sources.
const proxy: Record<string, ProxyOptions> = {
  '/api/yahoo': {
    target: 'https://query1.finance.yahoo.com',
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/api\/yahoo/, ''),
    headers: { 'User-Agent': 'Mozilla/5.0 (StockBalance personal portfolio app)' },
  },
};

export default defineConfig({
  base: './',
  plugins: [react()],
  server: { proxy },
  preview: { proxy },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}', 'worker/**/*.test.js'],
    setupFiles: ['src/test-setup.ts'],
  },
});
