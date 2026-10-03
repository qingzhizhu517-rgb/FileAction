import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: './e2e',
  testMatch: 'formal-generation.spec.ts',
  workers: 1,
  timeout: 90_000,
  use: { baseURL: process.env.FILEACTION_E2E_BASE_URL ?? 'http://127.0.0.1:18785', headless: true, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
})
