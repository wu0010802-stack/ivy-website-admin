import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { expect, request, test, type Page } from '@playwright/test'
import { adminApi, findVisit, taipeiDate, type AdminApi, type SlotOut } from './api'
import { makeFollowUpDue, startVisitSlot } from './db'
import { answerMessageBox, expectNoHorizontalOverflow, gotoAdmin, openAs } from './pages'
import { ROOT, SLOTS_CAMPUS, WEB_ORIGIN } from './stack-env'

// 參觀後追蹤（docs/specs/2026-10-04-admissions-follow-up-design.md F19）：兩位家長預約 →
// 場次時間過了 → 案件列表「只看尚未確認到場」勾兩筆一次標記已到場 → 兩筆都「未排定」→
// 甲在預約明細排明天 → 「7 天內」→ 把它改成已到期 → 訪視明細「追蹤：已到期」看得到 →
// 預約明細記錄聯絡（沒聯絡到、明天）→ 離開已到期 → 預繳後仍在追 → 註冊後下次聯絡被清掉。
// 招生入學的「待追蹤」分頁 2026-10-06 拿掉：排程與記錄聯絡走預約明細，清單走訪視明細的「追蹤」篩選。
// 「時間已過」「已到期」都用 psql 改本測試自己的資料（db.ts），不改系統時間。
// 招生訪視的絕對數字只在 admissions-flow.spec（檔名排在前面、先跑）斷言；本檔只比對自己的孩子。

const API = '/api/website/v1'
const SHOTS = path.join(ROOT, 'output/playwright')
const FAMILIES = [
  { parent: '追蹤流程甲家長', child: '追蹤甲寶', phone: '0912000781', day: 14 },
  { parent: '追蹤流程乙家長', child: '追蹤乙寶', phone: '0912000782', day: 15 },
] as const
const [A, B] = FAMILIES

/** 訪視明細「追蹤」篩選的同一個查詢（records?follow_up=）。 */
async function followUps(api: AdminApi, scope: 'due' | 'upcoming' | 'unscheduled'): Promise<string[]> {
  const rows = await api.get<{ child_name: string }[]>(`/admin/admissions/records?campus_key=${SLOTS_CAMPUS}&follow_up=${scope}&page_size=100`)
  return rows.map((row) => row.child_name)
}

/** 以家長身分從公開 API 預約指定場次（送單畫面由 admissions-flow／booking-flow 驗證）。 */
async function bookSlot(slotId: string, family: (typeof FAMILIES)[number]): Promise<void> {
  // 公開預約每來源每校每小時 5 筆：用另一個文件保留網段 IP 取得獨立額度（同 admissions-flow）。
  const context = await request.newContext({ baseURL: WEB_ORIGIN, extraHTTPHeaders: { 'X-Forwarded-For': '198.51.100.18' } })
  const config = await (await context.get(`${API}/public/booking-config/${SLOTS_CAMPUS}`)).json()
  const response = await context.post(`${API}/public/visit-requests`, {
    headers: { 'Idempotency-Key': `e2e-follow-up-${family.phone}` },
    data: {
      campus_key: SLOTS_CAMPUS,
      parent_name: family.parent,
      phone: family.phone,
      child_name: family.child,
      child_birthdate: '2022-05-01',
      config_version: config.version,
      slot_id: slotId,
      email: `e2e-follow-up-${family.phone}@example.com`,
    },
  })
  expect([200, 201], await response.text()).toContain(response.status())
  await context.dispose()
}

async function openFamily(page: Page, api: AdminApi, family: (typeof FAMILIES)[number]) {
  await gotoAdmin(page, `/visit-requests/${(await findVisit(api, family.parent)).id}`, '案件明細')
  await expect(page.locator('.family-actions')).toBeVisible()
}

test('批次標記到場 → 排下次聯絡 → 到期 → 記錄聯絡 → 預繳仍追 → 註冊後結束', async ({ browser }) => {
  test.setTimeout(150_000)
  mkdirSync(SHOTS, { recursive: true })
  const api = await adminApi('super_admin')

  for (const family of FAMILIES) {
    const slot = await api.send<SlotOut>('POST', `/admin/slots?campus_key=${SLOTS_CAMPUS}`, {
      slot_date: taipeiDate(family.day), start_time: '16:00:00', end_time: '17:00:00', capacity: 1,
    })
    await bookSlot(slot.id, family)
    startVisitSlot((await findVisit(api, family.parent)).id)
  }

  const staff = await openAs(browser, 'campus_admin')
  const { page } = staff

  await test.step('案件列表「只看尚未確認到場」勾兩筆，一次標記已到場', async () => {
    await gotoAdmin(page, `/visit-requests?campus=${SLOTS_CAMPUS}&group=past&status=confirmed`, '參觀案件')
    for (const family of FAMILIES) {
      await page.locator('.visit-row', { hasText: family.parent }).locator('.visit-row__check .el-checkbox').click()
    }
    await page.getByRole('button', { name: '2 位標記已到場' }).click()
    await answerMessageBox(page, '2 位標記已到場？', '標記已到場')
    for (const family of FAMILIES) await expect(page.locator('.visit-row', { hasText: family.parent })).toHaveCount(0)
    await expect(page).toHaveURL(/\/visit-requests\?/)
  })
  for (const family of FAMILIES) expect((await findVisit(api, family.parent)).status).toBe('completed')

  await test.step('兩筆都「未排定」（不自動排聯絡），「已到期」沒有', async () => {
    const unscheduled = await followUps(api, 'unscheduled')
    for (const family of FAMILIES) expect(unscheduled).toContain(family.child)
    expect(await followUps(api, 'due')).not.toContain(A.child)
  })

  await test.step('甲在預約明細排明天 10:00 → 移到「7 天內」', async () => {
    await openFamily(page, api, A)
    await page.locator('.family-actions').getByRole('button', { name: '排下次聯絡' }).click()
    const dialog = page.getByRole('dialog', { name: '排下次聯絡' })
    await dialog.locator('.el-radio-button', { hasText: '明天 10:00' }).click()
    await dialog.getByRole('button', { name: '儲存' }).click()
    await expect(dialog).toBeHidden()
    await expect.poll(() => followUps(api, 'upcoming')).toContain(A.child)
    expect(await followUps(api, 'unscheduled')).toContain(B.child)
  })

  makeFollowUpDue(A.child)

  await test.step('甲到期：訪視明細「追蹤：已到期」看得到，招生入學沒有待追蹤分頁', async () => {
    await gotoAdmin(page, `/admissions?campus=${SLOTS_CAMPUS}&tab=records&sy=all`, '招生入學')
    await expect(page.locator('.admissions__tabs .el-tabs__item')).toHaveText(['漏斗看板', '訪視明細', '統計分析'])
    // 點下拉外框：輸入框上疊著佔位文字，直接點 input 會被它擋住。
    await page.locator('.records-filters .el-select', { has: page.getByLabel('追蹤狀態') }).click()
    await page.locator('.el-select-dropdown__item:visible', { hasText: '已到期' }).click()
    const row = page.locator('.records-table .el-table__body tr', { hasText: A.child })
    await expect(row).toContainText('今天')
    await expect(page.locator('.records-table .el-table__body tr', { hasText: B.child })).toHaveCount(0)
    await page.screenshot({ path: path.join(SHOTS, 'admissions-records-follow-up-due-1440.png'), fullPage: true })
    await expectNoHorizontalOverflow(page)
  })

  await test.step('預約明細記錄聯絡：沒聯絡到 → 預設明天 → 離開已到期；聯絡在聯絡紀錄、建立訪視在歷程', async () => {
    await openFamily(page, api, A)
    await page.locator('.family-actions').getByRole('button', { name: '記錄聯絡' }).click()
    const dialog = page.getByRole('dialog', { name: '記錄聯絡' })
    await dialog.locator('.el-radio-button', { hasText: '沒聯絡到' }).click()
    await expect(dialog.locator('.el-radio-button.is-active', { hasText: '明天 10:00' })).toBeVisible()
    await dialog.getByLabel('聯絡內容').fill('沒接，轉語音信箱')
    await page.screenshot({ path: path.join(SHOTS, 'admissions-contact-dialog-1440.png') })
    await dialog.getByRole('button', { name: '記下來' }).click()
    await expect(dialog).toBeHidden()
    await expect.poll(() => followUps(api, 'due')).not.toContain(A.child)
    expect(await followUps(api, 'upcoming')).toContain(A.child)
    await expect(page.locator('.timeline__item[data-kind="note"]', { hasText: '電話・沒聯絡到' })).toHaveCount(1)
    await expect(page.locator('.timeline__item', { hasText: '建立訪視' })).toHaveCount(1)
  })

  await test.step('預繳後仍在追；註冊後下次聯絡被清掉', async () => {
    const record = (await api.get<{ id: string; version: number }[]>(
      `/admin/admissions/records?campus_key=${SLOTS_CAMPUS}&q=${encodeURIComponent(A.child)}&page=1&page_size=5`,
    ))[0]!
    const deposited = await api.send<{ version: number; follow_up_at: string | null }>(
      'POST', `/admin/admissions/records/${record.id}/transition`,
      { to_stage: 'deposited', expected_version: record.version, reason: null, deposit_collector: null, enrolled_on: null, grade: null, target_school_year: null, target_semester: null },
    )
    expect(deposited.follow_up_at).not.toBeNull()
    expect(await followUps(api, 'upcoming')).toContain(A.child)
    const enrolled = await api.send<{ follow_up_at: string | null }>(
      'POST', `/admin/admissions/records/${record.id}/transition`,
      { to_stage: 'enrolled', expected_version: deposited.version, reason: null, deposit_collector: null, enrolled_on: null, grade: '小班', target_school_year: null, target_semester: null },
    )
    expect(enrolled.follow_up_at).toBeNull()
    expect(await followUps(api, 'upcoming')).not.toContain(A.child)
  })

  await Promise.all([staff.context.close(), api.dispose()])
})
