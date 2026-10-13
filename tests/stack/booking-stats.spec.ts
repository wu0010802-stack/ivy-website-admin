import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { submitPublicRequest } from './api'
import { expectNoHorizontalOverflow, gotoAdmin, openAs } from './pages'
import { ROOT, SLOTS_CAMPUS } from './stack-env'

// 2026-10-13：成效統計的「各校預約」「預約孩子的班別」搬到招生入學 → 統計分析 → 參觀預約；
// 成效統計只留官網瀏覽與速度。家長在官網送出一筆預約後，參觀預約子分頁的各面板都在、
// 入學學年學期停用，1440／390 不橫向溢出；截圖存 output/playwright/（給人看，不比對像素）。

const SHOTS = path.join(ROOT, 'output/playwright')
const BOOKING_PATH = `/admissions?campus=${SLOTS_CAMPUS}&tab=stats&sub=booking`
const VIEWPORTS = [
  { name: '1440', device: { viewport: { width: 1440, height: 900 } } },
  { name: '390', device: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
] as const

test.beforeAll(async () => {
  await submitPublicRequest(SLOTS_CAMPUS, '參觀預約統計家長', '0912000813')
})

async function openBookingStats(page: Page): Promise<void> {
  await gotoAdmin(page, BOOKING_PATH, '招生入學')
  await expect(page.getByRole('tab', { name: '參觀預約', selected: true })).toBeVisible()
  await expect(page.locator('.funnel__row').first()).toBeVisible()
  await page.waitForLoadState('networkidle')
}

for (const { name, device } of VIEWPORTS) {
  test(`${name}px：招生入學 → 統計分析 → 參觀預約有原本各校預約與班別的面板`, async ({ browser }) => {
    const { context, page } = await openAs(browser, 'super_admin', device)
    await openBookingStats(page)
    for (const heading of [/^五校比較/, /^預約結果・義華校/, /^預約流程/, /^每日變化・義華校/, /^預約孩子的班別・義華校/, /^依來源/, /^預約鈕點擊/]) {
      await expect(page.getByRole('heading', { level: 2, name: heading })).toBeVisible()
    }
    // 送出的那一筆算在「已送出需求」：至少 1。
    await expect(page.locator('.funnel__row').first().locator('.funnel__value')).not.toHaveText('0')
    // 招生統計的範圍說明只屬於招生子分頁。
    await expect(page.getByText('統計範圍：')).toHaveCount(0)
    if (name === '1440') {
      await expect(page.getByText('這個分頁不分入學學年學期')).toBeVisible()
      await expect(page.locator('.admissions__filters .el-select__wrapper.is-disabled')).toHaveCount(2)
    } else {
      await expect(page.locator('.admissions__summary')).toContainText('不分學年學期')
    }
    await expectNoHorizontalOverflow(page)
    mkdirSync(SHOTS, { recursive: true })
    await page.screenshot({ path: path.join(SHOTS, `booking-stats-${name}.png`), fullPage: true })
    await context.close()
  })
}

test('分校管理者只看得到自己的校：參觀預約沒有五校比較，也沒有招生的五校比較子分頁', async ({ browser }) => {
  const { context, page } = await openAs(browser, 'campus_admin')
  await openBookingStats(page)
  await expect(page.getByRole('heading', { level: 2, name: /^預約結果・義華校/ })).toBeVisible()
  await expect(page.getByRole('heading', { level: 2, name: /^五校比較/ })).toHaveCount(0)
  await expect(page.getByRole('tab', { name: '五校比較' })).toHaveCount(0)
  await context.close()
})

for (const { name, device } of VIEWPORTS) {
  test(`${name}px：成效統計只剩官網瀏覽與速度`, async ({ browser }) => {
    const { context, page } = await openAs(browser, 'super_admin', device)
    await gotoAdmin(page, '/analytics?tab=booking', '成效統計')
    await expect(page.getByRole('heading', { level: 2, name: /^瀏覽次數/ })).toBeVisible()
    await expect(page.getByRole('heading', { level: 2, name: /^網頁速度/ })).toBeVisible()
    await expect(page.getByRole('tab')).toHaveCount(0)
    await expect(page.getByRole('heading', { name: /預約流程|預約結果|預約孩子的班別/ })).toHaveCount(0)
    await expectNoHorizontalOverflow(page)
    mkdirSync(SHOTS, { recursive: true })
    await page.screenshot({ path: path.join(SHOTS, `analytics-traffic-only-${name}.png`), fullPage: true })
    await context.close()
  })
}
