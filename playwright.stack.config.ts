import { defineConfig, devices } from '@playwright/test'
import { API_ORIGIN, API_PORT, DB_NAME, STATE_DIR, USERS, WEB_ORIGIN, WEB_PORT } from './tests/stack/stack-env'

// 端到端測試（tests/stack）：真後端＋每次重建的隔離測試庫＋Nuxt production build
// ＋後台 build。先 `npm run e2e:build`，再 `npm run test:e2e:stack`。
// tests/e2e 是另一組：接在開發中的服務上跑（playwright.config.ts）。
//
// 8GB RAM：只開一個 worker、一個瀏覽器；兩個 webServer 在測試結束時由 Playwright 關閉。
// 截圖基準（visual.spec.ts）是在 macOS 系統字型下拍的；其他平台字型不同，
// 只跑畫面流程、不比對像素（ignoreSnapshots），要更新基準在 macOS 上加 --update-snapshots。
export default defineConfig({
  testDir: './tests/stack',
  outputDir: './test-results/stack',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  timeout: 60_000,
  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report/stack' }]]
    : [['list']],
  ignoreSnapshots: process.platform !== 'darwin',
  expect: {
    timeout: 10_000,
    toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: 'disabled', caret: 'hide' },
  },
  use: {
    baseURL: WEB_ORIGIN,
    reducedMotion: 'reduce',
    locale: 'zh-TW',
    timezoneId: 'Asia/Taipei',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    // 建立各角色帳號與登入狀態、把兩校切到可預約並開場次。
    { name: 'setup', testMatch: /global\.setup\.ts/ },
    {
      name: 'chrome',
      dependencies: ['setup'],
      testIgnore: /global\.setup\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chrome',
        viewport: { width: 1440, height: 900 },
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
        E2E_ADMIN_EMAIL: USERS.super_admin.email,
        E2E_ADMIN_PASSWORD: USERS.super_admin.password,
      },
    },
    {
      command: 'bash tests/stack/start-web.sh',
      url: `${WEB_ORIGIN}/robots.txt`,
      reuseExistingServer: false,
      // E2E_WEB_MODE=dev 是 nuxt dev（只給 hydration.spec.ts 用），啟動要編譯。
      timeout: process.env.E2E_WEB_MODE === 'dev' ? 180_000 : 60_000,
      stdout: 'ignore',
      stderr: 'pipe',
      env: {
        E2E_WEB_PORT: String(WEB_PORT),
        E2E_API_ORIGIN: API_ORIGIN,
        E2E_WEB_MODE: process.env.E2E_WEB_MODE ?? 'build',
      },
    },
  ],
})
