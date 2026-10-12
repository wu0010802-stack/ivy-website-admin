import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { expect, request, test } from '@playwright/test'
import { adminApi, findVisit, taipeiDate, type AdminApi, type SlotOut } from './api'
import { expectNoHorizontalOverflow, gotoAdmin, openAs } from './pages'
import { ROOT, SLOTS_CAMPUS, WEB_ORIGIN } from './stack-env'

// 提早完成參觀（2026-10-12）：家長比預約的場次早來。案件頁首在場次開始前有「家長提早到了」，
// 確認框寫出原本的場次；約之後的日子會釋出那一場的名額，時間線寫「提早標記已到場」「釋出 …」。

const API = '/api/website/v1'
const SHOTS = path.join(ROOT, 'output/playwright')
const DESKTOP_PARENT = '提早到場桌機家長'
const MOBILE_PARENT = '提早到場手機家長'

async function book(api: AdminApi, parentName: string, phone: string, startTime: string): Promise<{ id: string; slot: SlotOut }> {
  const slot = await api.send<SlotOut>('POST', `/admin/slots?campus_key=${SLOTS_CAMPUS}`, {
    slot_date: taipeiDate(19), start_time: startTime, end_time: `${String(Number(startTime.slice(0, 2)) + 1)}:00:00`, capacity: 1,
  })
  // 公開預約每來源每校每小時 5 筆：用文件保留網段 IP 取得獨立額度（同 visit-family-page）。
  const parent = await request.newContext({ baseURL: WEB_ORIGIN, extraHTTPHeaders: { 'X-Forwarded-For': '198.51.100.21' } })
  const config = await (await parent.get(`${API}/public/booking-config/${SLOTS_CAMPUS}`)).json()
  const created = await parent.post(`${API}/public/visit-requests`, {
    headers: { 'Idempotency-Key': `e2e-complete-early-${phone}` },
    data: {
      campus_key: SLOTS_CAMPUS, parent_name: parentName, phone, child_name: '提早寶貝', child_birthdate: '2022-05-01',
      config_version: config.version, slot_id: slot.id, email: `e2e-complete-early-${phone}@example.com`,
    },
  })
  expect([200, 201], await created.text()).toContain(created.status())
  await parent.dispose()
  return { id: (await findVisit(api, parentName)).id, slot }
}

test('家長提早到了：確認框寫出原場次 → 已到場、名額釋出、時間線寫提早', async ({ browser }) => {
  test.setTimeout(120_000)
  mkdirSync(SHOTS, { recursive: true })
  const api = await adminApi('super_admin')
  const booked = await book(api, DESKTOP_PARENT, '0912000901', '16:00:00')

  const { context, page } = await openAs(browser, 'campus_admin')
  await gotoAdmin(page, `/visit-requests/${booked.id}`, '案件明細')
  const actions = page.locator('.case-hero__actions')
  await expect(actions.getByRole('button', { name: '家長提早到了' })).toBeVisible()
  await expect(actions.getByRole('button', { name: '家長到了' })).toHaveCount(0)
  await expect(actions).toContainText('場次開始後才能標記未到場')
  await page.screenshot({ path: path.join(SHOTS, 'visit-complete-early-1440.png') })

  await actions.getByRole('button', { name: '家長提早到了' }).click()
  const dialog = page.getByRole('dialog', { name: '家長提早到了？' })
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('那一場的名額會釋出給其他家長，參觀日期記為今天')
  await expect(dialog).toContainText('會同時建立一筆招生訪視')
  await page.screenshot({ path: path.join(SHOTS, 'visit-complete-early-confirm-1440.png') })
  await dialog.getByRole('button', { name: '標記已到場' }).click()

  // 招生入學開著、校區管理者能改招生資料：接著打開招生資料表單（同「家長到了」）。
  const form = page.getByRole('dialog').filter({ hasText: '已到場' }).last()
  await expect(form).toBeVisible()
  await form.getByRole('button', { name: '之後再填' }).click()
  await expect(form).toBeHidden()

  await expect(page.locator('.detail__status')).toContainText('已訪視')
  const latest = page.locator('.timeline__item', { hasText: '提早標記已到場' })
  await expect(latest).toBeVisible()
  await expect(latest).toContainText('釋出')
  await page.screenshot({ path: path.join(SHOTS, 'visit-complete-early-done-1440.png') })

  const detail = await api.get<{ status: string; slot_id: string | null }>(`/admin/visit-requests/${booked.id}`)
  expect(detail).toMatchObject({ status: 'completed', slot_id: null })
  const day = booked.slot.slot_date
  const slots = await api.get<SlotOut[]>(`/admin/slots?campus_key=${SLOTS_CAMPUS}&date_from=${day}&date_to=${day}`)
  expect(slots.find((s) => s.id === booked.slot.id)?.booked_count).toBe(0)
  await context.close()
  await api.dispose()
})

test('手機：「家長提早到了」整排撐滿、44px、不橫向捲動', async ({ browser }) => {
  const api = await adminApi('super_admin')
  const booked = await book(api, MOBILE_PARENT, '0912000902', '18:00:00')
  const { context, page } = await openAs(browser, 'campus_admin', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  await gotoAdmin(page, `/visit-requests/${booked.id}`, '案件明細')
  const early = page.locator('.case-hero__actions').getByRole('button', { name: '家長提早到了' })
  await expect(early).toBeVisible()
  const box = (await early.boundingBox())!
  expect(box.height).toBeGreaterThanOrEqual(44)
  expect(box.width).toBeGreaterThan(300)
  await expectNoHorizontalOverflow(page)
  await page.screenshot({ path: path.join(SHOTS, 'visit-complete-early-390.png') })
  await context.close()
  await api.dispose()
})
