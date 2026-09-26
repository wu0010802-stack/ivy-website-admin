import { expect, test } from '@playwright/test'
import { SLOTS_CAMPUS } from './stack-env'

// SSR hydration（計畫 Task 8 L402）：公開站主要頁面在瀏覽器接手時不能有 hydration
// mismatch。production build 下 Vue 只印「Hydration completed but contains mismatches.」，
// 開發模式會印逐項的 [Vue warn]；兩種都用同一支測試：
//   npm run test:e2e:stack -- hydration                       （production build）
//   E2E_WEB_MODE=dev npm run test:e2e:stack -- hydration      （nuxt dev）

const PAGES = [
  '/',
  '/campuses/yihua',
  '/campuses/minghua',
  '/campuses/renwu',
  '/curriculum',
  '/environment',
  '/admission',
  '/visit',
  `/visit/${SLOTS_CAMPUS}`,
  '/visit/manage',
]

for (const path of PAGES) {
  test(`${path} 沒有 hydration mismatch 或未處理的錯誤`, async ({ page }) => {
    // 開發模式第一次打開要編譯，給寬一點。
    test.setTimeout(process.env.E2E_WEB_MODE === 'dev' ? 180_000 : 60_000)
    const problems: string[] = []
    page.on('console', (message) => {
      if (/hydrat/i.test(message.text())) problems.push(`[${message.type()}] ${message.text()}`)
    })
    page.on('pageerror', (error) => problems.push(`[pageerror] ${error.message}`))

    await page.goto(path, { waitUntil: 'networkidle' })
    // networkidle 時程式已載完、hydration 已跑完；Vue 在 hydration 結束當下同步印警告。
    await expect(page.locator('#__nuxt')).not.toBeEmpty()
    await page.waitForTimeout(300)
    expect(problems).toEqual([])
  })
}
