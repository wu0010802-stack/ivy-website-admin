import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { currentTerm, gradeForBirthday } from '../../admin/src/admissions/academic'
import { adminApi, findVisit, taipeiDate, type AdminApi, type SlotOut } from './api'
import { startVisitSlot } from './db'
import { answerMessageBox, expectNoHorizontalOverflow, gotoAdmin, openAs, pickVisitDay } from './pages'
import { ROOT, SLOTS_CAMPUS } from './stack-env'

// 招生入學（規格 R17）：家長在官網自選場次預約成功 → 場次時間過了，漏斗看板全空時提示去標記到場 →
// 案件列表「只看尚未確認到場」按已到場、接著在招生資料表單補兩位帶參觀老師 → 漏斗看板「已訪視」→ 預繳 →
// 註冊 → 統計看得到。
// 2026-10-05 拿掉招生入學的「官網預約」分頁，確認到場改在案件列表。
// 「時間已過」用 psql 把本測試自己建的場次移到昨天（db.ts），不改系統時間、不動其他測試的場次。
// 每一步都在畫面上操作；API 只用來建場次與核對結果。後兩項是 R16：四個分頁在 1440／390 的
// 截圖（output/playwright/，給人看，不比對像素）與「頁面不橫向溢出」。

const PARENT = '招生流程家長'
const CHILD = '招生流程寶貝'
const PHONE = '0912000771'
const EMAIL = 'admissions-flow@example.com'
const GUIDE = '招生流程老師'
const GUIDE_2 = '招生流程助教'
const SHOTS = path.join(ROOT, 'output/playwright')
const TABS = ['funnel', 'records', 'stats'] as const

// B 階段畫面的文案（Step 1 核對過）。B 改文案時只改這裡。
const UI = {
  moveMenu: /移到/,
}

// 入學學期＝確認到場當天的台北學期（規格 6.1）；生日挑在該學年剛好滿 3 歲 → 小班（規格 6.4）。
const TERM = currentTerm(taipeiDate(0))
const BIRTHDAY = `${TERM.schoolYear + 1911 - 3}-03-15`
const GRADE = '小班'

/** 這個孩子的卡片在看板的哪一欄（核對用）。 */
async function boardStage(api: AdminApi): Promise<string | undefined> {
  const board = await api.get<{ columns: Record<string, { child_name: string }[]> }>(
    `/admin/admissions/board?campus_key=${SLOTS_CAMPUS}&school_year=${TERM.schoolYear}`,
  )
  return Object.entries(board.columns).find(([, cards]) => cards.some((card) => card.child_name === CHILD))?.[0]
}

const card = (page: Page) => page.locator('[draggable="true"]', { hasText: CHILD })

/** 卡片選單「移到…」→ 選目的欄 → 確認框（標題「起 → 迄」）按寫出動作的確認鍵。鍵盤可完成的那條路（R15）。
 *  滑鼠裝置的「移到…」平常收起，指到卡片才出現（FunnelCard.vue）。 */
async function moveCard(page: Page, to: string, title: string, confirm: string): Promise<void> {
  await card(page).hover()
  await card(page).getByRole('button', { name: UI.moveMenu }).click()
  await page.getByRole('menuitem', { name: to, exact: true }).click()
  const dialog = page.getByRole('dialog', { name: title })
  await expect(dialog).toContainText(CHILD)
  await dialog.getByRole('button', { name: confirm, exact: true }).click()
  await expect(dialog).toBeHidden()
}

test('家長自選場次 → 時間過了看板提示去標記到場 → 案件列表已到場 → 看板 → 預繳 → 註冊 → 統計', async ({ browser }) => {
  test.setTimeout(120_000)
  expect(gradeForBirthday(BIRTHDAY, TERM.schoolYear)).toBe(GRADE)
  const api = await adminApi('super_admin')
  const slotDate = taipeiDate(12)
  await api.send<SlotOut>('POST', `/admin/slots?campus_key=${SLOTS_CAMPUS}`, {
    slot_date: slotDate, start_time: '15:00:00', end_time: '16:00:00', capacity: 1,
  })

  await test.step('家長在官網選第 12 天下午的場次，送出即預約成功', async () => {
    // 公開預約每來源每校每小時 5 筆（booking/routes.py SUBMIT_LIMIT_BY_SOURCE_CAMPUS），stack 全從
    // 127.0.0.1 送，多這一筆會讓排在後面的 roles.spec 撞 429；用文件保留網段 IP 取得獨立額度。
    const parent = await openAs(browser, null, { extraHTTPHeaders: { 'X-Forwarded-For': '198.51.100.17' } })
    const { page } = parent
    await page.goto(`/visit/${SLOTS_CAMPUS}`)
    await expect(page.getByRole('heading', { name: '填寫參觀資料' })).toBeVisible()
    await pickVisitDay(page, slotDate)
    await expect(page.locator('.visit-slot-options input[type="radio"]')).toHaveCount(1)
    await page.locator('.visit-slot-options input[type="radio"]').first().check()
    await page.getByLabel('孩子姓名').fill(CHILD)
    await page.getByLabel('孩子出生年月日').fill(BIRTHDAY)
    await page.getByLabel('家長稱呼').fill(PARENT)
    await page.getByLabel('聯絡電話').fill(PHONE)
    await page.getByLabel('聯絡 Email').fill(EMAIL)
    await page.getByRole('button', { name: '確認預約' }).click()
    await expect(page.locator('#booking-result')).toContainText('預約成功')
    await parent.context.close()
  })
  const booked = await findVisit(api, PARENT)
  expect(booked.status).toBe('confirmed')
  expect(booked.slot?.slot_date).toBe(slotDate)

  startVisitSlot(booked.id)

  const staff = await openAs(browser, 'campus_admin')
  const { page } = staff

  await test.step('漏斗看板全空時提示還有沒標記到場的預約，點了到案件列表的「只看尚未確認到場」', async () => {
    // 本 spec 是第一個建招生訪視的（見下方統計的說明），這時看板四欄全空。
    await gotoAdmin(page, `/admissions?campus=${SLOTS_CAMPUS}&tab=funnel`, '招生入學')
    await page.getByRole('link', { name: '去標記到場' }).click()
    await expect(page.getByRole('heading', { level: 1, name: '參觀案件' })).toBeVisible()
    await expect(page).toHaveURL(/group=past/)
    await expect(page).toHaveURL(/status=confirmed/)
  })

  await test.step('案件列表列出時間已過、還沒確認到場的預約；按到了，接著在招生資料表單補兩位帶參觀老師', async () => {
    const row = page.locator('.visit-row', { hasText: PARENT })
    await expect(row).toContainText(CHILD)
    // 按鈕文字是「到了」，無障礙名稱帶家長（「標記 X 已到場」）。
    await row.getByRole('button', { name: `標記 ${PARENT} 已到場` }).click()
    // 已到場有確認框（composables/visitAttendance.ts：標題「標記已到場？」、按鈕「標記已到場」）。
    await answerMessageBox(page, '標記已到場？', '標記已到場')
    // 標記後接著打開招生資料表單（2026-10-06，composables/useArrivalAdmissionsForm.ts），預約資料已帶入。
    const form = page.getByRole('dialog', { name: '編輯訪視紀錄' })
    await expect(form).toContainText(`已標記 ${PARENT} 已到場`)
    await expect(form.getByRole('textbox', { name: '幼生姓名' })).toHaveValue(CHILD)
    // 帶參觀老師是標籤式多選（2026-10-06）：打名字按 Enter 加一位，可以加好幾位。要逐字打：
    // fill() 只寫入值、不會打開選單，第一次 Enter 只會把選單打開（真人打字不會這樣）。
    const guides = form.getByRole('combobox', { name: '帶參觀老師' })
    for (const name of [GUIDE, GUIDE_2]) {
      await guides.pressSequentially(name)
      await expect(page.getByRole('listbox', { name: '帶參觀老師' }).getByRole('option', { name, exact: true })).toBeVisible()
      await guides.press('Enter')
    }
    await expect(form.locator('.el-select__tags-text')).toHaveText([GUIDE, GUIDE_2])
    await form.getByRole('button', { name: '儲存', exact: true }).click()
    await expect(form).toBeHidden()
    await expect(page.locator('.visit-row', { hasText: PARENT })).toHaveCount(0)
  })
  const arrived = await findVisit(api, PARENT)
  expect(arrived.status).toBe('completed')
  const [record] = await api.get<{ tour_guide_name: string | null }[]>(
    `/admin/admissions/records?campus_key=${SLOTS_CAMPUS}&visit_request_id=${arrived.id}&page=1&page_size=1`,
  )
  expect(record?.tour_guide_name).toBe(`${GUIDE}、${GUIDE_2}`)

  await test.step('漏斗看板：卡片在「已訪視」，年級依生日換算成小班', async () => {
    await gotoAdmin(page, `/admissions?campus=${SLOTS_CAMPUS}&tab=funnel`, '招生入學')
    await expect(card(page)).toContainText(GRADE)
    expect(await boardStage(api)).toBe('visited')
  })

  await test.step('「移到…」已預繳（確認框「已訪視 → 已預繳」）', async () => {
    await moveCard(page, '已預繳', '已訪視 → 已預繳', '移到已預繳')
    await expect.poll(() => boardStage(api)).toBe('deposited')
  })

  await test.step('「移到…」已註冊（確認框帶好註冊日期、年級、入學學期，直接確認）', async () => {
    await moveCard(page, '已註冊', '已預繳 → 已註冊', '標記註冊')
    await expect.poll(() => boardStage(api)).toBe('enrolled')
  })

  // 下面統計的絕對值斷言：stack 每次重建資料庫（start-api.sh dropdb／createdb），且只有本 spec
  // 建招生訪視；之後若有別的 spec 建招生訪視，改成比對差值。
  await test.step('統計分析：本月 1 人次、預繳 1・註冊 1', async () => {
    await gotoAdmin(page, `/admissions?campus=${SLOTS_CAMPUS}&tab=stats`, '招生入學')
    await expect(page.locator('.decision__visit').first()).toHaveText('1 人次')
    await expect(page.locator('.decision__foot').first()).toHaveText('預繳 1 · 註冊 1')
  })

  await Promise.all([staff.context.close(), api.dispose()])
})

const VIEWPORTS = [
  { name: '1440', device: { viewport: { width: 1440, height: 900 } } },
  { name: '390', device: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
]

for (const { name, device } of VIEWPORTS) {
  test(`${name}px：招生入學三個分頁與五校比較截圖，頁面不橫向溢出`, async ({ browser }) => {
    mkdirSync(SHOTS, { recursive: true })
    const { context, page } = await openAs(browser, 'super_admin', device)
    for (const tab of TABS) {
      await gotoAdmin(page, `/admissions?campus=${SLOTS_CAMPUS}&tab=${tab}`, '招生入學')
      await page.waitForLoadState('networkidle')
      await expect(page.locator('.el-skeleton')).toHaveCount(0)
      await test.step(tab, () => expectNoHorizontalOverflow(page))
      await page.screenshot({ path: path.join(SHOTS, `admissions-${tab}-${name}.png`), fullPage: true })
    }
    // 目前停在統計分析；總管理者看得到五校比較。
    await page.getByRole('tab', { name: '五校比較' }).click()
    await page.waitForLoadState('networkidle')
    await expect(page.locator('.el-skeleton')).toHaveCount(0)
    await test.step('stats-compare', () => expectNoHorizontalOverflow(page))
    await page.screenshot({ path: path.join(SHOTS, `admissions-stats-compare-${name}.png`), fullPage: true })
    await context.close()
  })
}
