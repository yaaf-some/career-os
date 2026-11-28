import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.E2E_PORT ?? 18100);

export default defineConfig({
  testDir: './specs',
  outputDir: './artifacts/results',
  // Every spec shares one throwaway database.
  workers: 1,
  timeout: 60_000,
  use: { baseURL: `http://127.0.0.1:${port}`, screenshot: 'only-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } } },
  ],
  webServer: {
    command: `./run-local.sh ${port}`,
    url: `http://127.0.0.1:${port}/healthz`,
    reuseExistingServer: false,
    timeout: 600_000,
  },
});
