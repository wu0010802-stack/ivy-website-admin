import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { currentTerm, gradeForBirthday } from '../../admin/src/admissions/academic'
import { adminApi, findVisit, taipeiDate, type AdminApi, type SlotOut } from './api'
import { startVisitSlot } from './db'
import { answerMessageBox, expectNoHorizontalOverflow, gotoAdmin, openAs } from './pages'
import { ROOT, SLOTS_CAMPUS } from './stack-env'

// 招生入學（規格 R17）：家長在官網自選場次預約成功 → 場次時間過了出現在「官網預約」待確認 →
// 園方按已到場 → 漏斗看板「已訪視」→ 預繳 → 註冊 → 名額規劃的「已註冊」→ 統計看得到。
// 「時間已過」用 psql 把本測試自己建的場次移到昨天（db.ts），不改系統時間、不動其他測試的場次。
// 每一步都在畫面上操作；API 只用來建場次與核對結果。後兩項是 R16：五個分頁在 1440／390 的
// 截圖（output/playwright/，給人看，不比對像素）與「頁面不橫向溢出」。

const PARENT = '招生流程家長'
const CHILD = '招生流程寶貝'
const PHONE = '0912000771'
const EMAIL = 'admissions-flow@example.com'
const SHOTS = path.join(ROOT, 'output/playwright')
const TABS = ['funnel', 'records', 'intake', 'arrivals', 'stats'] as const

// B 階段畫面的文案（Step 1 核對過）。B 改文案時只改這裡。
const UI = {
  arrived: '已到場',
  moveMenu: /移到/,
  confirm: '確認',
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

/** 卡片選單「移到…」→ 選目的欄 → 確認框（標題「起 → 迄」）按確認。鍵盤可完成的那條路（R15）。 */
async function moveCard(page: Page, to: string, title: string): Promise<void> {
  await card(page).getByRole('button', { name: UI.moveMenu }).click()
  await page.getByRole('menuitem', { name: to, exact: true }).click()
  const dialog = page.getByRole('dialog', { name: title })
  await expect(dialog).toContainText(CHILD)
  await dialog.getByRole('button', { name: UI.confirm, exact: true }).click()
  await expect(dialog).toBeHidden()
}

test('家長自選場次 → 時間過了出現在官網預約 → 已到場 → 看板 → 預繳 → 註冊 → 名額已註冊 → 統計', async ({ browser }) => {
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
    await page.getByLabel('預約日期').selectOption(slotDate)
    await expect(page.locator('.visit-slot-options input[type="radio"]')).toHaveCount(1)
    await page.locator('.visit-slot-options input[type="radio"]').first().check()
    await page.getByLabel('孩子姓名').fill(CHILD)
    await page.getByLabel('孩子出生年月日').fill(BIRTHDAY)
    await page.getByLabel('家長稱呼').fill(PARENT)
    await page.getByLabel('聯絡電話').fill(PHONE)
    await page.getByLabel('參觀人數').selectOption('2')
    await page.getByLabel('聯絡 Email').fill(EMAIL)
    await page.getByRole('checkbox', { name: /我同意園方使用本次填寫的資料/ }).check()
    await page.getByRole('button', { name: /送出/ }).click()
    await expect(page.locator('#booking-result')).toContainText('預約成功')
    await parent.context.close()
  })
  const booked = await findVisit(api, PARENT)
  expect(booked.status).toBe('confirmed')
  expect(booked.slot?.slot_date).toBe(slotDate)

  startVisitSlot(booked.id)

  const staff = await openAs(browser, 'campus_admin')
  const { page } = staff

  await test.step('官網預約分頁列出時間已過、還沒確認到場的預約；按已到場', async () => {
    await gotoAdmin(page, `/admissions?campus=${SLOTS_CAMPUS}&tab=arrivals`, '招生入學')
    const row = page.locator('tr', { hasText: PARENT })
    await expect(row).toContainText(CHILD)
    await row.getByRole('button', { name: UI.arrived, exact: true }).click()
    // B5 的已到場有確認框（ArrivalsTab.vue：標題「標記已到場？」、按鈕「標記已到場」）。
    await answerMessageBox(page, '標記已到場？', '標記已到場')
    await expect(page.locator('tr', { hasText: PARENT })).toHaveCount(0)
  })
  expect((await findVisit(api, PARENT)).status).toBe('completed')

  await test.step('漏斗看板：卡片在「已訪視」，年級依生日換算成小班', async () => {
    await gotoAdmin(page, `/admissions?campus=${SLOTS_CAMPUS}&tab=funnel`, '招生入學')
    await expect(card(page)).toContainText(GRADE)
    expect(await boardStage(api)).toBe('visited')
  })

  await test.step('「移到…」已預繳（確認框「已訪視 → 已預繳」）', async () => {
    await moveCard(page, '已預繳', '已訪視 → 已預繳')
    await expect.poll(() => boardStage(api)).toBe('deposited')
  })

  await test.step('「移到…」已註冊（確認框帶好註冊日期、年級、入學學期，直接確認）', async () => {
    await moveCard(page, '已註冊', '已預繳 → 已註冊')
    await expect.poll(() => boardStage(api)).toBe('enrolled')
  })

  // 下面名額與統計的絕對值斷言：stack 每次重建資料庫（start-api.sh dropdb／createdb），且只有本 spec
  // 建招生訪視；之後若有別的 spec 建招生訪視，改成比對差值。
  await test.step('名額規劃：小班「已註冊」是 1', async () => {
    await gotoAdmin(page, `/admissions?campus=${SLOTS_CAMPUS}&sy=${TERM.schoolYear}&sem=${TERM.semester}&tab=intake`, '招生入學')
    const plan = page.locator('.el-table').filter({ hasText: '已註冊' }).first()
    const gradeRow = plan.locator('tbody tr').filter({ hasText: GRADE })
    await expect(gradeRow).toBeVisible()
    const headers = (await plan.locator('thead th').allInnerTexts()).map((text) => text.trim())
    const enrolledColumn = headers.indexOf('已註冊')
    expect(enrolledColumn, `名額規劃表頭：${headers.join('、')}`).toBeGreaterThanOrEqual(0)
    await expect(gradeRow.locator('td').nth(enrolledColumn)).toHaveText('1')
  })

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
  test(`${name}px：招生入學五個分頁與五校比較截圖，頁面不橫向溢出`, async ({ browser }) => {
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
