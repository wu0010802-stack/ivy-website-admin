import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { expect, request, test } from '@playwright/test'
import { currentTerm } from '../../admin/src/admissions/academic'
import { adminApi, findVisit, taipeiDate, type SlotOut } from './api'
import { startVisitSlot } from './db'
import { expectNoHorizontalOverflow, gotoAdmin, openAs } from './pages'
import { ROOT, SLOTS_CAMPUS, WEB_ORIGIN } from './stack-env'

// 預約明細當家庭頁（docs/specs/2026-10-05-visit-family-page-design.md 10.1）：家長預約 → 場次時間過了、
// 標記已到場（API 準備）→ 預約明細是家庭版面「已訪視」→ 記錄聯絡 → 移到已預繳 → 招生看板卡片在「已預繳」→
// 點卡片回到同一筆預約明細、返回鍵寫「招生入學」→ 手動新增的訪視點卡片仍開歷程抽屜。
// 「時間已過」用 psql 把本測試自己的場次移到昨天（db.ts）。

const API = '/api/website/v1'
const PARENT = '家庭頁流程家長'
const CHILD = '家庭頁寶貝'
const MANUAL_CHILD = '家庭頁手動寶貝'
const PHONE = '0912000791'
const SHOTS = path.join(ROOT, 'output/playwright')
const TERM = currentTerm(taipeiDate(0))

test('家庭版面：已到場 → 記錄聯絡 → 移到已預繳 → 看板點卡片回到同一頁 → 手動訪視開抽屜', async ({ browser }) => {
  test.setTimeout(150_000)
  mkdirSync(SHOTS, { recursive: true })
  const api = await adminApi('super_admin')
  const slot = await api.send<SlotOut>('POST', `/admin/slots?campus_key=${SLOTS_CAMPUS}`, {
    slot_date: taipeiDate(16), start_time: '15:00:00', end_time: '16:00:00', capacity: 1,
  })

  // 公開預約每來源每校每小時 5 筆：用文件保留網段 IP 取得獨立額度（同 admissions-flow／follow-up）。
  const parent = await request.newContext({ baseURL: WEB_ORIGIN, extraHTTPHeaders: { 'X-Forwarded-For': '198.51.100.19' } })
  const config = await (await parent.get(`${API}/public/booking-config/${SLOTS_CAMPUS}`)).json()
  const created = await parent.post(`${API}/public/visit-requests`, {
    headers: { 'Idempotency-Key': `e2e-family-page-${PHONE}` },
    data: {
      campus_key: SLOTS_CAMPUS, parent_name: PARENT, phone: PHONE, child_name: CHILD, child_birthdate: '2022-05-01',
      config_version: config.version, slot_id: slot.id, email: `e2e-family-page-${PHONE}@example.com`,
    },
  })
  expect([200, 201], await created.text()).toContain(created.status())
  await parent.dispose()
  const booked = await findVisit(api, PARENT)
  startVisitSlot(booked.id)
  await api.send('POST', `/admin/visit-requests/${booked.id}/complete`)

  const staff = await openAs(browser, 'campus_admin')
  const { page } = staff

  await test.step('預約明細是家庭版面：頁首「已訪視」、招生資料、處理區有記錄聯絡', async () => {
    await gotoAdmin(page, `/visit-requests/${booked.id}`, '案件明細')
    await expect(page.locator('.detail__status')).toContainText('已訪視')
    await expect(page.locator('.family-data')).toContainText(CHILD)
    await expect(page.getByRole('button', { name: '記錄聯絡' })).toBeVisible()
    await expect(page.getByText('參觀後追蹤')).toHaveCount(0)
  })

  await test.step('記錄聯絡：聯絡到了、寫內容、不用再追 → 列在聯絡紀錄「參觀後」', async () => {
    await page.getByRole('button', { name: '記錄聯絡' }).click()
    const dialog = page.getByRole('dialog', { name: '記錄聯絡' })
    await expect(dialog).toBeVisible()
    await dialog.getByText('聯絡到了', { exact: true }).click()
    await dialog.getByLabel('聯絡內容').fill('家長下週帶預繳過來')
    await dialog.getByText('不用再追', { exact: true }).click()
    await dialog.getByRole('button', { name: '記下來' }).click()
    await expect(dialog).toBeHidden()
    const item = page.locator('.family-notes__item', { hasText: '家長下週帶預繳過來' })
    await expect(item).toContainText('參觀後')
    await expect(item).toContainText('聯絡到了')
  })

  await test.step('移到… 已預繳（確認框「已訪視 → 已預繳」）', async () => {
    await page.locator('.family-actions__move').click()
    await page.getByRole('menuitem', { name: '已預繳', exact: true }).click()
    await confirmMove()
    await expect(page.locator('.detail__status')).toContainText('已預繳')
    await expect(page.locator('.timeline__item').first()).toContainText('加上預繳')
  })

  await test.step('畫面驗收截圖（1440）', async () => {
    await page.screenshot({ path: path.join(SHOTS, 'visit-family-page-1440.png'), fullPage: true })
  })

  await test.step('招生看板：卡片在「已預繳」，點卡片回到同一筆預約明細，返回寫「招生入學」', async () => {
    await gotoAdmin(page, `/admissions?campus=${SLOTS_CAMPUS}&tab=funnel&sy=${TERM.schoolYear}`, '招生入學')
    const card = page.locator('.funnel__column[data-stage="deposited"] .funnel-card', { hasText: CHILD })
    await expect(card).toBeVisible()
    await card.locator('button.funnel-card__open').click()
    await expect(page).toHaveURL(new RegExp(`/admin/visit-requests/${booked.id}`))
    await expect(page.locator('.detail__back')).toHaveText('招生入學')
    await page.locator('.detail__back').click()
    await expect(page).toHaveURL(/\/admin\/admissions(\?|$)/)
    await expect(page.locator('.funnel__column[data-stage="deposited"] .funnel-card', { hasText: CHILD })).toBeVisible()
  })

  await test.step('手動新增的訪視：點卡片照舊開歷程抽屜', async () => {
    await api.send('POST', `/admin/admissions/records?campus_key=${SLOTS_CAMPUS}`, {
      visit_date: taipeiDate(0), child_name: MANUAL_CHILD, birthday: '2022-05-01',
      target_school_year: TERM.schoolYear, target_semester: TERM.semester,
    })
    await page.reload()
    const manual = page.locator('.funnel-card', { hasText: MANUAL_CHILD })
    await manual.locator('button.funnel-card__open').click()
    await expect(page.getByRole('dialog', { name: '參觀→入學 歷程' })).toBeVisible()
    await expect(page).toHaveURL(/\/admin\/admissions/)
  })

  await staff.context.close()

  await test.step('手機 390：家庭版面不橫向溢出，處理區在聯絡紀錄前面', async () => {
    const mobile = await openAs(browser, 'campus_admin', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
    await gotoAdmin(mobile.page, `/visit-requests/${booked.id}`, '案件明細')
    await expect(mobile.page.locator('.family-actions')).toBeVisible()
    await expectNoHorizontalOverflow(mobile.page)
    const actionsTop = await mobile.page.locator('.family-actions').evaluate((el) => el.getBoundingClientRect().top)
    const notesTop = await mobile.page.locator('.family-notes').evaluate((el) => el.getBoundingClientRect().top)
    expect(actionsTop).toBeLessThan(notesTop)
    await mobile.page.screenshot({ path: path.join(SHOTS, 'visit-family-page-390.png'), fullPage: true })
    await mobile.context.close()
  })

  await api.dispose()

  /** 換階段的確認框（TransitionDialog，不是 ElMessageBox）：照 admissions-flow 的 moveCard 用標題與動作鍵。 */
  async function confirmMove() {
    const dialog = page.getByRole('dialog', { name: '已訪視 → 已預繳' })
    await expect(dialog).toContainText(CHILD)
    await dialog.getByRole('button', { name: '移到已預繳', exact: true }).click()
    await expect(dialog).toBeHidden()
  }
})
