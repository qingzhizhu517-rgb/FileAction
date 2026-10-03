import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  testMatch: 'formal.spec.ts',
  workers: 1,
  timeout: 30_000,
  use: { baseURL: 'http://127.0.0.1:8784', headless: true, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: { command: 'npx vite preview --host 127.0.0.1 --port 8784 --strictPort', url: 'http://127.0.0.1:8784', reuseExistingServer: false },
})

