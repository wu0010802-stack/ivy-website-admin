import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test'
import { currentTerm } from '../../admin/src/admissions/academic'
import { adminApi, taipeiDate } from './api'
import { expectNoHorizontalOverflow, gotoAdmin, openAs } from './pages'
import { ROOT } from './stack-env'

// 第 2 波（2026-10-15）：招生歷程兩種事件＋退出原因分類。用沒有其他 spec 動到招生訪視的國際校（計畫裁定 P11；
// booking-modes.spec 也用國際校，但只改預約方式）。訪視、預繳、改電話用 API 做；畫面上看歷程、在歷程抽屜標記退預繳並選原因，
// 再到統計「未預繳與退出原因」看分佈、點「查看明細」帶著篩選回到訪視明細。結束時（含失敗）用 API 刪掉這筆訪視。
// 種子（db.ts 旅程）有一筆沒分類的退出，別的 spec 也可能留下資料：統計一律拿「操作前」的數字比，只斷言本檔多出來的那一筆。
const CAMPUS = 'international'
const CHILD = 'E2E退出寶貝'
const CATEGORY = '費用考量'
const DETAIL = '學費比預期高'
const TERM = currentTerm(taipeiDate(0))
const SHOTS = path.join(ROOT, 'output/playwright')
const STATS_PATH = `/admissions?campus=${CAMPUS}&sy=all&tab=stats&sub=nodeposit`

interface VisitOut { id: string; version: number }
interface WithdrawRow { reason: string; deposited: number; enrolled: number; total: number }
interface StatsOut { withdraw_reasons: WithdrawRow[]; withdraw_total: number }

const WITHDRAW_BLOCK_TITLE = '退出原因分佈'
const withdrawBlock = (page: Page): Locator =>
  page.locator('.stats-block').filter({ has: page.locator('.stats-block__title', { hasText: WITHDRAW_BLOCK_TITLE }) })

test('修改招生資料進歷程 → 退預繳選原因 → 統計分佈 → 查看明細帶篩選', async ({ browser }) => {
  test.setTimeout(150_000)
  mkdirSync(SHOTS, { recursive: true })
  const api = await adminApi('super_admin')
  let visitId: string | null = null
  let context: BrowserContext | null = null
  try {
    // 沒有 school_year＝不篩學年，同畫面 sy=all。
    const statsBefore = await api.get<StatsOut>(`/admin/admissions/stats?campus_key=${CAMPUS}`)
    const rowBefore = (stats: StatsOut, reason: string): WithdrawRow =>
      stats.withdraw_reasons.find((row) => row.reason === reason) ?? { reason, deposited: 0, enrolled: 0, total: 0 }

    let visit = await api.send<VisitOut>('POST', `/admin/admissions/records?campus_key=${CAMPUS}`, {
      visit_date: taipeiDate(-3), child_name: CHILD, birthday: `${TERM.schoolYear + 1911 - 3}-03-15`,
      target_school_year: TERM.schoolYear, target_semester: TERM.semester, phone: '0912000881',
    })
    visitId = visit.id
    visit = await api.send<VisitOut>('POST', `/admin/admissions/records/${visit.id}/transition`, { to_stage: 'deposited', expected_version: visit.version })
    visit = await api.send<VisitOut>('PATCH', `/admin/admissions/records/${visit.id}`, { expected_version: visit.version, phone: '0912000882' })

    const opened = await openAs(browser, 'super_admin')
    context = opened.context
    const page = opened.page
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    const drawer = page.getByRole('dialog', { name: '參觀→入學 歷程' })

    await test.step('歷程抽屜看得到「修改招生資料」，只寫改了哪個欄位', async () => {
      await gotoAdmin(page, `/admissions?campus=${CAMPUS}`, '招生入學')
      await page.locator('[draggable="true"]', { hasText: CHILD }).click()
      const item = drawer.locator('.events__item', { hasText: '修改招生資料' })
      await expect(item).toContainText('改了：電話')
      await expect(item).not.toContainText('0912')
    })

    await test.step('在歷程抽屜標記退預繳：沒選原因不能送，選了「費用考量」才送出', async () => {
      await drawer.getByRole('button', { name: '移到其他階段' }).click()
      await page.getByRole('menuitem', { name: '退預繳／退註冊', exact: true }).click()
      const dialog = page.getByRole('dialog', { name: '已預繳 → 退預繳' })
      const confirm = dialog.getByRole('button', { name: '標記退預繳', exact: true })
      await expect(confirm).toBeDisabled()
      // Element Plus 單選的 combobox 是唯讀的內層 input，被預設文字蓋住點不到：點外層的選單框（真人點的也是這裡）。
      await dialog.locator('.el-select', { has: page.getByRole('combobox', { name: '退出原因' }) }).click()
      await page.getByRole('option', { name: CATEGORY, exact: true }).click()
      await dialog.getByRole('textbox', { name: '說明' }).fill(DETAIL)
      await expect(confirm).toBeEnabled()
      await confirm.click()
      await expect(dialog).toBeHidden()
      // 事件標題是「退預繳／退註冊」；分類是 metadata 那行，說明是另一行（兩行不同名）。
      const withdrawn = drawer.locator('.events__item', { hasText: '退預繳／退註冊' })
      await expect(withdrawn).toContainText(`分類：${CATEGORY}`)
      await expect(withdrawn).toContainText(DETAIL)
    })

    await test.step('統計「未預繳與退出原因」：費用考量多一筆退預繳、未分類不變', async () => {
      await gotoAdmin(page, STATS_PATH, '招生入學')
      await expect(page.getByRole('tab', { name: '未預繳與退出原因' })).toHaveAttribute('aria-selected', 'true')
      const table = withdrawBlock(page)
      await expect(table).toBeVisible()
      const before = rowBefore(statsBefore, CATEGORY)
      const row = table.locator('tbody tr').filter({ has: page.getByRole('button', { name: `查看明細：${CATEGORY}` }) })
      await expect(row).toHaveCount(1)
      const cells = await row.locator('th, td').evaluateAll((nodes) => nodes.map((node) => (node.textContent ?? '').trim()))
      expect(cells[0]).toBe(CATEGORY)
      expect(Number.parseInt(cells[1]!, 10), `退預繳欄 ${cells[1]}`).toBe(before.deposited + 1)
      expect(Number.parseInt(cells[2]!, 10), `退註冊欄 ${cells[2]}`).toBe(before.enrolled)
      expect(Number.parseInt(cells[3]!, 10), `合計欄 ${cells[3]}`).toBe(before.total + 1)

      // 同一份數字再用 API 對一次：總數多一筆、未分類沒變（這筆有分類，不能掉進未分類）。
      const statsAfter = await api.get<StatsOut>(`/admin/admissions/stats?campus_key=${CAMPUS}`)
      expect(statsAfter.withdraw_total).toBe(statsBefore.withdraw_total + 1)
      expect(rowBefore(statsAfter, '未分類').total).toBe(rowBefore(statsBefore, '未分類').total)
      await page.screenshot({ path: path.join(SHOTS, 'withdraw-stats-1440.png'), fullPage: true })
      await withdrawBlock(page).screenshot({ path: path.join(SHOTS, 'withdraw-stats-block-1440.png') })
    })

    await test.step('查看明細帶分類回訪視明細：篩選列有退出原因下拉，明細列寫「分類（說明）」', async () => {
      await withdrawBlock(page).getByRole('button', { name: `查看明細：${CATEGORY}` }).click()
      await expect(page).toHaveURL(/tab=records/)
      await expect(page).toHaveURL(new RegExp(`wr=${encodeURIComponent(CATEGORY)}`))
      const row = page.locator('.el-table__row', { hasText: CHILD })
      await expect(row).toHaveCount(1)
      await row.getByRole('button', { name: '展開其他資料' }).click()
      await expect(page.getByText(`${CATEGORY}（${DETAIL}）`)).toBeVisible()

      // 篩選列：展開「更多篩選」才看得到退出原因下拉，下拉的值就是網址帶來的分類。
      const filters = page.locator('.records-filters')
      await filters.getByRole('button', { name: /更多篩選/ }).click()
      await expect(filters.getByRole('combobox', { name: '退出原因' })).toBeVisible()
      await expect(filters).toContainText(CATEGORY)
      await filters.screenshot({ path: path.join(SHOTS, 'withdraw-records-filters-1440.png') })
    })

    await test.step('手機寬度：訪視明細（含退出原因下拉）與統計分頁都不橫向溢出', async () => {
      await page.setViewportSize({ width: 390, height: 844 })
      await expectNoHorizontalOverflow(page)
      const filters = page.locator('.records-filters')
      const toggle = filters.getByRole('button', { name: /篩選/ }).first()
      if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click()
      await expect(filters.getByRole('combobox', { name: '退出原因' })).toBeVisible()
      await expectNoHorizontalOverflow(page)
      await filters.screenshot({ path: path.join(SHOTS, 'withdraw-records-filters-390.png') })
      await page.screenshot({ path: path.join(SHOTS, 'withdraw-records-390.png'), fullPage: true })

      await gotoAdmin(page, STATS_PATH, '招生入學')
      await expect(withdrawBlock(page)).toBeVisible()
      await expectNoHorizontalOverflow(page)
      await withdrawBlock(page).scrollIntoViewIfNeeded()
      await withdrawBlock(page).screenshot({ path: path.join(SHOTS, 'withdraw-stats-block-390.png') })
      await page.screenshot({ path: path.join(SHOTS, 'withdraw-stats-390.png'), fullPage: true })
    })

    expect(errors, `頁面錯誤：${errors.join('；')}`).toEqual([])
  } finally {
    try {
      if (visitId) {
        const current = await api.get<VisitOut>(`/admin/admissions/records/${visitId}`)
        await api.send('DELETE', `/admin/admissions/records/${visitId}?expected_version=${current.version}`)
      }
    } finally {
      await context?.close()
      await api.dispose()
    }
  }
})
