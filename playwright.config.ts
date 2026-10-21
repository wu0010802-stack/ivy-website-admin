import { defineConfig, devices } from '@playwright/test'
import { ADMIN, API_ORIGIN, API_PORT, DB_NAME, STATE_DIR, WEB_ORIGIN, WEB_PORT } from './tests/e2e/e2e-env'

// 公開站端到端測試（tests/e2e）：和 tests/stack 同一套真後端＋隔離測試庫＋Nuxt production build，
// 先 `npm run e2e:build`，再 `npm run test:e2e`。庫名與埠號見 tests/e2e/e2e-env.ts。
//
// 四視口對照桌機／平板／手機（1440、1024 桌機，390、375 手機）。只看伺服器行為、和版面無關的
// spec（轉址、SEO、發布、預覽、後端不可用）只在 1440 跑一次；它們會改共用測試庫的內容，
// 也不該在四個視口各發布一次。8GB RAM：一個 worker、一個瀏覽器。
const SERVER_ONLY = /(legacy-routes|nuxt-rendering|private-preview|public-site|release-freshness|service-unavailable)\.spec\.ts$/

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: './test-results/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report/e2e' }]]
    : [['list']],
  use: {
    baseURL: WEB_ORIGIN,
    reducedMotion: 'reduce',
    locale: 'zh-TW',
    timezoneId: 'Asia/Taipei',
    trace: 'retain-on-failure',
  },
  expect: {
    toHaveScreenshot: { maxDiffPixelRatio: 0.01 },
  },
  projects: [
    {
      name: 'desktop-1440',
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chrome',
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      name: 'desktop-1024',
      testIgnore: SERVER_ONLY,
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chrome',
        viewport: { width: 1024, height: 900 },
      },
    },
    {
      name: 'mobile-390',
      testIgnore: SERVER_ONLY,
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chrome',
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: 'mobile-375',
      testIgnore: SERVER_ONLY,
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chrome',
        viewport: { width: 375, height: 812 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  webServer: [
    {
      command: 'bash tests/stack/start-api.sh',
      url: `${API_ORIGIN}/api/website/v1/health`,
      reuseExistingServer: false,
      timeout: 180_000,
      stdout: 'ignore',
      stderr: 'pipe',
      env: {
        E2E_DB_NAME: DB_NAME,
        E2E_API_PORT: String(API_PORT),
        E2E_WEB_ORIGIN: WEB_ORIGIN,
        E2E_STATE_DIR: STATE_DIR,
        E2E_ADMIN_EMAIL: ADMIN.email,
        E2E_ADMIN_PASSWORD: ADMIN.password,
      },
    },
    {
      command: 'bash tests/stack/start-web.sh',
      url: `${WEB_ORIGIN}/robots.txt`,
      reuseExistingServer: false,
      timeout: 60_000,
      stdout: 'ignore',
      stderr: 'pipe',
      env: {
        E2E_WEB_PORT: String(WEB_PORT),
        E2E_API_ORIGIN: API_ORIGIN,
        E2E_WEB_MODE: 'build',
      },
    },
  ],
})
