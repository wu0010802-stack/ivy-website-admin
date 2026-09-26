import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { WEB_ORIGIN, storageStatePath, type StackRole } from './stack-env'

// 同一個測試裡家長與園方各用各的瀏覽器 context（cookie 互不相通），
// 選項和 playwright.stack.config.ts 的 use 一致。
export async function openAs(browser: Browser, role: StackRole | null): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    baseURL: WEB_ORIGIN,
    locale: 'zh-TW',
    timezoneId: 'Asia/Taipei',
    reducedMotion: 'reduce',
    viewport: { width: 1440, height: 900 },
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
