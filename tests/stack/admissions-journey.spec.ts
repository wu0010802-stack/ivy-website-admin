import { mkdirSync } from 'node:fs'
import path from 'node:path'
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { clearJourney, seedJourney } from './db'
import { expectNoHorizontalOverflow, gotoAdmin, openAs } from './pages'
import { ROOT } from './stack-env'

// 預約全程（2026-10-15 規格 §4）：用 db.ts 在 renwu 校區寫一批案件（8 筆預約＋1 筆現場訪視），日期相對今天；
// 驗證漏斗、離開、取消時點與各段天數的數字，1440／390 不橫向溢出與 axe，再給人看截圖。測試結束一律清除種子。
const CAMPUS = 'renwu'
const SHOTS = path.join(ROOT, 'output/playwright')
const journeyPath = `/admissions?campus=${CAMPUS}&tab=stats&sub=journey`

const block = (page: Page, title: string): Locator =>
  page.locator('.stats-block', { has: page.locator('.stats-block__title', { hasText: title }) }).first()
const rowTexts = async (section: Locator): Promise<string[][]> =>
  section.locator('tbody tr').evaluateAll((rows) => rows.map((row) => [...row.querySelectorAll('th, td')].map((cell) => (cell.textContent ?? '').trim())))

test.beforeEach(() => seedJourney())
test.afterEach(() => clearJourney())

test('預約全程：漏斗、離開、取消時點、各段天數與涵蓋說明', async ({ browser }) => {
  test.setTimeout(90_000)
  mkdirSync(SHOTS, { recursive: true })
  const { context, page } = await openAs(browser, 'super_admin')
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await gotoAdmin(page, journeyPath, '招生入學')

  await test.step('摘要句與漏斗表', async () => {
    await expect(page.locator('.journey-summary')).toContainText('預定參觀的預約 8 筆：到場 5（到場率 83.3%）、取消 2、沒來 1、時間已過未標記 0。')
    await expect(page.locator('.journey-summary')).toContainText('到場的 5 筆中 4 筆有招生紀錄，預繳 2、註冊 1、預繳後退出 1。')
    const funnel = block(page, '全程漏斗')
    expect(await rowTexts(funnel)).toEqual([
      ['預約案件', '8', '取消率 25.0%（2／8）・樣本較少'],
      ['已到場', '5', '到場率 83.3%（5／6）・樣本較少'],
      ['有招生訪視', '4', '有訪視比例 80.0%（4／5）・樣本較少'],
      ['預繳過', '2', '預繳率 50.0%（2／4）・樣本較少'],
      ['註冊過', '1', '註冊率 50.0%（1／2）・樣本較少'],
      ['預繳後退出', '1', '退出比例 50.0%（1／2）・樣本較少'],
    ])
    // 長條以預約案件數為 100%：第一列滿格、每一列都畫得出來。
    const fills = funnel.locator('.stats-bar__fill')
    await expect(fills).toHaveCount(6)
    const widths = await fills.evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().width))
    expect(widths.every((width) => width > 0), `長條寬度 ${widths.join('、')}`).toBe(true)
    expect(widths[0]).toBeGreaterThan(widths[1]!)
  })

  await test.step('家庭在哪裡離開：取消、沒來、沒有訪視、觀察中與逾期、退預繳', async () => {
    const rows = await rowTexts(block(page, '家庭在哪裡離開'))
    expect(rows.map((row) => [row[0], row[1]])).toEqual([
      ['已取消・家長', '1'], ['已取消・園方', '1'], ['已取消・其他或沒記', '0'], ['沒來', '1'], ['時間已過未標記', '0'],
      ['已到場但沒有招生訪視', '1'], ['參觀後未預繳・觀察中', '1'], ['參觀後未預繳・逾期', '1'], ['參觀後未預繳・冷名單', '0'],
      ['預繳後退出・退預繳', '1'], ['預繳後退出・退註冊', '0'],
    ])
    // 有取消時點的資料，三列取消（含人數 0 的「其他」）都指向下面那張表。
    expect(rows.slice(0, 3).map((row) => row[2])).toEqual(['距參觀日見下表', '距參觀日見下表', '距參觀日見下表'])
  })

  await test.step('取消時點：家長當天、園方 4–7 天前', async () => {
    const rows = await rowTexts(block(page, '取消時點（距參觀日）'))
    expect(rows.find((row) => row[0] === '當天')).toEqual(['當天', '1', '0', '0'])
    expect(rows.find((row) => row[0] === '4–7 天前')).toEqual(['4–7 天前', '0', '1', '0'])
  })

  await test.step('各段要花多久', async () => {
    expect(await rowTexts(block(page, '各段要花多久'))).toEqual([
      ['預約提前量（預約送出到預定參觀日）', '7 天', '8', '樣本較少'],
      ['參觀到預繳', '7.5 天', '2', '樣本較少'],
      ['預繳到註冊', '10 天', '1', '樣本較少'],
      ['預繳到退出', '15 天', '1', '樣本較少'],
    ])
  })

  await test.step('涵蓋說明：現場訪視不在漏斗裡', async () => {
    const text = await page.locator('.journey-coverage').innerText()
    expect(text).toContain('另有 1 筆招生訪視沒有預約案件')
    expect(text).toContain('已到場但沒有招生訪視 1 筆')
  })

  await test.step('切到「官網預約」「後台補登」：數字跟著變、網址帶來源', async () => {
    await page.getByRole('radio', { name: '後台補登' }).check({ force: true })
    await expect(page.locator('.journey-empty')).toBeVisible() // 種子都是官網預約，後台補登沒有案件
    await expect(page).toHaveURL(/js=assisted/)
    await page.getByRole('radio', { name: '全部' }).check({ force: true })
    await expect(page.locator('.journey-summary')).toContainText('預約 8 筆')
  })

  await test.step('新區塊沒有 serious／critical 的無障礙問題', async () => {
    const results = await new AxeBuilder({ page }).include('.journey').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
    const serious = results.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
    expect(serious.map((violation) => `${violation.id}：${violation.nodes.map((node) => node.target.join(' ')).join('；')}`)).toEqual([])
  })

  await expectNoHorizontalOverflow(page)
  await page.screenshot({ path: path.join(SHOTS, 'admissions-journey-1440.png'), fullPage: true })
  expect(errors, '頁面不該有未處理的錯誤').toEqual([])
  await context.close()
})

test('390px：預約全程不撐出頁面', async ({ browser }) => {
  mkdirSync(SHOTS, { recursive: true })
  const { context, page } = await openAs(browser, 'super_admin', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  await gotoAdmin(page, journeyPath, '招生入學')
  await expect(page.locator('.journey-summary')).toBeVisible()
  await expect(block(page, '全程漏斗')).toBeVisible()
  await expectNoHorizontalOverflow(page)
  await page.screenshot({ path: path.join(SHOTS, 'admissions-journey-390.png'), fullPage: true })
  await context.close()
})
