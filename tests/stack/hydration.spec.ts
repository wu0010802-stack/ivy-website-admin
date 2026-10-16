import { expect, test } from '@playwright/test'
import { SLOTS_CAMPUS } from './stack-env'

// SSR hydration（計畫 Task 8 L402）：公開站主要頁面在瀏覽器接手時不能有 hydration
// mismatch。production build 下 Vue 只印「Hydration completed but contains mismatches.」，
// 開發模式會印逐項的 [Vue warn]；兩種都用同一支測試：
//   npm run test:e2e:stack -- hydration                       （production build）
//   E2E_WEB_MODE=dev npm run test:e2e:stack -- hydration      （nuxt dev）

const PAGES = [
  '/',
  '/curriculum',
  '/about',
  '/environment',
  '/admission',
  '/visit',
  `/visit/${SLOTS_CAMPUS}`,
  '/visit/manage',
]

for (const path of PAGES) {
  test(`${path} 沒有 hydration mismatch 或未處理的錯誤，hydrate 不再讀一次 published-site`, async ({ page }) => {
    // 開發模式第一次打開要編譯，給寬一點。
    test.setTimeout(process.env.E2E_WEB_MODE === 'dev' ? 180_000 : 60_000)
    const problems: string[] = []
    page.on('console', (message) => {
      if (/hydrat/i.test(message.text())) problems.push(`[${message.type()}] ${message.text()}`)
    })
    page.on('pageerror', (error) => problems.push(`[pageerror] ${error.message}`))
    // 驗收 A23「hydrate 不重複讀取」：發布內容由 SSR 讀好放進 payload，瀏覽器接手時沿用，
    // 不在瀏覽器再打一次 /api/published-site（站內換頁才重新讀，見 usePublishedSite）。
    const publishedSiteReads: string[] = []
    page.on('request', (request) => {
      if (new URL(request.url()).pathname === '/api/published-site') publishedSiteReads.push(request.url())
    })

    await page.goto(path, { waitUntil: 'networkidle' })
    // networkidle 時程式已載完、hydration 已跑完；Vue 在 hydration 結束當下同步印警告。
    await expect(page.locator('#__nuxt')).not.toBeEmpty()
    await page.waitForTimeout(300)
    expect(problems).toEqual([])
    expect(publishedSiteReads).toEqual([])
  })
}

// 反向對照：頁面自己打一次 /api/published-site，監聽一定記得到，證明上面「hydrate 不再讀」
// 的空陣列不是因為監聽沒抓到這個路徑。站內換頁同 key 沿用資料、也不重讀（DESIGN「效能第四輪」實測），
// 所以不能拿換頁當對照。
test('published-site 的請求監聽抓得到（hydrate 不讀的反向對照）', async ({ page }) => {
  const publishedSiteReads: string[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/published-site') publishedSiteReads.push(request.url())
  })
  await page.goto('/about', { waitUntil: 'networkidle' })
  expect(publishedSiteReads).toEqual([])
  await page.evaluate(() => fetch('/api/published-site').then((response) => response.status))
  expect(publishedSiteReads).toHaveLength(1)
})
