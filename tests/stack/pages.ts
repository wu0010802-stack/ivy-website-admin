import { expect, type Browser, type BrowserContext, type BrowserContextOptions, type Page } from '@playwright/test'
import { WEB_ORIGIN, storageStatePath, type StackRole } from './stack-env'

// 同一個測試裡家長與園方各用各的瀏覽器 context（cookie 互不相通），
// 選項和 playwright.stack.config.ts 的 use 一致；device 可換成手機視口與觸控。
export async function openAs(
  browser: Browser,
  role: StackRole | null,
  device: Pick<BrowserContextOptions, 'viewport' | 'isMobile' | 'hasTouch' | 'extraHTTPHeaders' | 'userAgent'> = {},
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    baseURL: WEB_ORIGIN,
    locale: 'zh-TW',
    timezoneId: 'Asia/Taipei',
    reducedMotion: 'reduce',
    viewport: { width: 1440, height: 900 },
    ...device,
    storageState: role ? storageStatePath(role) : undefined,
  })
  return { context, page: await context.newPage() }
}

/** Element Plus 的 ElMessageBox：等對話框出現，按指定按鈕，等它關掉。 */
export async function answerMessageBox(page: Page, title: string, button: string): Promise<void> {
  const dialog = page.getByRole('dialog', { name: title })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: button }).click()
  await expect(dialog).toBeHidden()
}

/** 後台頁面載入完成：側欄與頁面標題都出來了。 */
export async function gotoAdmin(page: Page, path: string, heading: string | RegExp): Promise<void> {
  await page.goto(`/admin${path}`)
  await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible()
}

/** 首次進站布幕在有「減少動態」偏好時不播；保險起見有略過鈕就按掉。 */
export async function skipEntrance(page: Page): Promise<void> {
  const skip = page.getByRole('button', { name: /略過/ })
  if (await skip.count()) await skip.first().click()
}

/**
 * 官網預約月曆（2026-10-02 取代原生下拉）：一次只顯示一個月，選第 index 個（0 起算）開放日期，
 * 不在這個月就往後翻。回傳選到的日期（YYYY-MM-DD）。
 */
export async function pickVisitDate(page: Page, index = 0): Promise<string> {
  const picker = page.getByRole('group', { name: /預約日期/ })
  await expect(picker.getByRole('radio').first()).toBeVisible()
  let passed = 0
  for (;;) {
    const days = picker.getByRole('radio')
    const count = await days.count()
    if (index - passed < count) {
      const day = days.nth(index - passed)
      await day.check()
      return day.inputValue()
    }
    passed += count
    const next = picker.getByRole('button', { name: '下個月' })
    if (await next.isDisabled()) throw new Error(`預約月曆只有 ${passed} 個開放日期，選不到第 ${index + 1} 個`)
    await next.click()
  }
}

/** 官網預約月曆選指定日期（YYYY-MM-DD），不在這個月就往後翻。 */
export async function pickVisitDay(page: Page, date: string): Promise<void> {
  const picker = page.getByRole('group', { name: /預約日期/ })
  await expect(picker.getByRole('radio').first()).toBeVisible()
  const day = picker.locator(`input[name="visitDate"][value="${date}"]`)
  while (!(await day.count())) await picker.getByRole('button', { name: '下個月' }).click()
  await day.check()
}

/**
 * 參觀案件列表搜尋：輸入後 300ms 才送出查詢。要等查詢回來再點列——
 * 太早點開右側預覽的話，稍後才套用的搜尋會把預覽選取清掉（換條件清選取是設計）。
 */
export async function searchVisitList(page: Page, text: string): Promise<void> {
  // 比對 q 的值就是這次的搜尋字：只看網址有沒有 q= 會撿到前一次搜尋（例如剛進頁面時殘留的）的回應。
  // 用 searchParams 解碼比對（空格寫成 + 或 %20 都算），中文與 encodeURIComponent 的結果相同；電話形的搜尋字畫面會先正規化成純數字，要傳正規化後的。
  const applied = page.waitForResponse((response) => {
    if (response.request().method() !== 'GET') return false
    const url = new URL(response.url())
    return url.pathname.endsWith('/admin/visit-requests') && url.searchParams.get('q') === text
  })
  await page.getByRole('textbox', { name: /搜尋家長/ }).fill(text)
  await applied
}

/** 頁面不橫向溢出（R16）：文件寬度不超過視窗。 */
export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }))
  expect(scrollWidth, `頁面寬 ${scrollWidth}px，超出視窗 ${clientWidth}px`).toBeLessThanOrEqual(clientWidth)
}
