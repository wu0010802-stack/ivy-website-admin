import { expect, test, type Locator, type Page } from '@playwright/test'
import { gotoAdmin, openAs, skipEntrance } from './pages'
import { SLOTS_CAMPUS, storageStatePath } from './stack-env'

// 鍵盤操作與版面（規格 L37、§9.4）：選單與對話框的 Tab／Escape／焦點返回，以及
// 390px、1440px 都不能橫向溢出。原本只有 deploy/README.md 的手動驗證紀錄。

const MOBILE = { width: 390, height: 844 }
const DESKTOP = { width: 1440, height: 900 }

/** 目前焦點是否在 container 裡。 */
function focusWithin(container: Locator): Promise<boolean> {
  return container.evaluate((el) => el.contains(document.activeElement))
}

/** 連按 Tab，每一步焦點都要留在 container 裡（焦點陷阱）。原生 <dialog> 的 showModal()
 * 在最後一個元素再按 Tab 會把焦點交給瀏覽器介面（document 失去焦點），再按一次回到
 * 對話框：這是瀏覽器的標準行為，只要焦點不會落到背景頁面的元素上就算鎖住。 */
async function expectTabTrapped(page: Page, container: Locator, presses: number, { nativeDialog = false } = {}): Promise<void> {
  for (let i = 0; i < presses; i += 1) {
    await page.keyboard.press('Tab')
    const inside = await focusWithin(container)
    const toBrowserUi = nativeDialog && (await page.evaluate(() => !document.hasFocus() && document.activeElement === document.body))
    expect(inside || toBrowserUi, `第 ${i + 1} 次 Tab 跑到背景頁面了`).toBe(true)
  }
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }))
  expect(scrollWidth, `頁面寬 ${scrollWidth}px，超出視窗 ${clientWidth}px`).toBeLessThanOrEqual(clientWidth)
}

test.describe('官網選單', () => {
  test('手機：Enter 打開選單、焦點進到選單、Escape 關閉並回到開關', async ({ page }) => {
    await page.setViewportSize(MOBILE)
    await page.goto('/campuses/yihua', { waitUntil: 'networkidle' })
    const toggle = page.getByRole('button', { name: '開啟導覽選單' }).filter({ visible: true }).first()
    await toggle.focus()
    await page.keyboard.press('Enter')
    const panel = page.locator('#menu-panel')
    await expect(panel).toBeVisible()
    await expect(page.getByRole('button', { name: '關閉導覽選單' }).filter({ visible: true }).first()).toHaveAttribute('aria-expanded', 'true')
    await expect(panel.locator('a').first()).toBeFocused()
    await page.keyboard.press('Tab')
    expect(await focusWithin(panel)).toBe(true)

    await page.keyboard.press('Escape')
    await expect(panel).toBeHidden()
    await expect(toggle).toBeFocused()
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  })

  test('桌機首頁捲動後的膠囊選單：Escape 關閉並回到膠囊', async ({ page }) => {
    await page.setViewportSize(DESKTOP)
    await page.goto('/', { waitUntil: 'networkidle' })
    await skipEntrance(page)
    await page.mouse.wheel(0, 900)
    const toggle = page.getByRole('button', { name: '開啟導覽選單' }).filter({ visible: true }).first()
    await expect(toggle).toBeVisible()
    await toggle.focus()
    await page.keyboard.press('Enter')
    const panel = page.locator('#menu-panel')
    await expect(panel).toBeVisible()
    await expect(panel.locator('a').first()).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(panel).toBeHidden()
    await expect(toggle).toBeFocused()
  })
})

test('官網個資使用說明對話框：焦點鎖在對話框、Escape 關閉回到按鈕', async ({ page }) => {
  await page.goto(`/visit/${SLOTS_CAMPUS}`, { waitUntil: 'networkidle' })
  const trigger = page.getByRole('button', { name: '閱讀個資使用說明' })
  await trigger.focus()
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog', { name: '個資使用說明' })
  await expect(dialog).toBeVisible()
  expect(await focusWithin(dialog)).toBe(true)
  await expectTabTrapped(page, dialog, 6, { nativeDialog: true })
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(trigger).toBeFocused()
})

test.describe('後台', () => {
  test.use({ storageState: storageStatePath('super_admin') })

  test('上傳素材對話框：焦點鎖在對話框、Escape 關閉回到按鈕', async ({ page }) => {
    await gotoAdmin(page, '/media', '素材庫')
    const trigger = page.getByRole('button', { name: '上傳素材' }).first()
    await trigger.focus()
    await page.keyboard.press('Enter')
    const dialog = page.getByRole('dialog', { name: '上傳素材' })
    await expect(dialog).toBeVisible()
    await expectTabTrapped(page, dialog, 8)
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(trigger).toBeFocused()
  })

  test('手機主選單抽屜：Escape 關閉回到選單按鈕', async ({ page }) => {
    await page.setViewportSize(MOBILE)
    await gotoAdmin(page, '/visit-requests', '參觀案件')
    const trigger = page.getByRole('button', { name: '開啟選單' })
    await trigger.focus()
    await page.keyboard.press('Enter')
    const nav = page.getByRole('navigation', { name: '主選單' })
    await expect(nav).toBeVisible()
    await page.keyboard.press('Tab')
    expect(await focusWithin(page.locator('.admin-nav-drawer'))).toBe(true)
    await page.keyboard.press('Escape')
    await expect(nav).toBeHidden()
    await expect(trigger).toBeFocused()
  })
})

const PUBLIC_PAGES = ['/', '/campuses/yihua', '/curriculum', '/environment', '/admission', '/visit', `/visit/${SLOTS_CAMPUS}`, '/visit/manage']
const ADMIN_PAGES: [string, string][] = [
  ['/', '營運總覽'],
  ['/visit-requests', '參觀案件'],
  ['/visit-calendar', '接待月曆'],
  ['/slots', '時段與容量'],
  ['/booking', '各校預約方式'],
  ['/content/campus-profile?campus=yihua', '五校介紹'],
  ['/content/home-news', '最新消息與活動'],
  ['/media', '素材庫'],
  ['/users', '使用者'],
]

for (const viewport of [MOBILE, DESKTOP]) {
  test(`${viewport.width}px：官網主要頁面沒有橫向溢出`, async ({ page }) => {
    await page.setViewportSize(viewport)
    for (const path of PUBLIC_PAGES) {
      await page.goto(path, { waitUntil: 'networkidle' })
      await test.step(path, () => expectNoHorizontalOverflow(page))
    }
  })

  test(`${viewport.width}px：後台主要頁面沒有橫向溢出`, async ({ browser }) => {
    const { context, page } = await openAs(browser, 'super_admin')
    await page.setViewportSize(viewport)
    for (const [path, heading] of ADMIN_PAGES) {
      await gotoAdmin(page, path, heading)
      await page.waitForLoadState('networkidle')
      await test.step(path, () => expectNoHorizontalOverflow(page))
    }
    await page.context().clearCookies()
    await page.goto('/admin/login')
    await expect(page.getByRole('button', { name: /登入/ }).first()).toBeVisible()
    await test.step('/admin/login', () => expectNoHorizontalOverflow(page))
    await context.close()
  })
}
