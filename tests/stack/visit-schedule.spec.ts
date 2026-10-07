import { mkdirSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { adminApi, submitPublicRequest, type VisitSummary } from './api'
import { gotoAdmin, searchVisitList } from './pages'
import { SECOND_CAMPUS, storageStatePath } from './stack-env'

// 參觀案件行程清單（方向 B）與案件明細（方向 C）的端對端檢查；截圖存 output/（gitignore）給人看，不比對像素。
const SHOTS = 'output/admin-visit-ux-20261006'
const PARENT = '行程清單家長'

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(0)
}

test.describe('參觀案件行程清單與案件明細（2026-10-06）', () => {
  test.use({ storageState: storageStatePath('super_admin') })

  test.beforeAll(async () => {
    mkdirSync(SHOTS, { recursive: true })
    // 前面的測試失敗時 worker 會重啟、beforeAll 再跑一次：場次名額已變，同一個 Idempotency-Key 會變成不同內容被擋，
    // 所以案件已經在就不再送，免得一個失敗連累後面的測試都在 beforeAll 掛掉。
    const api = await adminApi('super_admin')
    const existing = await api.get<VisitSummary[]>(`/admin/visit-requests?q=${encodeURIComponent(PARENT)}`)
    await api.dispose()
    if (existing.length) return
    // 0912000661 已被 booking-flow 的「分頁甲家長」用掉（Idempotency-Key 相同、內容不同會被擋）；
    // 公開送單每來源每校每小時 5 筆，明華在其他 spec 已用掉 4 筆，這裡用文件保留網段 IP 取得獨立額度。
    await submitPublicRequest(SECOND_CAMPUS, PARENT, '0912000881', { forwardedFor: '198.51.100.20' })
  })

  // 其他 spec 也會建案件，接下來可能超過一頁：先搜尋這位家長再找列。
  async function openList(page: Page) {
    await gotoAdmin(page, '/visit-requests', '參觀案件')
    await searchVisitList(page, PARENT)
    await expect(page.locator('.visit-row', { hasText: PARENT })).toBeVisible()
  }

  test('1440：接下來依參觀日分組；點一列右側預覽、不換頁；打開完整案件頁，返回寫頁籤名', async ({ page }) => {
    await openList(page)
    await expect(page.locator('.status-tab.is-active')).toContainText('接下來')
    await expect(page.locator('.visit-day__title').first()).toBeVisible()
    const row = page.locator('.visit-row', { hasText: PARENT })
    await row.locator('a.visit-row__main').click()
    const preview = page.getByRole('complementary', { name: '案件預覽' })
    await expect(preview.getByRole('heading', { level: 2, name: new RegExp(PARENT) })).toBeVisible()
    await expect(page).toHaveURL(/\/admin\/visit-requests(\?[^/]*)?$/)
    await expect(row).toHaveClass(/is-selected/)
    await page.screenshot({ path: `${SHOTS}/list-preview-1440.png`, fullPage: true })
    await preview.getByRole('link', { name: '打開完整案件頁 →' }).click()
    await expect(page.getByRole('heading', { level: 1, name: '案件明細' })).toBeVisible()
    await expect(page.getByRole('button', { name: '參觀案件（接下來）' })).toBeVisible()
    await expect(page.locator('.case-timeline textarea')).toBeVisible()
    await page.screenshot({ path: `${SHOTS}/detail-1440.png`, fullPage: true })
  })

  for (const width of [1280, 1440]) {
    test(`${width}：預覽面板的區塊不被壓扁，捲到最底看得到完整的取消預約`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await openList(page)
      await page.locator('.visit-row', { hasText: PARENT }).locator('a.visit-row__main').click()
      const preview = page.getByRole('complementary', { name: '案件預覽' })
      await expect(preview.getByRole('heading', { level: 2, name: new RegExp(PARENT) })).toBeVisible()
      const cancel = preview.getByRole('button', { name: '取消預約' })
      await expect(cancel).toBeAttached()
      // 面板是高度受限的 flex 直欄、自己捲：區塊（overflow: hidden 的 .panel）被壓扁時內容被截掉也捲不到。
      const squashed = () => page.locator('.visit-preview').evaluate((root) =>
        [...root.children]
          .filter((el) => !el.classList.contains('visually-hidden') && el.scrollHeight > el.clientHeight + 1)
          .map((el) => `${el.className}（內容 ${el.scrollHeight}px，只剩 ${el.clientHeight}px）`))
      await expect.poll(squashed).toEqual([])
      // 捲到最底：取消預約整顆落在面板的可視範圍內（最底的設定列就是它）。
      await page.locator('.visit-preview').evaluate((el) => { el.scrollTop = el.scrollHeight })
      await expect.poll(async () => {
        const [box, button] = await Promise.all([page.locator('.visit-preview').boundingBox(), cancel.boundingBox()])
        return Boolean(box && button && button.y >= box.y && button.y + button.height <= box.y + box.height + 1)
      }).toBe(true)
    })
  }

  test('1280：預覽面板仍在；明細在 1100 是一欄', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await openList(page)
    await page.locator('.visit-row', { hasText: PARENT }).locator('a.visit-row__main').click()
    const preview = page.getByRole('complementary', { name: '案件預覽' })
    await expect(preview).toBeVisible()
    await expectNoHorizontalOverflow(page)
    await page.screenshot({ path: `${SHOTS}/list-preview-1280.png`, fullPage: true })
    // 先在 1280 打開完整案件頁（1280 以下預覽面板就不在了），再縮到 1100 看一欄。
    await preview.getByRole('link', { name: '打開完整案件頁 →' }).click()
    await expect(page.getByRole('heading', { level: 1, name: '案件明細' })).toBeVisible()
    await page.setViewportSize({ width: 1100, height: 900 })
    const timelineLeft = await page.locator('.case-timeline').evaluate((el) => el.getBoundingClientRect().left)
    const factsLeft = await page.locator('.case-facts').evaluate((el) => el.getBoundingClientRect().left)
    expect(factsLeft).toBe(timelineLeft)
    await expectNoHorizontalOverflow(page)
    await page.screenshot({ path: `${SHOTS}/detail-1100.png`, fullPage: true })
  })

  test('390 手機：清單是卡片、不橫向溢出；點列進明細，主鈕與撥號在頁首', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await openList(page)
    const row = page.locator('.visit-row', { hasText: PARENT })
    await expectNoHorizontalOverflow(page)
    await page.screenshot({ path: `${SHOTS}/list-390.png`, fullPage: true })
    await row.locator('a.visit-row__main').click()
    await expect(page.getByRole('heading', { level: 1, name: '案件明細' })).toBeVisible()
    await expect(page.locator('.detail__call')).toBeVisible()
    await expectNoHorizontalOverflow(page)
    const heroBottom = await page.locator('.case-hero').evaluate((el) => el.getBoundingClientRect().bottom)
    const timelineTop = await page.locator('.case-timeline').evaluate((el) => el.getBoundingClientRect().top)
    const factsTop = await page.locator('.case-facts').evaluate((el) => el.getBoundingClientRect().top)
    expect(heroBottom).toBeLessThanOrEqual(timelineTop)
    expect(timelineTop).toBeLessThan(factsTop)
    await page.screenshot({ path: `${SHOTS}/detail-390.png`, fullPage: true })
  })
})
