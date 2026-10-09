import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { currentTerm } from '../../admin/src/admissions/academic'
import { adminApi, taipeiDate } from './api'
import { expectNoHorizontalOverflow, gotoAdmin, openAs } from './pages'
import { ROOT } from './stack-env'

// 招生區域分析（2026-10-08 規格 14.4）：start-api.sh 用 tests/stack/fixtures/geo-* 匯入門牌與幼兒園樣本
// （不連外）。在崇德校建兩筆訪視——admissions-flow.spec 的統計斷言只看義華，不互相影響：
// 一筆左營區新上里（距崇德約 1.2 公里）、一筆臺南地址（非高雄市）。地圖底圖圖磚一律攔下回透明圖。
// 最後兩個 test 是 1440／390 截圖（output/playwright/，給人看，不比對像素）與「頁面不橫向溢出」。

const CAMPUS = 'chongde'
const TERM = currentTerm(taipeiDate(0))
const CHILD_NEAR = '區域分析甲童'
const CHILD_TAINAN = '區域分析乙童'
const SHOTS = path.join(ROOT, 'output/playwright')
const TRANSPARENT_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
)
const AREA_PATH = `/admissions?campus=${CAMPUS}&tab=stats&sub=area`

async function blockTiles(page: Page): Promise<void> {
  await page.route('https://wmts.nlsc.gov.tw/**', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: TRANSPARENT_PNG }))
}
const statsBlock = (page: Page, title: string) =>
  page.locator('.stats-block', { has: page.getByRole('heading', { name: title, exact: true }) })

test('區域分析：門牌比對到里 → 三張表 → 附近幼兒園 → 地圖著色 → 查看明細帶區域', async ({ browser }) => {
  test.setTimeout(90_000)
  const api = await adminApi('super_admin')
  for (const [child, address] of [
    [CHILD_NEAR, '813高雄市左營區明華一路175號3樓'],
    [CHILD_TAINAN, '臺南市東區大學路1號'],
  ] as const) {
    await api.send('POST', `/admin/admissions/records?campus_key=${CAMPUS}`, {
      visit_date: taipeiDate(0),
      child_name: child,
      birthday: `${TERM.schoolYear + 1911 - 3}-03-15`,
      target_school_year: TERM.schoolYear,
      target_semester: TERM.semester,
      address,
    })
  }
  const { context, page } = await openAs(browser, 'super_admin')
  await blockTiles(page)

  await test.step('統計分析 → 區域分析：狀態列與三張表', async () => {
    await gotoAdmin(page, AREA_PATH, '招生入學')
    await expect(page.locator('.area-status')).toContainText('門牌資料')
    await expect(page.locator('.area-status')).not.toContainText('尚未匯入')
    // 狀態列以有地址為母數（R5）：兩筆都填了地址，一筆到里、一筆是非高雄市。
    await expect(page.locator('.area-summary')).toContainText('有地址 2 筆：到里 1 筆、未定位到里 1 筆（非高雄市 1）')
    await expect(page.locator('.area-summary')).not.toContainText('沒填地址')
    await expect(statsBlock(page, '里排行').locator('tbody tr').first()).toContainText('左營區新上里')
    // 臺南那筆沒有行政區：後端若另列一行，和左營區同為 1 人、先後不定，所以不比第一列。
    await expect(statsBlock(page, '行政區排行').locator('tbody')).toContainText('左營區')
    const band = statsBlock(page, '距離分布').locator('tbody tr', { hasText: '1–3 公里' })
    await expect(band.locator('td').first()).toHaveText('1')
  })

  await test.step('附近幼兒園：3 公里內本機構＋三所；6 公里多一所；停業與外縣市不列', async () => {
    const list = page.locator('.nearby')
    await expect(list.locator('.nearby__item', { hasText: '常春藤崇德幼兒園' })).toContainText('本機構')
    await expect(list.locator('.nearby__item')).toHaveCount(4)
    await list.locator('.el-radio-button', { hasText: '6 公里' }).click()
    await expect(list.locator('.nearby__item')).toHaveCount(5)
    await expect(list).toContainText('測試丁幼兒園')
    await expect(list).not.toContainText('已停業')
    await expect(list).not.toContainText('測試戊')
  })

  await test.step('地圖：里界載入，新上里是最深的一級', async () => {
    await expect(page.locator('.area-map .leaflet-container')).toBeVisible()
    await expect(page.locator('.area-map path.area-village--l5')).toHaveCount(1)
  })

  await test.step('里排行「查看明細」→ 訪視明細只列新上里；上一頁回到區域分析', async () => {
    await statsBlock(page, '里排行').getByRole('button', { name: '查看明細：左營區新上里' }).click()
    await expect(page).toHaveURL(/tab=records/)
    expect(new URL(page.url()).searchParams.get('area')).toBe('左營區/新上里')
    await expect(page.getByText('只顯示左營區新上里的訪視。')).toBeVisible()
    await expect(page.locator('.records-table .el-table__row', { hasText: CHILD_NEAR })).toHaveCount(1)
    await expect(page.locator('.records-table .el-table__row', { hasText: CHILD_TAINAN })).toHaveCount(0)
    await page.goBack()
    await expect(page.locator('.stats-subtabs .el-tabs__item.is-active')).toHaveText('區域分析')
  })

  await Promise.all([context.close(), api.dispose()])
})

const VIEWPORTS = [
  { name: '1440', device: { viewport: { width: 1440, height: 900 } } },
  { name: '390', device: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
]

for (const { name, device } of VIEWPORTS) {
  test(`${name}px：區域分析截圖，頁面不橫向溢出`, async ({ browser }) => {
    mkdirSync(SHOTS, { recursive: true })
    const { context, page } = await openAs(browser, 'super_admin', device)
    await blockTiles(page)
    await gotoAdmin(page, AREA_PATH, '招生入學')
    const leafletMap = page.locator('.area-map .leaflet-container')
    await expect(leafletMap).toBeVisible()
    await page.waitForLoadState('networkidle')
    await expect(page.locator('.el-skeleton')).toHaveCount(0)
    // 地圖真的建起來了（里界畫出來、沒有「地圖載入失敗」之類的提示），不只是容器在。
    await expect(page.locator('.area-map path.area-village').first()).toBeAttached()
    await expect(page.locator('.area-map__notice')).toHaveCount(0)
    await test.step('不橫向溢出', () => expectNoHorizontalOverflow(page))
    if (name === '390') {
      // 手機預設不攔單指：地圖沒有拖曳／縮放手勢，touch-action 維持 auto，整頁捲得動；按「移動地圖」才接手。
      await expect(leafletMap).toHaveCSS('touch-action', 'auto')
      await page.getByRole('button', { name: '移動地圖' }).click()
      await expect(leafletMap).toHaveCSS('touch-action', 'none')
      await page.getByRole('button', { name: '完成' }).click()
      await expect(leafletMap).toHaveCSS('touch-action', 'auto')
      await expect(page.getByRole('button', { name: '移動地圖' })).toBeVisible()
    }
    await page.screenshot({ path: path.join(SHOTS, `admissions-area-${name}.png`), fullPage: true })
    await context.close()
  })
}
