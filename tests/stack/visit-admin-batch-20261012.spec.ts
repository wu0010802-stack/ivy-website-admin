import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { expect, request, test } from '@playwright/test'
import { adminApi, findVisit, taipeiDate, type AdminApi, type SlotOut } from './api'
import { startVisitSlot } from './db'
import { answerMessageBox, expectNoHorizontalOverflow, gotoAdmin, openAs } from './pages'
import { ROOT, SLOTS_CAMPUS, WEB_ORIGIN } from './stack-env'

// 後台一批補強（docs/specs/2026-10-12-admin-batch-design.md）。檔名以 visit- 開頭：要排在 admissions-flow 之後
// （它斷言義華的招生看板在它之前是空的；本檔第一條會建義華的招生訪視）。
//
// ① 預約明細改家長手機 → 招生訪視那欄還是當初帶過去的值，一起改（§3）；
// ② 「時間已過、還沒標記」勾兩筆一次標記沒來（§4.1）；
// ③ 總管理者改聯絡片語 → 案件明細輸入框上方的片語點一下帶入（§4.2）。

const API = '/api/website/v1'
const SHOTS = path.join(ROOT, 'output/playwright')

/** 以家長身分從公開 API 預約一個只給這筆用的場次，回傳案件 id。 */
async function book(api: AdminApi, parent: string, child: string, phone: string, day: number): Promise<string> {
  const slot = await api.send<SlotOut>('POST', `/admin/slots?campus_key=${SLOTS_CAMPUS}`, {
    slot_date: taipeiDate(day), start_time: '09:00:00', end_time: '10:00:00', capacity: 1,
  })
  // 公開預約每來源每校每小時 5 筆：用文件保留網段 IP 取得獨立額度（同 visit-family-page）。
  const context = await request.newContext({ baseURL: WEB_ORIGIN, extraHTTPHeaders: { 'X-Forwarded-For': '198.51.100.31' } })
  const config = await (await context.get(`${API}/public/booking-config/${SLOTS_CAMPUS}`)).json()
  const created = await context.post(`${API}/public/visit-requests`, {
    headers: { 'Idempotency-Key': `e2e-admin-batch-${phone}` },
    data: {
      campus_key: SLOTS_CAMPUS, parent_name: parent, phone, child_name: child, child_birthdate: '2022-05-01',
      config_version: config.version, slot_id: slot.id, email: `e2e-admin-batch-${phone}@example.com`,
    },
  })
  expect([200, 201], await created.text()).toContain(created.status())
  await context.dispose()
  return (await findVisit(api, parent)).id
}

async function admissionsPhone(api: AdminApi, child: string): Promise<string | null> {
  const rows = await api.get<{ child_name: string; phone: string | null }[]>(
    `/admin/admissions/records?campus_key=${SLOTS_CAMPUS}&q=${encodeURIComponent(child)}&page=1&page_size=5`,
  )
  return rows.find((row) => row.child_name === child)?.phone ?? null
}

test('預約明細改家長手機，招生訪視一起改；歷程寫誰改的', async ({ browser }) => {
  test.setTimeout(120_000)
  mkdirSync(SHOTS, { recursive: true })
  const api = await adminApi('super_admin')
  const id = await book(api, '改資料測試家長', '改資料寶', '0912000951', 21)
  startVisitSlot(id)
  await api.send('POST', `/admin/visit-requests/${id}/complete`)
  expect(await admissionsPhone(api, '改資料寶')).toBe('0912000951')

  const { context, page } = await openAs(browser, 'campus_admin')
  await gotoAdmin(page, `/visit-requests/${id}`, '案件明細')
  await page.getByRole('button', { name: '修改', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '修改家長資料' })
  await expect(dialog).toBeVisible()
  const phone = dialog.getByLabel('手機')
  await phone.fill('0912')
  await expect(dialog).toContainText('手機號碼要是 09 開頭的 10 碼')
  await phone.fill('0987-654-321')
  await page.screenshot({ path: path.join(SHOTS, 'admin-batch-details-dialog-1440.png') })
  await dialog.getByRole('button', { name: '儲存' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.locator('.el-message').filter({ hasText: '招生資料已一起更新：電話' })).toBeVisible()
  await expect(page.locator('.timeline__item', { hasText: '改了 手機' })).toBeVisible()
  expect(await admissionsPhone(api, '改資料寶')).toBe('0987654321')
  await context.close()
  await api.dispose()
})

test('時間已過、還沒標記：勾兩筆一次標記沒來', async ({ browser }) => {
  test.setTimeout(120_000)
  const api = await adminApi('super_admin')
  const families = [
    { parent: '批次沒來甲家長', child: '沒來甲寶', phone: '0912000961', day: 22 },
    { parent: '批次沒來乙家長', child: '沒來乙寶', phone: '0912000962', day: 23 },
  ]
  for (const family of families) startVisitSlot(await book(api, family.parent, family.child, family.phone, family.day))

  const { context, page } = await openAs(browser, 'campus_admin')
  await gotoAdmin(page, `/visit-requests?campus=${SLOTS_CAMPUS}&group=past&status=confirmed`, '參觀案件')
  for (const family of families) {
    await page.locator('.visit-row', { hasText: family.parent }).locator('.visit-row__check .el-checkbox').click()
  }
  await page.getByRole('button', { name: '標記沒來' }).click()
  const confirm = page.getByRole('dialog', { name: '批次標記沒來' })
  await expect(confirm).toContainText('把 2 筆標成沒來？會結案、停用家長的修改連結，名額不會釋出。')
  await page.screenshot({ path: path.join(SHOTS, 'admin-batch-no-show-confirm-1440.png') })
  await answerMessageBox(page, '批次標記沒來', '標記沒來')
  for (const family of families) await expect(page.locator('.visit-row', { hasText: family.parent })).toHaveCount(0)
  for (const family of families) expect((await findVisit(api, family.parent)).status).toBe('no_show')
  await context.close()
  await api.dispose()
})

test('總管理者改聯絡片語，案件明細點片語帶入輸入框（桌機與手機）', async ({ browser }) => {
  test.setTimeout(120_000)
  const api = await adminApi('super_admin')
  const id = await book(api, '片語測試家長', '片語寶', '0912000971', 24)

  const admin = await openAs(browser, 'super_admin')
  await gotoAdmin(admin.page, '/contact-phrases', '聯絡片語')
  await expect(admin.page.getByRole('textbox', { name: '第 1 句' })).toHaveValue('已致電，家長沒接')
  await admin.page.getByRole('button', { name: '新增一句' }).click()
  await admin.page.getByRole('textbox', { name: '第 7 句' }).fill('已傳簡訊提醒')
  await admin.page.screenshot({ path: path.join(SHOTS, 'admin-batch-phrases-1440.png'), fullPage: true })
  await admin.page.getByRole('button', { name: '儲存' }).click()
  await expect.poll(async () => (await api.get<{ phrases: string[] }>('/admin/contact-phrases')).phrases).toContain('已傳簡訊提醒')
  await admin.context.close()

  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    const mobile = viewport.width < 600
    const { context, page } = await openAs(browser, 'campus_admin', mobile ? { viewport, isMobile: true, hasTouch: true } : { viewport })
    await gotoAdmin(page, `/visit-requests/${id}`, '案件明細')
    const chips = page.getByRole('group', { name: '常用片語' }).first()
    await expect(chips.getByRole('button', { name: '已傳簡訊提醒' })).toBeVisible()
    const note = page.getByLabel('新增聯絡紀錄')
    await chips.getByRole('button', { name: '已致電，家長沒接' }).click()
    await chips.getByRole('button', { name: '已傳簡訊提醒' }).click()
    await expect(note).toHaveValue('已致電，家長沒接，已傳簡訊提醒')
    if (mobile) {
      // 手機一列橫向捲動：片語再多也不把輸入框推下去。
      expect((await chips.boundingBox())!.height).toBeLessThan(60)
      await expectNoHorizontalOverflow(page)
    }
    await page.screenshot({ path: path.join(SHOTS, `admin-batch-phrase-chips-${viewport.width}.png`) })
    await context.close()
  }

  // 還原成預設，不影響其他測試的片語斷言。
  const current = await api.get<{ phrases: string[]; version: number }>('/admin/contact-phrases')
  await api.send('PUT', '/admin/contact-phrases', { phrases: current.phrases.filter((p) => p !== '已傳簡訊提醒'), expected_version: current.version })
  await api.dispose()
})

const FRAME = 'iframe[title="官網預覽"]'

test('各頁搜尋與分享：改關於頁的搜尋標題並發布，官網 /about 的 <title> 跟著換', async ({ browser }) => {
  test.setTimeout(120_000)
  const { context, page } = await openAs(browser, 'super_admin')
  await gotoAdmin(page, '/content/site-meta', '網站標題與電話')
  await page.getByRole('tab', { name: /關於常春藤/ }).click()
  const title = `關於常春藤 e2e 搜尋標題 ${Date.now() % 100000}`
  await page.getByRole('textbox', { name: '搜尋標題' }).fill(title)
  await page.screenshot({ path: path.join(SHOTS, 'admin-batch-page-seo-1440.png') })
  await page.getByRole('button', { name: '儲存並發布到官網' }).click()
  const confirm = page.getByRole('dialog', { name: /到官網？/ })
  await confirm.getByRole('button', { name: '儲存並發布' }).click()
  await expect(confirm).toBeHidden()
  await expect.poll(async () => {
    const visitor = await browser.newPage()
    await visitor.goto('/about')
    const value = await visitor.title()
    await visitor.close()
    return value
  }, { timeout: 30_000 }).toBe(title)
  await context.close()
})

test('常春藤環境頁編輯器：改首屏大標，預覽即時換字（桌機）', async ({ browser }) => {
  test.setTimeout(120_000)
  const { context, page } = await openAs(browser, 'super_admin')
  await gotoAdmin(page, '/content/environment-page', '常春藤環境頁')
  const frame = page.frameLocator(FRAME)
  await expect(frame.locator('#environment-title')).toBeVisible({ timeout: 15_000 })
  const marker = `大標測試${Date.now() % 1000}`
  await page.getByRole('textbox', { name: '首屏大標' }).fill(marker)
  await expect(frame.locator('#environment-title')).toContainText(marker, { timeout: 5_000 })
  await page.screenshot({ path: path.join(SHOTS, 'admin-batch-environment-editor-1440.png') })
  await page.getByRole('button', { name: '放棄修改' }).click()
  await answerMessageBox(page, '放棄 1 個欄位的修改？', '放棄修改')
  await expect(frame.locator('#environment-title')).not.toContainText(marker)
  await context.close()
})
