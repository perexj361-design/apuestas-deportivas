import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';

const installedChromium = process.env.PLAYWRIGHT_CHROMIUM_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:3100',
    locale: 'es-CL',
    timezoneId: 'America/Santiago',
    launchOptions: { ...(installedChromium ? { executablePath: installedChromium } : {}), args: ['--no-sandbox'] },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'node server/index.js',
    url: 'http://127.0.0.1:3100/health',
    reuseExistingServer: false,
    env: { PORT: '3100', DEMO_MODE: 'true', ODDS_API_KEY: '', AI_API_KEY: '', OPENAI_API_KEY: '', NODE_ENV: 'test', TRUST_PROXY: '0' },
  },
});
