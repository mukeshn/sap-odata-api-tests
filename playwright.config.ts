import { defineConfig } from '@playwright/test';

const PORT = Number(process.env.SUT_PORT ?? 4173);
const baseURL = process.env.BASE_URL ?? `http://localhost:${PORT}`;
const isCI = !!process.env.CI;

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  reporter: isCI ? [['list'], ['html', { open: 'never' }], ['junit', { outputFile: 'test-results/junit.xml' }]] : [['list'], ['html', { open: 'never' }]],
  use: { baseURL, extraHTTPHeaders: { accept: 'application/json' } },
  webServer: process.env.BASE_URL ? undefined : { command: 'node sut/server.mjs', url: `${baseURL}/health`, reuseExistingServer: !isCI, env: { SUT_PORT: String(PORT) } },
});
