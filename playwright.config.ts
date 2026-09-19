import { defineConfig, devices } from '@playwright/test'

// 四視口對照桌機／平板／手機（1440、1024 桌機，390、375 手機）
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false, // 8GB RAM，避免同時多組瀏覽器實例
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3000',
    reducedMotion: 'reduce',
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
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chrome',
        viewport: { width: 1024, height: 900 },
      },
    },
    {
      name: 'mobile-390',
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
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chrome',
        viewport: { width: 375, height: 812 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
})
