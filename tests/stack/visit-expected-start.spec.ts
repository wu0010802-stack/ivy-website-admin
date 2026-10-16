import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { adminApi, findVisit, taipeiDate } from './api'
import { startVisitSlot } from './db'
import { expectNoHorizontalOverflow, gotoAdmin, openAs, pickVisitDay } from './pages'
import { ROOT, SLOTS_CAMPUS } from './stack-env'

// 2026-10-15 預計入學時間：家長在官網選一個月份送出 → 成功頁與後台明細看得到 → 標到場後招生訪視的入學學期就是那一學期；
// 表單在 1440 與 390 都不橫向溢出（截圖存 output/playwright）。
// 選項依台北今天動態算，所以不寫死學期：取頁面上第一個不是「盡快」「還不確定」的月份，斷言它的顯示文字與值。
// 公開送單用自己的來源 IP（每來源每校每小時 5 筆，不吃別支 spec 的額度）。
const SHOTS = path.join(ROOT, 'output/playwright')
const PARENT = '預計入學家長'
const CHILD = '預計入學寶貝'

test('家長選預計入學時間 → 後台明細看得到 → 到場後帶進招生的入學學期', async ({ browser }) => {
  const api = await adminApi('super_admin')
  // 專用場次：21 天後 16:40–17:10、容量 1。startVisitSlot 只在這一場只有這一筆預約時才移得動，不能用月曆的第一個場次。
  const slotDate = taipeiDate(21)
  await api.send('POST', `/admin/slots?campus_key=${SLOTS_CAMPUS}`, { slot_date: slotDate, start_time: '16:40:00', end_time: '17:10:00', capacity: 1 })
  const parent = await openAs(browser, null, { extraHTTPHeaders: { 'X-Forwarded-For': '198.51.100.61' } })
  const { page } = parent
  let chosen = ''
  let chosenText = ''

  await test.step('家長選日期、場次、預計入學時間後送出', async () => {
    await page.goto(`/visit/${SLOTS_CAMPUS}`)
    await pickVisitDay(page, slotDate)
    await page.locator('.visit-slot-options label', { hasText: '16:40' }).locator('input').check()
    await page.getByLabel('孩子姓名').fill(CHILD)
    await page.getByLabel('孩子出生年月日').fill('2023-03-15')
    const start = page.getByRole('group', { name: /預計入學時間/ })
    const option = start.locator('input[type="radio"]:not([value="asap"]):not([value="unsure"])').first()
    chosen = await option.inputValue()
    chosenText = (await option.locator('xpath=following-sibling::span').innerText()).trim()
    expect(chosen).toMatch(/^1\d{2}-[12]$/)
    expect(chosenText).toMatch(/^\d{4} 年 \d{1,2} 月$/)
    await option.check()
    await expect(option).toBeChecked()
    // 再點一次就取消，再點回來。
    await option.click()
    await expect(option).not.toBeChecked()
    await option.check()
    await expect(option).toBeChecked()
    await page.getByLabel('家長稱呼').fill(PARENT)
    await page.getByLabel('聯絡電話').fill('0955000616')
    await page.getByLabel('聯絡 Email').fill('expected-start@example.com')
    await page.getByRole('button', { name: '確認預約' }).click()
    await expect(page.locator('#booking-result')).toContainText('預約成功')
    // 孩子與家長的姓名也含「預計入學」，所以用 dt 的完整文字找那一列。
    await expect(page.locator('.visit-result-list > div').filter({ has: page.locator('dt', { hasText: /^預計入學$/ }) })).toContainText(chosenText)
  })

  const visit = await findVisit(api, PARENT)
  const detail = await api.get<{ expected_start: string | null }>(`/admin/visit-requests/${visit.id}`)
  expect(detail.expected_start).toBe(chosen)

  await test.step('後台明細看得到', async () => {
    const staff = await openAs(browser, 'super_admin')
    await gotoAdmin(staff.page, `/visit-requests/${visit.id}`, '案件明細')
    const facts = staff.page.locator('.case-facts')
    await expect(facts).toContainText('預計入學')
    await expect(facts).toContainText(chosenText)
    await staff.context.close()
  })

  await test.step('標到場後，招生訪視的入學學期就是家長選的學期', async () => {
    startVisitSlot(visit.id)
    await api.send('POST', `/admin/visit-requests/${visit.id}/complete`)
    const records = await api.get<{ child_name: string; target_school_year: number; target_semester: number }[]>(
      `/admin/admissions/records?campus_key=${SLOTS_CAMPUS}&visit_request_id=${visit.id}&page=1&page_size=5`,
    )
    const [year, semester] = chosen.split('-').map(Number)
    expect(records.map((r) => [r.child_name, r.target_school_year, r.target_semester])).toEqual([[CHILD, year, semester]])
  })
  await Promise.all([parent.context.close(), api.dispose()])
})

for (const { name, device } of [
  { name: '1440', device: { viewport: { width: 1440, height: 900 } } },
  { name: '390', device: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
] as const) {
  test(`${name}px：預約表單的預計入學時間不撐出畫面`, async ({ browser }) => {
    const { context, page } = await openAs(browser, null, { ...device, extraHTTPHeaders: { 'X-Forwarded-For': '198.51.100.62' } })
    await page.goto(`/visit/${SLOTS_CAMPUS}`)
    const start = page.getByRole('group', { name: /預計入學時間/ })
    // 盡快＋四個學期＋還不確定；表單真的渲染、字型載完才量與截圖（不在骨架畫面上量）。
    await expect(start.getByRole('radio')).toHaveCount(6)
    await expect(page.getByLabel('孩子出生年月日')).toBeVisible()
    await page.evaluate(() => document.fonts.ready)
    await expectNoHorizontalOverflow(page)
    mkdirSync(SHOTS, { recursive: true })
    await start.scrollIntoViewIfNeeded()
    await expectNoHorizontalOverflow(page)
    await page.screenshot({ path: path.join(SHOTS, `visit-expected-start-${name}.png`) })
    await context.close()
  })
}
