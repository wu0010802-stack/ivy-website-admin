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
  // 比對搜尋字就是這次的：只看有沒有搜尋會撿到前一次搜尋（例如剛進頁面時殘留的）的回應。
  // 搜尋字放在 X-Ivy-Search header（百分比編碼的 JSON，2026-10-22 資安稽核），不在網址；
  // 電話形的搜尋字畫面會先正規化成純數字，要傳正規化後的。
  const applied = page.waitForResponse(async (response) => {
    if (response.request().method() !== 'GET') return false
    if (!new URL(response.url()).pathname.endsWith('/admin/visit-requests')) return false
    const header = await response.request().headerValue('x-ivy-search')
    return header !== null && JSON.parse(decodeURIComponent(header)).q === text
  })
  await page.getByRole('textbox', { name: /搜尋家長/ }).fill(text)
  await applied
}

/**
 * 頁面不橫向溢出（R16）：文件寬度不超過視窗。
 * 用 expect.poll 重量到穩定：剛 setViewportSize 的那一格，帶 transition 的元件（例如 el-select
 * 的寬度）還停在舊版面，會量到比視窗寬（2026-11-11 admissions-withdraw 在較快的機器上量到 400／390）。
 * 真的溢出不會自己消失，等滿 2 秒照樣失敗。
 */
export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const measure = () =>
    page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }))
  await expect
    .poll(async () => {
      const { scrollWidth, clientWidth } = await measure()
      return scrollWidth - clientWidth
    }, { message: '頁面橫向溢出的 px 數（文件寬 − 視窗寬）', timeout: 2_000 })
    .toBeLessThanOrEqual(0)
}
