import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: './e2e',
  testMatch: 'formal-real.spec.ts',
  workers: 1,
  timeout: 45_000,
  use: { baseURL: 'http://127.0.0.1:8787', headless: true, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
})
