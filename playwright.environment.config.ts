import { defineConfig, devices } from '@playwright/test'

// 只讀 fixture：直接連結、重新整理、歷史還原與捲動都跑真正瀏覽器。
// 全站 test:e2e 也會收 tests/e2e/environment-windows.spec.ts。
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'environment-windows.spec.ts',
  outputDir: './test-results/environment',
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:3232',
    locale: 'zh-TW',
    timezoneId: 'Asia/Taipei',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop-chrome', use: { ...devices['Desktop Chrome'], channel: 'chrome', viewport: { width: 1440, height: 900 } } },
    { name: 'desktop-webkit', use: { ...devices['Desktop Safari'], viewport: { width: 1440, height: 900 } } },
    { name: 'mobile-chrome', use: { ...devices['Pixel 5'], channel: 'chrome', viewport: { width: 390, height: 844 } } },
    { name: 'mobile-webkit', use: { ...devices['iPhone 13'], viewport: { width: 390, height: 844 } } },
  ],
  webServer: {
    command: 'NUXT_WEBSITE_ENV=development NUXT_PUBLIC_CONTENT_MODE=fixture npm --prefix web run dev -- --port 3232 --host 127.0.0.1',
    url: 'http://127.0.0.1:3232/environment',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
