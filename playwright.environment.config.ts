import { defineConfig, devices } from '@playwright/test'

// 只讀 fixture：直接連結、重新整理、歷史還原與捲動都跑真正瀏覽器。
// 全站 test:e2e 也會收 tests/e2e/environment-windows.spec.ts。
// E2E_ENVIRONMENT_BUILD=1 使用正式輸出；仍是本機 fixture，不連正式 API。
const built = process.env.E2E_ENVIRONMENT_BUILD === '1'
const origin = `${built ? 'https' : 'http'}://127.0.0.1:${built ? 3233 : 3232}`
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'environment-windows.spec.ts',
  outputDir: built ? './test-results/environment-build' : './test-results/environment',
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  reporter: [['list']],
  use: {
    baseURL: origin,
    ignoreHTTPSErrors: built, // 本機正式版使用一次性自簽憑證，才可驗證 WebKit 的 Secure cookie。
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
    command: built
      ? 'node tests/e2e/start-environment-built.mjs'
      : 'NUXT_WEBSITE_ENV=development NUXT_PUBLIC_CONTENT_MODE=fixture npm --prefix web run dev -- --port 3232 --host 127.0.0.1',
    url: `${origin}/environment`,
    ignoreHTTPSErrors: built,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
