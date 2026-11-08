import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  workers: 1,
  timeout: 60000,
  use: { browserName: 'chromium', headless: true, actionTimeout: 10000 },
});
