import { expect, test, type Page } from '@playwright/test'
import { expectNoHorizontalOverflow, gotoAdmin } from './pages'
import { storageStatePath } from './stack-env'

// 2026-10-13 桌機側欄可以收成 64px 圖示欄（同園務系統）：實際寬度、重新整理後記得、
// 圖示的浮動提示（滑鼠與鍵盤）、收著時用搜尋會先展開。

test.use({ storageState: storageStatePath('super_admin') })

async function sideWidth(page: Page): Promise<number> {
  return Math.round((await page.locator('aside.side').boundingBox())?.width ?? 0)
}

test('收合成 64px 圖示欄、內容接著變寬，重新整理後仍收著', async ({ page }) => {
  await gotoAdmin(page, '/visit-requests', '參觀案件')
  await expect.poll(() => sideWidth(page)).toBe(260)
  await page.screenshot({ path: test.info().outputPath('expanded.png') })

  await page.getByRole('button', { name: '收合側邊欄' }).click()
  await expect.poll(() => sideWidth(page)).toBe(64)
  await expect.poll(async () => Math.round((await page.locator('header.top').boundingBox())?.x ?? 0)).toBe(64)
  await expectNoHorizontalOverflow(page)
  // 平常收起來的「全站與素材」也列出來，點了照常換頁、側欄維持收著。
  const nav = page.getByRole('navigation', { name: '主選單' })
  await expect(nav.getByRole('link', { name: '素材庫' })).toBeVisible()
  await page.screenshot({ path: test.info().outputPath('collapsed.png') })

  await page.reload()
  await expect(page.getByRole('heading', { level: 1, name: '參觀案件' })).toBeVisible()
  await expect.poll(() => sideWidth(page)).toBe(64)
  await nav.getByRole('link', { name: '素材庫' }).click()
  await expect(page.getByRole('heading', { level: 1, name: '素材庫' })).toBeVisible()
  await expect.poll(() => sideWidth(page)).toBe(64)

  await page.getByRole('button', { name: '展開側邊欄' }).click()
  await expect.poll(() => sideWidth(page)).toBe(260)
  await expect(page.getByRole('button', { name: '收合側邊欄' })).toBeFocused()
})

test('圖示欄的名稱：滑鼠滑過與鍵盤停到都會出現', async ({ page }) => {
  await gotoAdmin(page, '/', '營運總覽')
  await page.getByRole('button', { name: '收合側邊欄' }).click()
  const nav = page.getByRole('navigation', { name: '主選單' })

  const tip = page.locator('[role="tooltip"]', { hasText: '參觀場次' })

  await nav.getByRole('link', { name: '參觀場次' }).hover()
  await expect(tip).toBeVisible()
  await page.screenshot({ path: test.info().outputPath('tooltip-hover.png'), animations: 'disabled' })
  await page.mouse.move(900, 600)
  await expect(tip).toBeHidden()

  // 鍵盤：沒有滑鼠停在上面，焦點移到哪一項就出現哪一項的名稱。
  await nav.getByRole('link', { name: '參觀案件' }).focus()
  await page.keyboard.press('ArrowDown')
  await expect(nav.getByRole('link', { name: '參觀場次' })).toBeFocused()
  await expect(tip).toBeVisible()
  await expect(page.locator('[role="tooltip"]', { hasText: '參觀案件' })).toBeHidden()
})

test('收著時按搜尋鈕或 Ctrl+K：側欄展開、焦點在搜尋框，Enter 前往第一筆', async ({ page }) => {
  await gotoAdmin(page, '/', '營運總覽')
  await page.getByRole('button', { name: '收合側邊欄' }).click()

  await page.getByRole('button', { name: '搜尋功能' }).click()
  await expect.poll(() => sideWidth(page)).toBe(260)
  const search = page.getByRole('textbox', { name: '搜尋後台功能' })
  await expect(search).toBeFocused()

  await page.getByRole('button', { name: '收合側邊欄' }).click()
  await page.locator('main').click({ position: { x: 10, y: 10 } })
  await page.keyboard.press('Control+k')
  await expect.poll(() => sideWidth(page)).toBe(260)
  await expect(search).toBeFocused()
  await search.fill('素材')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { level: 1, name: '素材庫' })).toBeVisible()
})
