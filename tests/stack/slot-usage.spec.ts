import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { expect, test, request } from '@playwright/test'
import { expectNoHorizontalOverflow, gotoAdmin, openAs } from './pages'
import { ROOT, SECOND_CAMPUS, SLOTS_CAMPUS, WEB_ORIGIN } from './stack-env'
import { adminApi, taipeiDate } from './api'

// 2026-10-13 場次使用情況：家長打開義華預約頁讀場次（purpose=new_booking）後，後台
// 參觀場次 → 場次使用情況的「最早能約哪天」至少有 1 次；頁籤進網址，1440／390 不橫向溢出。
// 公開請求一律給自己的來源（X-Forwarded-For），不吃掉別支 spec 的限流額度。

const SHOTS = path.join(ROOT, 'output/playwright')
const USAGE_PATH = `/visit-calendar?campus=${SLOTS_CAMPUS}&tab=usage`
const VIEWPORTS = [
  { name: '1440', device: { viewport: { width: 1440, height: 900 } } },
  { name: '390', device: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
] as const

test.beforeAll(async () => {
  const context = await request.newContext({ baseURL: WEB_ORIGIN, extraHTTPHeaders: { 'X-Forwarded-For': '198.51.100.42' } })
  const response = await context.get(
    `/api/website/v1/public/slots?campus_key=${SLOTS_CAMPUS}&date_from=${taipeiDate(0)}&date_to=${taipeiDate(60)}&purpose=new_booking`,
  )
  expect(response.ok(), await response.text()).toBe(true)
  await context.dispose()
})

for (const { name, device } of VIEWPORTS) {
  test(`${name}px：場次使用情況頁籤有最早能約哪天與各時段表，不橫向溢出`, async ({ browser }) => {
    const { context, page } = await openAs(browser, 'super_admin', device)
    await gotoAdmin(page, USAGE_PATH, '參觀場次')
    await expect(page.getByRole('tab', { name: '場次使用情況', selected: true })).toBeVisible()
    await expect(page.getByRole('heading', { level: 2, name: /^最早能約哪天/ })).toBeVisible()
    await expect(page.getByRole('heading', { level: 2, name: '各時段坐了幾成' })).toBeVisible()
    // 剛才那一次已記下：總結句寫「打開…預約頁 N 次」，N 至少 1。
    await expect(page.locator('.usage__summary')).toContainText(/預約頁 [1-9]\d* 次/)
    await expectNoHorizontalOverflow(page)
    mkdirSync(SHOTS, { recursive: true })
    await page.screenshot({ path: path.join(SHOTS, `slot-usage-${name}.png`), fullPage: true })
    await context.close()
  })
}

test('頁籤寫進網址，切回接待月曆拿掉 tab 並保留校區', async ({ browser }) => {
  const { context, page } = await openAs(browser, 'super_admin')
  await gotoAdmin(page, `/visit-calendar?campus=${SLOTS_CAMPUS}`, '參觀場次')
  await page.getByRole('tab', { name: '場次使用情況' }).click()
  await expect(page).toHaveURL(/tab=usage/)
  await page.getByRole('tab', { name: '接待月曆' }).click()
  await expect(page).not.toHaveURL(/tab=/)
  await expect(page).toHaveURL(new RegExp(`campus=${SLOTS_CAMPUS}`))
  await context.close()
})

test('分校管理者只看得到自己的校', async ({ browser }) => {
  const { context, page } = await openAs(browser, 'campus_admin')
  await gotoAdmin(page, USAGE_PATH, '參觀場次')
  await expect(page.getByRole('heading', { level: 2, name: /^最早能約哪天/ })).toBeVisible()
  // 只看得到一校時，校區選擇器是唯讀標籤（義華），沒有可以選別校的下拉。
  await expect(page.locator('.campus-single')).toContainText('義華')
  await expect(page.getByRole('combobox', { name: '校區' })).toHaveCount(0)
  await context.close()

  // 範圍外的校區：API 視為不存在（和接待月曆一致），不是回空資料。
  const api = await adminApi('campus_admin')
  const denied = await api.context.get(`/api/website/v1/admin/visit-slot-usage?campus_key=${SECOND_CAMPUS}&weeks=12`)
  expect(denied.status(), await denied.text()).toBe(404)
  await api.dispose()
})
