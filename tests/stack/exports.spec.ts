import { mkdirSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { expect, test, type Download, type Page } from '@playwright/test'
import { currentTerm } from '../../admin/src/admissions/academic'
import { adminApi, taipeiDate, type AdminApi } from './api'
import { expectNoHorizontalOverflow, gotoAdmin, openAs } from './pages'
import { ROOT, SLOTS_CAMPUS } from './stack-env'

// 後台匯出擴充（2026-10-06）：在瀏覽器裡按「匯出 CSV」真的拿到檔案。Excel 要的 BOM、CRLF、中文欄名、
// 民國月份「115年09月」與公式注入防護都在檔案裡，不只是單元測試裡的字串。
// 訪視明細與未預繳名單由後端產生（含個資、寫稽核）；統計表與操作紀錄由前端組。API 只用來建一筆訪視，
// 按鈕一律在畫面上按。檔案用 download 事件取回，讀位元組檢查 BOM，不經過任何文字解碼。
// 本檔只比對自己建的孩子；招生訪視的絕對數字只在 admissions-flow.spec 斷言。
const SHOTS = path.join(ROOT, 'output/playwright')
const CHILD = '匯出流程寶貝'
const TERM = currentTerm(taipeiDate(0))
const VISIT_DATE = taipeiDate(-1)
// 月份欄在 CSV 寫「115年10月」，不是畫面上的「115.10」：Excel 會把 115.10 轉成數字 115.1。
const [VISIT_YEAR, VISIT_MONTH] = VISIT_DATE.split('-')
const ROC_MONTH_CSV = `${Number(VISIT_YEAR) - 1911}年${VISIT_MONTH}月`
const NOTES = '=HYPERLINK("http://x")\n第二行,有逗號\n第三行有"引號"'
const ADDRESS = '@SUM(1+1)'
const RECORD_HEADER = [
  '校區', '月份', '序號', '參觀日期', '幼生姓名', '英文名字', '生日', '班別', '入學學年', '入學學期',
  '階段', '預繳', '已註冊', '聯絡人', '電話', '地址', '父親職業', '母親職業', '來源', '來源分類',
  '家長介紹', '帶參觀老師', '搭娃娃車', '收預繳人員', '未預繳原因', '未預繳說明', '保留座位', '註冊日期',
  '轉學期', '退出原因', '下次聯絡', '負責人', '最近聯絡', '官網預約', '電訪回應', '備註', '建檔時間',
]
const NO_DEPOSIT_HEADER = ['校區', '月份', '序號', '姓名', '班別', '原因分類', '轉換潛力', '冷名單', '說明', '來源', '家長介紹', '電訪回應', '建檔時間']
const AUDIT_HEADER = ['日期時間', '操作者', '操作者 Email', '動作', '對象類型', '對象帳號', '校區', '細節', '其他細節', '裝置']

interface Csv {
  filename: string
  text: string
  rows: string[][]
}

/** RFC 4180：雙引號包住的欄位可以有逗號、換行與兩個連續的雙引號。 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (quoted) {
      if (ch !== '"') cell += ch
      else if (text[i + 1] === '"') {
        cell += '"'
        i += 1
      } else quoted = false
    } else if (ch === '"') quoted = true
    else if (ch === ',') {
      row.push(cell)
      cell = ''
    } else if (ch === '\r' && text[i + 1] === '\n') {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
      i += 1
    } else cell += ch
  }
  if (cell || row.length) rows.push([...row, cell])
  return rows
}

/** 按下匯出鈕、取回瀏覽器下載的檔案，並檢查 Excel 要的三件事：開頭 BOM 位元組、CRLF 換行、一列一筆。 */
async function downloadCsv(page: Page, click: () => Promise<void>): Promise<Csv> {
  const downloading = page.waitForEvent('download')
  await click()
  const file: Download = await downloading
  expect(await file.failure()).toBeNull()
  const bytes = await readFile((await file.path())!)
  expect([...bytes.subarray(0, 3)], '檔案開頭要有 UTF-8 BOM（EF BB BF）').toEqual([0xef, 0xbb, 0xbf])
  const text = bytes.subarray(3).toString('utf8')
  expect(text.charCodeAt(0), 'BOM 不能寫兩次').not.toBe(0xfeff)
  expect(text.endsWith('\r\n'), '最後一列也要以 CRLF 結尾').toBe(true)
  // 雙引號包住的換行（備註裡的）不算：其餘的換行一律是 CRLF，不能出現單獨的 LF 或 CR。
  const outsideQuotes = text.replace(/"(?:[^"]|"")*"/g, '')
  expect(/(^|[^\r])\n|\r(?!\n)/.test(outsideQuotes), '列與列之間只能是 CRLF').toBe(false)
  return { filename: file.suggestedFilename(), text, rows: parseCsv(text).filter((row) => row.length > 1 || row[0] !== '') }
}

/** 每一列欄數都和表頭一樣：自由文字的逗號、換行、引號沒有讓 Excel 錯位。 */
function expectRectangular({ rows }: Csv): void {
  const width = rows[0]!.length
  for (const [index, row] of rows.entries()) expect(row, `第 ${index + 1} 列欄數`).toHaveLength(width)
}

/** 公式注入防護：開頭是 = + - @ 的儲存格前面補單引號，試算表不會當成公式執行。 */
function expectNoFormulaCells({ rows }: Csv): void {
  for (const row of rows) for (const cell of row) expect(cell, `儲存格「${cell}」會被當成公式`).not.toMatch(/^[=+\-@]/)
}

async function createRecord(api: AdminApi): Promise<void> {
  await api.send('POST', `/admin/admissions/records?campus_key=${SLOTS_CAMPUS}`, {
    visit_date: VISIT_DATE,
    child_name: CHILD,
    birthday: `${TERM.schoolYear + 1911 - 3}-03-15`,
    target_school_year: TERM.schoolYear,
    target_semester: TERM.semester,
    grade: '小班',
    contact_name: '匯出流程家長',
    phone: '0912000791',
    address: ADDRESS,
    source: '朋友介紹',
    source_category: 'referral',
    // 高潛力原因：未預繳名單預設就看得到，不必先改篩選。
    no_deposit_reason: '時程未到／仍在觀望',
    notes: NOTES,
  })
}

test.describe.configure({ mode: 'serial' })

let api: AdminApi
test.beforeAll(async () => {
  mkdirSync(SHOTS, { recursive: true })
  api = await adminApi('super_admin')
  await createRecord(api)
})
test.afterAll(async () => {
  await api.dispose()
})

test('訪視明細：依畫面篩選下載，欄位、月份、公式注入防護都在檔案裡', async ({ browser }) => {
  const { context, page } = await openAs(browser, 'super_admin')
  try {
    await gotoAdmin(page, `/admissions?campus=${SLOTS_CAMPUS}&sy=all&tab=records`, '招生入學')
    await expect(page.getByText(CHILD).first()).toBeVisible()

    await test.step('搜尋孩子後匯出：只有這一筆（匯出的是目前篩選的全部結果）', async () => {
      await page.getByRole('textbox', { name: '搜尋訪視' }).fill(CHILD)
      await expect(page.locator('.records-table .el-table__body tr')).toHaveCount(1)
      const csv = await downloadCsv(page, () => page.getByRole('button', { name: '匯出 CSV' }).click())
      expect(csv.filename).toBe(`招生訪視明細-義華-${taipeiDate(0)}.csv`)
      expect(csv.rows[0]).toEqual(RECORD_HEADER)
      expect(csv.rows).toHaveLength(2)
      expectRectangular(csv)
      expectNoFormulaCells(csv)

      const cell = Object.fromEntries(RECORD_HEADER.map((name, index) => [name, csv.rows[1]![index]!]))
      expect(cell['校區']).toBe('義華')
      expect(cell['月份']).toBe(ROC_MONTH_CSV)
      expect(cell['幼生姓名']).toBe(CHILD)
      expect(cell['參觀日期']).toBe(VISIT_DATE.replaceAll('-', '/'))
      expect(cell['班別']).toBe('小班')
      expect(cell['階段']).toBe('已訪視')
      expect(cell['預繳']).toBe('否')
      // 手機寫成 0912-000-791，Excel 才不會當數值吃掉開頭的 0。
      expect(cell['電話']).toBe('0912-000-791')
      expect(cell['來源分類']).toBe('家長介紹／社區招生')
      expect(cell['未預繳原因']).toBe('時程未到／仍在觀望')
      expect(cell['官網預約']).toBe('否')
      // 自由文字：換行、逗號、雙引號留在同一格；= 與 @ 開頭的補單引號。
      expect(cell['地址']).toBe(`'${ADDRESS}`)
      expect(cell['備註']).toBe(`'${NOTES}`)
    })

    await test.step('換一個搜尋字：匯出跟著篩選走，沒有符合的只剩表頭', async () => {
      await page.getByRole('textbox', { name: '搜尋訪視' }).fill('這個名字絕對沒有人')
      await expect(page.locator('.records-table .el-table__body tr')).toHaveCount(0)
      // 沒有資料時畫面是空狀態；篩選後 0 筆的匯出不是錯誤，是只有表頭的檔案。
      const csv = await downloadCsv(page, () => page.getByRole('button', { name: '匯出 CSV' }).click())
      expect(csv.rows).toEqual([RECORD_HEADER])
    })
  } finally {
    await context.close()
  }
})

test('未預繳名單：統計分析的未預繳原因頁下載', async ({ browser }) => {
  const { context, page } = await openAs(browser, 'super_admin')
  try {
    await gotoAdmin(page, `/admissions?campus=${SLOTS_CAMPUS}&sy=all&tab=stats&sub=nodeposit`, '招生入學')
    const list = page.locator('section.nd')
    await expect(list.getByRole('heading', { name: '未預繳明細' })).toBeVisible()
    await expect(list.getByText(CHILD)).toBeVisible()

    const csv = await downloadCsv(page, () => list.getByRole('button', { name: '匯出 CSV' }).click())
    expect(csv.filename).toBe(`未預繳名單-義華-${taipeiDate(0)}.csv`)
    expect(csv.rows[0]).toEqual(NO_DEPOSIT_HEADER)
    expectRectangular(csv)
    expectNoFormulaCells(csv)

    const row = csv.rows.find((cells) => cells[3] === CHILD)
    expect(row, '名單裡要有剛建的孩子').toBeTruthy()
    const cell = Object.fromEntries(NO_DEPOSIT_HEADER.map((name, index) => [name, row![index]!]))
    expect(cell['校區']).toBe('義華')
    expect(cell['月份']).toBe(ROC_MONTH_CSV)
    expect(cell['班別']).toBe('小班')
    expect(cell['原因分類']).toBe('時程未到／仍在觀望')
    expect(cell['轉換潛力']).toBe('高')
    expect(cell['來源']).toBe('朋友介紹')
  } finally {
    await context.close()
  }
})

test('統計表：每張表自己的「匯出 CSV」，月份寫成 115年10月、缺值不寫「—」', async ({ browser }) => {
  const { context, page } = await openAs(browser, 'super_admin')
  try {
    await gotoAdmin(page, `/admissions?campus=${SLOTS_CAMPUS}&sy=all&tab=stats&sub=class`, '招生入學')
    const block = page.locator('section.stats-block', { has: page.getByRole('heading', { name: '月份 × 班別分布' }) })
    await expect(block.locator('tbody tr').first()).toBeVisible()

    const csv = await downloadCsv(page, () => block.getByRole('button', { name: '把「月份 × 班別分布」匯出 CSV' }).click())
    expect(csv.filename).toMatch(/^招生統計-月份 × 班別分布-義華-全部學年-\d{4}-\d{2}-\d{2}\.csv$/)
    expect(csv.rows[0]![0]).toBe('月份')
    expectRectangular(csv)
    expectNoFormulaCells(csv)
    // 畫面上的 115.10 在檔案裡是 115年10月；不能有任何一格還是「115.10」這種會被 Excel 轉成數字的寫法。
    expect(csv.rows.slice(1).map((row) => row[0])).toContain(ROC_MONTH_CSV)
    for (const row of csv.rows.slice(1)) expect(row[0]).not.toMatch(/^\d{3}\.\d{1,2}$/)
    expect(csv.text).not.toContain('—')

    // 班別統計是另一張表、另一個按鈕：檔名與欄位各自獨立。
    const grades = await downloadCsv(page, () => page.getByRole('button', { name: '把「班別統計」匯出 CSV' }).click())
    expect(grades.filename).toMatch(/^招生統計-班別統計-義華-/)
    expect(grades.rows.map((row) => row[0])).toContain('小班')
  } finally {
    await context.close()
  }
})

test('操作紀錄：選期間後下載，總部有裝置與 IP 欄，匯出招生名單的紀錄在裡面', async ({ browser }) => {
  const { context, page } = await openAs(browser, 'super_admin')
  try {
    await gotoAdmin(page, '/audit', '操作紀錄')
    const today = taipeiDate(0)

    await test.step('期間選今天：清單與匯出都帶同一組日期', async () => {
      // 日期範圍選擇器的 aria-label 與 data-test 都落在兩個輸入框上（開始、結束）。
      const [start, end] = [page.getByRole('combobox', { name: '期間' }).first(), page.getByRole('combobox', { name: '期間' }).last()]
      const reloaded = page.waitForRequest((request) => request.url().includes('/admin/audit-log') && request.url().includes(`created_from=${today}`))
      await start.fill(today)
      await end.fill(today)
      await end.press('Enter')
      const url = new URL((await reloaded).url())
      expect(url.searchParams.get('created_to')).toBe(today)
      await expect(page.getByRole('status').filter({ hasText: /已載入 \d+ 筆/ })).toBeVisible()
    })

    const csv = await downloadCsv(page, () => page.locator('[data-test="audit-export"]').click())
    expect(csv.filename).toBe(`操作紀錄-全部校區-${today}至${today}-${today}.csv`)
    // 總部多一欄 IP（後端只給總部）；每個人都有「裝置」。
    expect(csv.rows[0]).toEqual([...AUDIT_HEADER, 'IP'])
    expectRectangular(csv)
    expectNoFormulaCells(csv)
    // 前面兩個測試匯出的招生名單各留了一筆稽核；日期時間是台北時間「2026/10/06 14:30」。
    const exported = csv.rows.filter((row) => row[3] === '匯出招生訪視明細')
    expect(exported.length, '匯出訪視明細的稽核紀錄').toBeGreaterThanOrEqual(1)
    expect(exported[0]![0]).toMatch(/^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}$/)
    expect(exported[0]![2]).toBe('e2e-super@ivy.example')
    // 這筆是 Chrome 按出來的：裝置欄有瀏覽器名稱，總部的 IP 欄有值。
    expect(exported[0]![9]).toContain('Chrome')
    expect(exported[0]![10]).toMatch(/\d/)
    // 稽核只記筆數與套用的篩選：搜尋那一次匯出 1 筆，換個搜尋字後匯出 0 筆；搜尋字本身不記。
    expect(exported.map((row) => row[7])).toEqual(expect.arrayContaining([expect.stringContaining('匯出 1 筆'), expect.stringContaining('匯出 0 筆')]))
    expect(csv.text).not.toContain('這個名字絕對沒有人')
    expect(csv.rows.some((row) => row[3] === '匯出未預繳名單')).toBe(true)
  } finally {
    await context.close()
  }
})

test('權限：分校管理者沒有名單匯出鈕，操作紀錄匯出沒有 IP 欄', async ({ browser }) => {
  const { context, page } = await openAs(browser, 'campus_admin')
  try {
    await gotoAdmin(page, `/admissions?campus=${SLOTS_CAMPUS}&sy=all&tab=records`, '招生入學')
    await expect(page.getByText(CHILD).first()).toBeVisible()
    // 含孩子姓名、電話的名單要「匯出個資」授權（總管理者逐人授予）；沒有授權連按鈕都不出現。
    await expect(page.getByRole('button', { name: '新增訪視' })).toBeVisible()
    await expect(page.getByRole('button', { name: '匯出 CSV' })).toHaveCount(0)

    // 去識別的統計表不受這個授權限制。
    await gotoAdmin(page, `/admissions?campus=${SLOTS_CAMPUS}&sy=all&tab=stats&sub=class`, '招生入學')
    await expect(page.getByRole('button', { name: '把「班別統計」匯出 CSV' })).toBeVisible()

    await gotoAdmin(page, '/audit', '操作紀錄')
    await expect(page.getByRole('status').filter({ hasText: /已載入 \d+ 筆/ })).toBeVisible()
    const csv = await downloadCsv(page, () => page.locator('[data-test="audit-export"]').click())
    expect(csv.filename).toMatch(/^操作紀錄-義華-全部期間-\d{4}-\d{2}-\d{2}\.csv$/)
    expect(csv.rows[0]).toEqual(AUDIT_HEADER)
    expectRectangular(csv)
  } finally {
    await context.close()
  }
})

test('版面：訪視明細標題列與操作紀錄篩選列在 1440 與 390 都看得到按鈕、頁面不橫向溢出', async ({ browser }) => {
  for (const device of [
    { name: '1440', options: {} },
    { name: '390', options: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ] as const) {
    const { context, page } = await openAs(browser, 'super_admin', device.options)
    try {
      await gotoAdmin(page, `/admissions?campus=${SLOTS_CAMPUS}&sy=all&tab=records`, '招生入學')
      await expect(page.getByText(CHILD).first()).toBeVisible()
      const head = page.locator('.records__head-actions')
      await expect(head.getByRole('button', { name: '匯出 CSV' })).toBeVisible()
      await expect(head.getByRole('button', { name: '新增訪視' })).toBeVisible()
      await expectNoHorizontalOverflow(page)
      await page.screenshot({ path: path.join(SHOTS, `exports-admissions-records-${device.name}.png`) })

      await gotoAdmin(page, '/audit', '操作紀錄')
      await expect(page.getByRole('status').filter({ hasText: /已載入 \d+ 筆/ })).toBeVisible()
      await expect(page.locator('[data-test="audit-export"]')).toBeVisible()
      await expect(page.getByRole('combobox', { name: '期間' }).first()).toBeVisible()
      await expectNoHorizontalOverflow(page)
      await page.screenshot({ path: path.join(SHOTS, `exports-audit-filter-${device.name}.png`) })
    } finally {
      await context.close()
    }
  }
})
