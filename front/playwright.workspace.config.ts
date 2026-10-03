import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e', testMatch: 'workspace.spec.ts', workers: 1,
  use: { baseURL: 'http://127.0.0.1:8785', headless: true, screenshot: 'only-on-failure' },
  webServer: { command: 'npx vite preview --host 127.0.0.1 --port 8785 --strictPort', url: 'http://127.0.0.1:8785', reuseExistingServer: false },
});
