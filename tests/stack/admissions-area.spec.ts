import { mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { currentTerm } from '../../admin/src/admissions/academic'
import { adminApi, taipeiDate, type AdminApi } from './api'
import { seedBirthSeries, seedEnrolled, seedPeerFees, seedProviderChanges } from './db'
import { expectNoHorizontalOverflow, gotoAdmin, openAs } from './pages'
import { ROOT } from './stack-env'

// 招生區域分析（2026-10-08 規格 14.4）：start-api.sh 用 tests/stack/fixtures/geo-* 匯入門牌與幼兒園樣本
// （不連外）。在崇德校建兩筆訪視——admissions-flow.spec 的統計斷言只看義華，不互相影響：
// 一筆左營區新上里（距崇德約 1.2 公里）、一筆臺南地址（非高雄市）。地圖底圖圖磚一律攔下回透明圖，
// 並確認它真的被請求、被 Leaflet 載入（blockTiles／expectTilesLoaded）。
// 托嬰名單與園所變化（2026-10-14）：start-api.sh 另匯入托嬰樣本，db.ts 寫入停辦事件與新設日期。
// 其餘：里界 GeoJSON 經官網代理壓成 gzip（2026-10-12）、390px 地圖「移動地圖」手勢、
// 本校地址比對不到門牌（仁武校暫時改地址，結束還原）、1440／390 截圖（output/playwright/，給人看，
// 不比對像素）與「頁面不橫向溢出」。
// 地圖工作台（2026-10-16，規格 docs/specs/2026-10-16-admissions-area-workbench-design.md）：由上而下是工具列
// （.area-toolbar：看什麼、範圍）→ 工作台（.area-workbench：地圖＋右欄 .area-workbench__side）→ 完整表格
// （.area-full-tables，六個分頁）→ 頁尾（.area-footer）。點里開右欄的里卡片（不再開 popup），模式、里、表格分頁寫進網址
// （map／village／table）。附近幼兒園、托嬰、園所變化在「同業」模式的右欄；三張參觀表在「參觀來源」分頁。
// 預設模式：該校有在籍清冊是「在籍學生」，沒有是「2–5 歲孩子」；用到特定模式的測試一律明寫（點工具列或帶 map=），
// 不靠預設，因為在籍測試會替崇德校匯入清冊、改變後面測試的預設。

const CAMPUS = 'chongde'
// 本校位置未定位的測試對象：admissions-flow 等其他 spec 都不碰仁武校。
const UNLOCATED_CAMPUS = 'renwu'
const UNLOCATED_ADDRESS = '高雄市仁武區測試路1號'
const TERM = currentTerm(taipeiDate(0))
const CHILD_NEAR = '區域分析甲童'
const CHILD_TAINAN = '區域分析乙童'
const CHILD_UNLOCATED = '區域分析丙童'
const NEAR_ADDRESS = '813高雄市左營區明華一路175號3樓'
const SHOTS = path.join(ROOT, 'output/playwright')
const TRANSPARENT_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
)
const TILE_URL = /^https:\/\/wmts\.nlsc\.gov\.tw\/wmts\/EMAP\/default\/GoogleMapsCompatible\/\d+\/\d+\/\d+$/
const areaPath = (campus: string) => `/admissions-stats?campus=${campus}&sub=area`

const DESKTOP = { viewport: { width: 1440, height: 900 } }
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }
const VIEWPORTS = [
  { name: '1440', device: DESKTOP },
  { name: '390', device: PHONE },
]

/** 攔下底圖圖磚並回透明圖；回傳被攔到的圖磚網址，給 expectTilesLoaded 做正向斷言。 */
async function blockTiles(page: Page): Promise<string[]> {
  const requested: string[] = []
  await page.route('https://wmts.nlsc.gov.tw/**', (route) => {
    requested.push(route.request().url())
    return route.fulfill({ status: 200, contentType: 'image/png', body: TRANSPARENT_PNG })
  })
  return requested
}

/** 圖磚真的載入：Leaflet 對載入完成的圖磚加 leaflet-tile-loaded，且請求的是國土測繪中心的 WMTS 網址。 */
async function expectTilesLoaded(page: Page, requested: string[]): Promise<void> {
  await expect(page.locator('.area-map img.leaflet-tile-loaded').first()).toBeAttached()
  expect(requested.length, '地圖沒有請求任何底圖圖磚').toBeGreaterThan(0)
  for (const url of requested) expect(url).toMatch(TILE_URL)
}

/**
 * 打開某校的區域分析，等到地圖畫好（里界、圖磚都在）、骨架消失、沒有地圖錯誤提示。
 * query 是接在網址後面的參數（例如 `map=peers&table=fees`），讓測試明寫要看哪個模式與分頁。
 */
async function openArea(page: Page, campus: string = CAMPUS, query = ''): Promise<void> {
  const tiles = await blockTiles(page)
  await gotoAdmin(page, `${areaPath(campus)}${query ? `&${query}` : ''}`, '招生統計')
  await expect(page.locator('.area-map .leaflet-container')).toBeVisible()
  // 地圖真的建起來了（里界畫出來），不只是容器在。
  await expect(page.locator('.area-map path.area-village').first()).toBeAttached()
  await expectTilesLoaded(page, tiles)
  await expect(page.locator('.el-skeleton')).toHaveCount(0)
  await expect(page.locator('.area-map__notice')).toHaveCount(0)
  await expect(page.locator('.area-map-error')).toHaveCount(0)
}

/** 校區座標由「已發布的校區介紹」地址比對門牌而來：改地址並發布，等於讓這一校定位到別處或定位不到。 */
async function publishCampusAddress(api: AdminApi, campus: string, address: string): Promise<void> {
  const query = `campus_key=${campus}`
  const item = await api.get<{ latest_version: number; latest_revision: { payload: Record<string, unknown> } }>(
    `/admin/content-items/campus_profile?${query}`,
  )
  const saved = await api.send<{ latest_revision: { id: string } }>('POST', `/admin/content-items/campus_profile/revisions?${query}`, {
    expected_version: item.latest_version,
    payload: { ...item.latest_revision.payload, address },
  })
  await api.send('POST', `/admin/content-items/campus_profile/publish?${query}`, { revision_id: saved.latest_revision.id })
}

async function campusAddress(api: AdminApi, campus: string): Promise<string> {
  const item = await api.get<{ latest_revision: { payload: { address?: string } } }>(`/admin/content-items/campus_profile?campus_key=${campus}`)
  const address = item.latest_revision.payload.address
  if (!address) throw new Error(`${campus} 的校區介紹沒有地址`)
  return address
}

/** 崇德校加一筆住在新上里的訪視：工作台測試要有「參觀」的里（參觀模式的最深一級就是新上里），不靠前面的測試先建。 */
async function createNearVisit(api: AdminApi, child: string): Promise<void> {
  await api.send('POST', `/admin/admissions/records?campus_key=${CAMPUS}`, {
    visit_date: taipeiDate(0),
    child_name: child,
    birthday: `${TERM.schoolYear + 1911 - 3}-03-15`,
    target_school_year: TERM.schoolYear,
    target_semester: TERM.semester,
    address: NEAR_ADDRESS,
  })
}

/** 新上里 2–5 歲人數：人口檔（start-api.sh 匯入的真實 115 年 9 月資料）的 2、3、4、5 歲男女加總。 */
function xinshangChildren(): number {
  const population = JSON.parse(readFileSync(path.join(ROOT, 'tests/stack/fixtures/geo-population-11509.json'), 'utf8')) as {
    responseData: Record<string, string>[]
  }
  const row = population.responseData.find((item) => item.site_id === '高雄市左營區' && item.village === '新上里')!
  return [2, 3, 4, 5].reduce((sum, age) => sum + Number(row[`people_age_00${age}_m`]) + Number(row[`people_age_00${age}_f`]), 0)
}

const statsBlock = (page: Page, title: string) =>
  page.locator('.stats-block', { has: page.getByRole('heading', { name: title, exact: true }) })
/** 「各里」表（完整表格的預設分頁）：標題帶範圍。 */
const villageBlock = (page: Page, km = 3) => statsBlock(page, `各里（本校 ${km} 公里內）`)

// ---- 工具列、分頁、網址 ----

const MODE_GROUP = '.area-toolbar__mode-group'
const RANGE_GROUP = '.area-toolbar__range'
const modeButton = (page: Page, label: string) => page.locator(`${MODE_GROUP} .el-radio-button`, { hasText: label })
const rangeButton = (page: Page, label: string) => page.locator(`${RANGE_GROUP} .el-radio-button`, { hasText: label })
const tableTab = (page: Page, label: string) => page.locator('.area-full-tables').getByRole('tab', { name: new RegExp(`^${label}`) })
const queryParam = (page: Page, name: string) => new URL(page.url()).searchParams.get(name)

/** 工具列「看什麼」：點一個模式，等它變成選取狀態（停用的模式點不到，會在這裡逾時）。 */
async function pickMode(page: Page, label: string): Promise<void> {
  await modeButton(page, label).click()
  await expect(modeButton(page, label)).toHaveClass(/is-active/)
}

/** 工具列「範圍」。 */
async function pickRange(page: Page, label: string): Promise<void> {
  await rangeButton(page, label).click()
  await expect(rangeButton(page, label)).toHaveClass(/is-active/)
}

/** 完整表格換分頁：該頁成為選取、網址的 table 變成 value（預設的「各里」不寫進網址，傳 null）。 */
async function openTableTab(page: Page, label: string, value: string | null): Promise<void> {
  const tab = tableTab(page, label)
  await tab.click()
  await expect(tab).toHaveAttribute('aria-selected', 'true')
  await expect.poll(() => queryParam(page, 'table')).toBe(value)
}

// ---- 地圖上的點擊與位置 ----

/**
 * 在地圖畫面內找一個「點下去真的打到這個圖形」的視窗座標：先把地圖捲進視窗，再在符合 selector 的圖形外框內掃格點，
 * 用 elementFromPoint 確認最上層就是它自己（沒被縮放鈕、移動地圖鈕、別的圖形蓋住）。里的圖形沒有代碼可認，
 * 呼叫端用「參觀模式最深一級」這類 class 指到新上里。
 */
async function pointOn(page: Page, selector: string): Promise<{ x: number; y: number }> {
  await page.locator('.area-map__canvas').scrollIntoViewIfNeeded()
  const point = await page.evaluate((sel) => {
    const canvas = document.querySelector('.area-map__canvas')!.getBoundingClientRect()
    const left = Math.max(canvas.left + 12, 0)
    const right = Math.min(canvas.right - 12, window.innerWidth)
    const top = Math.max(canvas.top + 12, 0)
    const bottom = Math.min(canvas.bottom - 12, window.innerHeight)
    const steps = 30
    for (const element of Array.from(document.querySelectorAll(sel))) {
      const box = element.getBoundingClientRect()
      const l = Math.max(box.left, left)
      const r = Math.min(box.right, right)
      const t = Math.max(box.top, top)
      const b = Math.min(box.bottom, bottom)
      if (r <= l || b <= t) continue
      for (let i = 0; i <= steps; i++) {
        for (let j = 0; j <= steps; j++) {
          const x = l + ((r - l) * i) / steps
          const y = t + ((b - t) * j) / steps
          if (document.elementFromPoint(x, y) === element) return { x, y }
        }
      }
    }
    return null
  }, selector)
  expect(point, `${selector} 在地圖畫面內找不到沒被蓋住的點`).not.toBeNull()
  return point!
}

/** 這個圖形整個在地圖畫布裡（沒有被拖出畫面）。 */
function insideCanvas(page: Page, selector: string): Promise<boolean> {
  return page.evaluate((sel) => {
    const element = document.querySelector(sel)
    if (!element) return false
    const canvas = document.querySelector('.area-map__canvas')!.getBoundingClientRect()
    const box = element.getBoundingClientRect()
    return box.width > 0 && box.height > 0 && box.left >= canvas.left && box.right <= canvas.right && box.top >= canvas.top && box.bottom <= canvas.bottom
  }, selector)
}

/** 掃指定區塊，沒有 serious／critical 的無障礙問題。 */
async function expectNoSeriousA11y(page: Page, ...regions: string[]): Promise<void> {
  let scan = new AxeBuilder({ page })
  for (const region of regions) scan = scan.include(region)
  const results = await scan.withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  const serious = results.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
  expect(serious.map((violation) => `${violation.id}：${violation.nodes.map((node) => node.target.join(' ')).join('；')}`)).toEqual([])
}

test('區域分析：門牌比對到里 → 頁尾與參觀來源三張表 → 地圖著色 → 同業清單 → 查看明細帶區域', async ({ browser }) => {
  test.setTimeout(90_000)
  const api = await adminApi('super_admin')
  for (const [child, address] of [
    [CHILD_NEAR, NEAR_ADDRESS],
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
  const tiles = await blockTiles(page)

  await test.step('頁尾：門牌資料版本與參觀地址摘要；完整表格「參觀來源」三張表', async () => {
    await gotoAdmin(page, areaPath(CAMPUS), '招生統計')
    const footer = page.locator('.area-footer')
    await expect(footer).toContainText('門牌資料')
    await expect(footer).not.toContainText('尚未匯入')
    // 摘要以有地址為母數（R5）：兩筆都填了地址，一筆到里、一筆是非高雄市。
    await expect(footer.locator('.area-footer__summary')).toContainText('參觀有地址 2 筆：到里 1 筆、未定位到里 1 筆（非高雄市 1）')
    await expect(footer.locator('.area-footer__summary')).not.toContainText('沒填地址')
    // 頁首不再有狀態列與摘要（規格 §2.9）。
    await expect(page.locator('.area-status, .area-summary, .area-head')).toHaveCount(0)
    await openTableTab(page, '參觀來源', 'visits')
    await expect(statsBlock(page, '里排行').locator('tbody tr').first()).toContainText('左營區新上里')
    // 臺南那筆沒有行政區：後端若另列一行，和左營區同為 1 人、先後不定，所以不比第一列。
    await expect(statsBlock(page, '行政區排行').locator('tbody')).toContainText('左營區')
    const band = statsBlock(page, '距離分布').locator('tbody tr', { hasText: '1–3 公里' })
    await expect(band.locator('td').first()).toHaveText('1')
  })

  await test.step('地圖：里界載入、底圖圖磚載入；「參觀」模式新上里是最深的一級', async () => {
    await expect(page.locator('.area-map .leaflet-container')).toBeVisible()
    await pickMode(page, '參觀')
    await expect(page.locator('.area-map path.area-village--l5')).toHaveCount(1)
    await expectTilesLoaded(page, tiles)
  })

  await test.step('同業模式的右欄：3 公里內本機構＋三所；範圍 6 公里多一所；停業與外縣市不列', async () => {
    await pickMode(page, '同業')
    const list = page.locator('.area-workbench__side .nearby')
    await expect(list.locator('.nearby__item', { hasText: '常春藤崇德幼兒園' })).toContainText('本機構')
    await expect(list.locator('.nearby__item')).toHaveCount(4)
    await pickRange(page, '6 公里')
    await expect(list.locator('.nearby__item')).toHaveCount(5)
    await expect(list).toContainText('測試丁幼兒園')
    await expect(list).not.toContainText('已停業')
    await expect(list).not.toContainText('測試戊')
  })

  await test.step('里排行「查看明細」→ 訪視明細只列新上里；上一頁回到區域分析，停在「參觀來源」', async () => {
    await statsBlock(page, '里排行').getByRole('button', { name: '查看明細：左營區新上里' }).click()
    await expect(page).toHaveURL(/tab=records/)
    expect(queryParam(page, 'area')).toBe('左營區/新上里')
    await expect(page.getByText('只顯示左營區新上里的訪視。')).toBeVisible()
    await expect(page.locator('.records-table .el-table__row', { hasText: CHILD_NEAR })).toHaveCount(1)
    await expect(page.locator('.records-table .el-table__row', { hasText: CHILD_TAINAN })).toHaveCount(0)
    await page.goBack()
    await expect(page.locator('.stats-subtabs .el-tabs__item.is-active')).toHaveText('區域分析')
    await expect(tableTab(page, '參觀來源')).toHaveAttribute('aria-selected', 'true')
  })

  await Promise.all([context.close(), api.dispose()])
})

test('里界 GeoJSON：官網代理壓成 gzip 後送出，用 ETag 重驗回 304', async ({ browser }) => {
  const { context, page } = await openAs(browser, 'super_admin')
  await blockTiles(page)
  // 新的瀏覽器 context 沒有 HTTP 快取，進區域分析頁一定會抓里界；先掛監聽再開頁。
  const loaded = page.waitForResponse(
    (response) => response.request().method() === 'GET' && new URL(response.url()).pathname.endsWith('/admin/admissions/area/boundaries'),
  )
  await gotoAdmin(page, areaPath(CAMPUS), '招生統計')
  const response = await loaded

  expect(response.status()).toBe(200)
  const headers = response.headers()
  expect(headers['content-encoding']).toBe('gzip')
  expect(headers.vary?.toLowerCase()).toContain('accept-encoding')
  expect(headers['content-type']).toContain('application/geo+json')
  expect(headers['cache-control']).toContain('max-age=86400')
  const etag = headers.etag ?? ''
  expect(etag, '里界回應沒有 ETag').not.toBe('')
  // 瀏覽器解壓後是完整的 GeoJSON。
  const body = (await response.json()) as { type: string; features: unknown[] }
  expect(body.type).toBe('FeatureCollection')
  expect(body.features.length).toBeGreaterThan(0)

  // 帶同一個 ETag 重驗：上游回 304，官網代理原樣交回（帶 ETag、Cache-Control，沒有本文）。
  const revalidated = await page.request.get(response.url(), { headers: { 'If-None-Match': etag } })
  expect(revalidated.status()).toBe(304)
  expect(revalidated.headers().etag).toBe(etag)
  expect(revalidated.headers()['cache-control']).toContain('max-age=86400')
  expect((await revalidated.body()).length).toBe(0)
  await context.close()
})

test('區域分析：本校地址比對不到門牌 → 地圖、幼兒園清單、距離分布都寫原因，不報錯', async ({ browser }) => {
  test.setTimeout(90_000)
  const api = await adminApi('super_admin')
  const original = await campusAddress(api, UNLOCATED_CAMPUS)
  const { context, page } = await openAs(browser, 'super_admin')
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  try {
    // 先在校址還對得到門牌時建一筆訪視（距離是當時算的），再把校址換成查無門牌的地址：
    // 這一校沒有座標時，以前存的距離不能拿來分組（R6），三處都要改寫說明而不是顯示數字或空白。
    await api.send('POST', `/admin/admissions/records?campus_key=${UNLOCATED_CAMPUS}`, {
      visit_date: taipeiDate(0),
      child_name: CHILD_UNLOCATED,
      birthday: `${TERM.schoolYear + 1911 - 3}-03-15`,
      target_school_year: TERM.schoolYear,
      target_semester: TERM.semester,
      address: NEAR_ADDRESS,
    })
    await publishCampusAddress(api, UNLOCATED_CAMPUS, UNLOCATED_ADDRESS)
    const area = await api.get<{ campus: { lat: number | null; lng: number | null; locate_error: string | null } }>(
      `/admin/admissions/area?campus_key=${UNLOCATED_CAMPUS}`,
    )
    expect(area.campus, '校址換掉後這一校應該沒有座標').toMatchObject({ lat: null, lng: null, locate_error: 'no_doorplate' })

    await openArea(page, UNLOCATED_CAMPUS)
    await test.step('地圖：照樣畫出里界，旁邊寫本校位置未標示與原因，先顯示本校所在的區', async () => {
      const note = page.locator('.area-map__campus-note')
      await expect(note).toContainText('本校位置未標示（本校地址比對不到門牌）')
      await expect(note).toContainText('地圖先顯示仁武區')
    })
    await test.step('同業模式的附近幼兒園：寫原因，不列清單', async () => {
      await pickMode(page, '同業')
      await expect(page.locator('.nearby__empty')).toHaveText('本校地址比對不到門牌，無法列出附近幼兒園。')
      await expect(page.locator('.nearby__item')).toHaveCount(0)
    })
    await test.step('頁尾與「參觀來源」：里排行照常，距離分布改寫原因', async () => {
      await expect(page.locator('.area-footer__summary')).toContainText('參觀有地址 1 筆：到里 1 筆')
      await openTableTab(page, '參觀來源', 'visits')
      await expect(statsBlock(page, '里排行').locator('tbody tr').first()).toContainText('左營區新上里')
      await expect(statsBlock(page, '距離分布')).toContainText('本校地址比對不到門牌，無法計算距離。')
    })
    expect(errors, '頁面不該有未處理的錯誤').toEqual([])
  } finally {
    // 不論前面成功與否都還原校址（草稿與已發布都回到原本的地址），不影響後面的 spec。
    try {
      await publishCampusAddress(api, UNLOCATED_CAMPUS, original)
    } finally {
      await Promise.all([context.close(), api.dispose()])
    }
  }
})

// 招生機會（2026-10-13 規格 9）：start-api.sh 匯入 115 年 9 月高雄市各里人口（真實資料）。崇德校附近參觀很少
// （這個 spec 只建了幾筆），所以「招生機會」模式停用並寫「先不判斷」，各里表也不出參觀欄（工作台規格 D15）；
// 表格的 2–5 歲人數要和人口檔一致。
test('招生機會：頁尾人口月份 → 2–5 歲孩子右欄與各里表 → 招生機會停用 → 換範圍 → 地圖依孩子著色', async ({ browser }) => {
  test.setTimeout(90_000)
  mkdirSync(SHOTS, { recursive: true })
  const children = xinshangChildren()
  const api = await adminApi('super_admin')
  await api.send('POST', `/admin/admissions/records?campus_key=${CAMPUS}`, {
    visit_date: taipeiDate(0),
    child_name: '招生機會甲童',
    birthday: `${TERM.schoolYear + 1911 - 3}-05-20`,
    target_school_year: TERM.schoolYear,
    target_semester: TERM.semester,
    address: NEAR_ADDRESS,
  })
  const { context, page } = await openAs(browser, 'super_admin')
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await openArea(page)
  const block = villageBlock(page)
  const pane = page.locator('.area-workbench__side')

  await test.step('頁尾寫人口月份；招生機會模式停用並寫原因（參觀太少先不判斷）', async () => {
    await expect(page.locator('.area-footer__status')).toContainText('各里人口 115 年 9 月')
    await expect(modeButton(page, '招生機會')).toHaveClass(/is-disabled/)
    await expect(page.locator('.area-toolbar__note')).toContainText('附近參觀還不到 10 位，先不判斷哪些里偏少。')
  })

  await test.step('「2–5 歲孩子」右欄：標題與半徑內合計', async () => {
    await pickMode(page, '2–5 歲孩子')
    await expect(pane.locator('.area-pane__title')).toHaveText('2–5 歲孩子')
    await expect(pane.locator('.area-pane__line')).toContainText(/本校 3 公里內 \d+ 個里，2–5 歲孩子 [\d,]+ 位，參觀 \d+ 位/)
  })

  await test.step('各里表：先列 10 個里，「顯示全部」展開；新上里的 2–5 歲人數和人口檔一致；沒到門檻沒有參觀欄；說明寫資料來源', async () => {
    await expect(block.locator('tbody tr')).toHaveCount(10)
    await expect(block.locator('thead')).not.toContainText('判讀')
    await expect(block.locator('thead')).not.toContainText('參觀人數')
    await block.getByRole('button', { name: /^顯示全部 \d+ 列$/ }).click()
    expect(await block.locator('tbody tr').count()).toBeGreaterThan(10)
    const cells = block.locator('tbody tr', { hasText: '左營區新上里' }).locator('th, td')
    // 有長條時寫純數字，退成文字欄時帶千分位。
    await expect(cells.nth(3)).toHaveText(new RegExp(`^(${children}|${children.toLocaleString('zh-TW')})$`))
    // 說明收在「這些數字怎麼算」，預設收起；展開後寫資料來源。
    await block.locator('.stats-block__how summary').click()
    await expect(block.locator('.stats-block__how')).toContainText('資料來源：內政部戶政司')
  })

  await test.step('地圖依 2–5 歲孩子著色：半徑內孩子最多的里是最深一級，圖例有單位', async () => {
    await expect(page.locator('.area-map path.area-village--l5').first()).toBeAttached()
    await expect(page.locator('.area-legend--levels li').first()).toContainText('位')
    await page.locator('.area-workbench').screenshot({ path: path.join(SHOTS, 'area-workbench-children-1440.png') })
    await page.screenshot({ path: path.join(SHOTS, 'area-workbench-children-1440-full.png'), fullPage: true })
  })

  await test.step('範圍換 1 公里：右欄總結與各里表標題跟著換', async () => {
    await pickRange(page, '1 公里')
    await expect(pane.locator('.area-pane__line')).toContainText('本校 1 公里內')
    await expect(villageBlock(page, 1)).toBeVisible()
  })

  expect(errors, '頁面不該有未處理的錯誤').toEqual([])
  await Promise.all([context.close(), api.dispose()])
})

test('390px：看什麼橫向捲動、2–5 歲孩子切換與各里表不撐出頁面', async ({ browser }) => {
  mkdirSync(SHOTS, { recursive: true })
  const { context, page } = await openAs(browser, 'super_admin', PHONE)
  await openArea(page)
  await pickMode(page, '2–5 歲孩子')
  await expect(page.locator('.area-legend--levels')).toBeVisible()
  await expect(villageBlock(page).locator('tbody tr').first()).toBeAttached()
  await expectNoHorizontalOverflow(page)
  await page.screenshot({ path: path.join(SHOTS, 'area-workbench-children-390-full.png'), fullPage: true })
  await context.close()
})

// ---- 地圖工作台（2026-10-16 規格 §1.1、§8.2）----

test('工作台：點地圖上的里 → 右欄里卡片、網址 village=、重新整理還原；外框可見、幼兒園點仍可點', async ({ browser }) => {
  test.setTimeout(120_000)
  mkdirSync(SHOTS, { recursive: true })
  const children = xinshangChildren()
  const api = await adminApi('super_admin')
  await createNearVisit(api, '工作台甲童')
  const { context, page } = await openAs(browser, 'super_admin', DESKTOP)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  // 參觀模式：只有新上里有訪視，最深一級（l5）唯一指到它。
  await openArea(page, CAMPUS, 'map=visits')
  const side = page.locator('.area-workbench__side')
  const card = side.locator('.village-card')
  const title = card.locator('.village-card__title')
  const outline = page.locator('.area-map path.area-village-selected')

  await test.step('沒選里：右欄是參觀排行、沒有外框；右欄沒有 serious／critical 的無障礙問題', async () => {
    await expect(side.locator('.area-pane__title')).toHaveText('參觀')
    await expect(side.locator('.area-ranking__item').first()).toContainText('左營區新上里')
    await expect(card).toHaveCount(0)
    await expect(outline).toHaveCount(0)
    await expectNoSeriousA11y(page, '.area-workbench__side')
  })

  await test.step('點地圖上的新上里：卡片寫里名與數字、網址 village=、沒有 popup、外框畫出來', async () => {
    const spot = await pointOn(page, 'path.area-village--l5')
    await page.mouse.click(spot.x, spot.y)
    await expect(title).toHaveText('左營區新上里')
    await expect.poll(() => queryParam(page, 'village')).toMatch(/^\d{11}$/)
    await expect(page.locator('.leaflet-popup')).toHaveCount(0)
    // 孩子段：2–5 歲和人口檔一致。
    const kids = card.locator('.village-card__row', { hasText: '2–5 歲' }).locator('.village-card__value')
    await expect(kids).toHaveText(`${children.toLocaleString('zh-TW')} 位`)
    // 我們段：有參觀，並給「查看這個里的訪視」。
    await expect(card.locator('.village-card__row', { hasText: '參觀' }).locator('.village-card__value')).toHaveText(/^\d+ 位$/)
    await expect(card.getByRole('button', { name: '查看這個里的訪視' })).toBeVisible()
    // 外框：專用 pane 裡的單一圖形，ink 色 2.5px。
    await expect(outline).toHaveCount(1)
    await expect(outline).toBeVisible()
    await expect(outline).toHaveAttribute('stroke-width', '2.5')
    await page.screenshot({ path: path.join(SHOTS, 'area-workbench-1440-village.png') })
    await expectNoSeriousA11y(page, '.area-workbench__side')
  })

  await test.step('重新整理：網址的里還原，卡片與外框都回來', async () => {
    const code = queryParam(page, 'village')
    await page.reload()
    await expect(page.locator('.area-map path.area-village').first()).toBeAttached()
    await expect(title).toHaveText('左營區新上里')
    await expect(outline).toHaveCount(1)
    expect(queryParam(page, 'village')).toBe(code)
  })

  await test.step('選了里之後幼兒園點照樣點得到：開 popup，卡片與網址不變', async () => {
    const code = queryParam(page, 'village')
    // 本機構的點被本校星號蓋住，挑其他園所的點（elementFromPoint 確認打到的是點本身，不是外框）。
    const dot = await pointOn(page, 'path.area-kg:not(.area-kg--own)')
    await page.mouse.click(dot.x, dot.y)
    await expect(page.locator('.leaflet-popup .area-popup')).toBeVisible()
    await expect(title).toHaveText('左營區新上里')
    expect(queryParam(page, 'village')).toBe(code)
  })

  await test.step('× 關掉卡片：回到排行，外框與網址的里都拿掉', async () => {
    await card.getByRole('button', { name: '關閉里卡片' }).click()
    await expect(card).toHaveCount(0)
    await expect(outline).toHaveCount(0)
    await expect.poll(() => queryParam(page, 'village')).toBeNull()
    await expect(side.locator('.area-ranking__item').first()).toBeVisible()
  })

  await test.step('從排行選里、卡片「查看這個里的訪視」→ 明細只列新上里；上一頁回來卡片還在', async () => {
    await side.locator('.area-ranking__item', { hasText: '左營區新上里' }).click()
    await expect(title).toHaveText('左營區新上里')
    await card.getByRole('button', { name: '查看這個里的訪視' }).click()
    await expect(page).toHaveURL(/tab=records/)
    expect(queryParam(page, 'area')).toBe('左營區/新上里')
    await expect(page.getByText('只顯示左營區新上里的訪視。')).toBeVisible()
    await page.goBack()
    await expect(page.locator('.stats-subtabs .el-tabs__item.is-active')).toHaveText('區域分析')
    await expect(title).toHaveText('左營區新上里')
  })

  expect(errors, '頁面不該有未處理的錯誤').toEqual([])
  await Promise.all([context.close(), api.dispose()])
})

test('工作台：從排行選里地圖 panTo；切表格分頁網址 table=；各里表點里名選取並捲回地圖；換校區清掉 village', async ({ browser }) => {
  test.setTimeout(120_000)
  const api = await adminApi('super_admin')
  await createNearVisit(api, '工作台乙童')
  const { context, page } = await openAs(browser, 'super_admin', DESKTOP)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await openArea(page)
  const side = page.locator('.area-workbench__side')
  const card = side.locator('.village-card')
  const title = card.locator('.village-card__title')
  const canvas = page.locator('.area-map__canvas')

  await test.step('看什麼：點「參觀」→ 網址 map=visits，右欄換成參觀排行', async () => {
    await pickMode(page, '參觀')
    await expect.poll(() => queryParam(page, 'map')).toBe('visits')
    await expect(side.locator('.area-pane__title')).toHaveText('參觀')
  })

  await test.step('把地圖拖開，新上里離開畫面；從排行選它：地圖 panTo 讓它回到畫面內，焦點在卡片標題', async () => {
    await canvas.scrollIntoViewIfNeeded()
    const box = (await canvas.boundingBox())!
    const y = box.y + box.height / 2
    await page.mouse.move(box.x + box.width - 40, y)
    await page.mouse.down()
    await page.mouse.move(box.x + 40, y, { steps: 12 })
    await page.mouse.up()
    await expect.poll(() => insideCanvas(page, 'path.area-village--l5')).toBe(false)
    await side.locator('.area-ranking__item', { hasText: '左營區新上里' }).click()
    await expect(title).toHaveText('左營區新上里')
    await expect(title).toBeFocused()
    await expect.poll(() => insideCanvas(page, 'path.area-village--l5')).toBe(true)
    await expect.poll(() => insideCanvas(page, 'path.area-village-selected')).toBe(true)
    await expect(page.locator('.leaflet-popup')).toHaveCount(0)
  })

  await test.step('完整表格分頁：換頁網址有 table=，預設的「各里」不寫；重新整理停在同一頁', async () => {
    await openTableTab(page, '國小學區', 'school')
    await openTableTab(page, '參觀來源', 'visits')
    await openTableTab(page, '出生走勢', 'births')
    await page.reload()
    await expect(page.locator('.area-map path.area-village').first()).toBeAttached()
    await expect(tableTab(page, '出生走勢')).toHaveAttribute('aria-selected', 'true')
    await openTableTab(page, '各里', null)
  })

  await test.step('各里表點里名：選取那個里，頁面捲回工作台，焦點在卡片標題', async () => {
    await card.getByRole('button', { name: '關閉里卡片' }).click()
    await expect(card).toHaveCount(0)
    const block = villageBlock(page)
    await block.getByRole('button', { name: /^顯示全部 \d+ 列$/ }).click()
    const row = block.getByRole('button', { name: /^在地圖上選取：左營區新上里/ })
    await row.scrollIntoViewIfNeeded()
    const before = await page.evaluate(() => window.scrollY)
    expect(before, '表格在工作台下面，要先捲下去才測得到「捲回」').toBeGreaterThan(200)
    await row.click()
    await expect(title).toHaveText('左營區新上里')
    await expect(title).toBeFocused()
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(before)
    await expect(canvas).toBeInViewport({ ratio: 0.3 })
    await expect.poll(() => queryParam(page, 'village')).toMatch(/^\d{11}$/)
  })

  await test.step('換校區：選取的里清掉（網址 village 拿掉），右欄回到排行', async () => {
    const campusSelect = page.locator('.admissions__filters .el-select', { has: page.getByRole('combobox', { name: '校區' }) })
    await campusSelect.click()
    await page.locator('.el-select-dropdown__item:visible', { hasText: '仁武' }).click()
    await expect.poll(() => queryParam(page, 'campus')).toBe(UNLOCATED_CAMPUS)
    await expect.poll(() => queryParam(page, 'village')).toBeNull()
    await expect(page.locator('.area-map path.area-village').first()).toBeAttached()
    await expect(page.locator('.village-card')).toHaveCount(0)
    await expect(page.locator('.area-map path.area-village-selected')).toHaveCount(0)
    await expect(page.locator('.area-workbench__side .area-pane__title')).toHaveText('參觀')
  })

  expect(errors, '頁面不該有未處理的錯誤').toEqual([])
  await Promise.all([context.close(), api.dispose()])
})

// 區域分析本體（工具列到頁尾）原本在正式站約 5,600px（規格 §1）。這裡用 stack 的種子資料守住回歸：
// 預設狀態（沒選里、各里表 10 列、「這些數字怎麼算」都收著）不超過 1,800px。超過時先把表格下方的 hint 收進
// 「這些數字怎麼算」，再把各里預設列數降到 8（D19）。
test('頁長：1440×900 預設狀態 .area 高度 ≤ 1,800px（D19）', async ({ browser }) => {
  const { context, page } = await openAs(browser, 'super_admin', DESKTOP)
  await openArea(page)
  await expect(villageBlock(page).locator('tbody tr')).toHaveCount(10)
  await expect(page.locator('.village-card')).toHaveCount(0)
  await expect(page.locator('.area details[open]')).toHaveCount(0)
  await expect(page.locator('.area-footer')).toBeVisible()
  const height = await page.locator('.area').evaluate((element) => Math.round(element.getBoundingClientRect().height))
  expect(height, `.area 高 ${height}px，超過 1,800px`).toBeLessThanOrEqual(1800)
  await context.close()
})

test('390px：選里後卡片在地圖下方並捲到標題、移動地圖照舊、頁面不橫向溢出', async ({ browser }) => {
  test.setTimeout(90_000)
  mkdirSync(SHOTS, { recursive: true })
  const api = await adminApi('super_admin')
  await createNearVisit(api, '工作台丙童')
  const { context, page } = await openAs(browser, 'super_admin', PHONE)
  await openArea(page, CAMPUS, 'map=visits')
  const card = page.locator('.area-workbench__side .village-card')
  const title = card.locator('.village-card__title')

  await test.step('看什麼一列可橫向捲動，範圍換到下一行', async () => {
    const modes = page.locator('.area-toolbar__modes')
    expect(await modes.evaluate((element) => element.scrollWidth > element.clientWidth), '看什麼這一列應該可以橫捲').toBe(true)
    const [modesBox, rangeBox] = [await modes.boundingBox(), await page.locator(RANGE_GROUP).boundingBox()]
    expect(rangeBox!.y).toBeGreaterThanOrEqual(modesBox!.y + modesBox!.height - 1)
  })

  await test.step('點地圖上的新上里：卡片在地圖正下方，頁面捲到卡片標題，不開彈窗', async () => {
    const spot = await pointOn(page, 'path.area-village--l5')
    await page.touchscreen.tap(spot.x, spot.y)
    await expect(title).toHaveText('左營區新上里')
    await expect(page.locator('.leaflet-popup')).toHaveCount(0)
    const below = await page.evaluate(() => {
      const canvasBox = document.querySelector('.area-map__canvas')!.getBoundingClientRect()
      const cardBox = document.querySelector('.village-card')!.getBoundingClientRect()
      return cardBox.top >= canvasBox.bottom - 1
    })
    expect(below, '卡片應該接在地圖下方').toBe(true)
    // 標題捲到視窗上緣附近（後台頂端列之下），不是留在畫面外。
    await expect
      .poll(async () => {
        const box = await title.boundingBox()
        return box !== null && box.y >= 0 && box.y < 300
      })
      .toBe(true)
    await expectNoHorizontalOverflow(page)
    await page.screenshot({ path: path.join(SHOTS, 'area-workbench-390-village.png') })
  })

  await test.step('移動地圖照舊：預設不攔單指，按下才接手，完成後還給頁面捲動', async () => {
    const leafletMap = page.locator('.area-map .leaflet-container')
    await expect(leafletMap).toHaveCSS('touch-action', 'auto')
    await page.getByRole('button', { name: '移動地圖', exact: true }).click()
    await expect(leafletMap).toHaveCSS('touch-action', 'none')
    await page.getByRole('button', { name: '完成移動地圖', exact: true }).click()
    await expect(leafletMap).toHaveCSS('touch-action', 'auto')
  })

  await test.step('關掉卡片：回到排行', async () => {
    await card.getByRole('button', { name: '關閉里卡片' }).click()
    await expect(card).toHaveCount(0)
    await expect(page.locator('.area-workbench__side .area-ranking__item').first()).toBeVisible()
    await expectNoHorizontalOverflow(page)
  })

  await Promise.all([context.close(), api.dispose()])
})

for (const { name, device } of VIEWPORTS) {
  test(`${name}px：區域分析截圖，頁面不橫向溢出`, async ({ browser }) => {
    mkdirSync(SHOTS, { recursive: true })
    const { context, page } = await openAs(browser, 'super_admin', device)
    await openArea(page)
    // 各里表也畫出來了（崇德校 3 公里內有里）。
    await expect(villageBlock(page).locator('tbody tr').first()).toBeAttached()
    await test.step('不橫向溢出', () => expectNoHorizontalOverflow(page))
    await page.screenshot({ path: path.join(SHOTS, `area-workbench-${name}.png`) })
    await page.screenshot({ path: path.join(SHOTS, `area-workbench-${name}-full.png`), fullPage: true })
    await context.close()
  })
}

// 托嬰中心與園所變化（2026-10-14 規格 7）：start-api.sh 匯入 stack 專用的托嬰樣本（崇德校 3 公里內 3 所、
// 3–6 公里 1 所）。同步只會建立基準、不會有異動，所以空狀態先看，再用 db.ts 寫入異動看有內容的畫面。
// 工作台後它們都在「同業」模式的右欄，範圍（公里）改由工具列決定。
test('托嬰中心與園所變化：切換名單、地圖圖層、變化區塊', async ({ browser }) => {
  test.setTimeout(90_000)
  mkdirSync(SHOTS, { recursive: true })
  const { context, page } = await openAs(browser, 'super_admin')
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await openArea(page, CAMPUS, 'map=peers')
  const changes = page.locator('.changes')

  await test.step('預設是幼兒園清單，托嬰圖層沒有打開；變化區塊是空的並說明從哪天起記錄', async () => {
    await expect(page.locator('.nearby .nearby__title')).toHaveText('附近幼兒園')
    await expect(page.locator('.nearby--babycare')).toHaveCount(0)
    await expect(page.locator('.area-map .area-bc')).toHaveCount(0)
    await expect(changes.locator('.changes__title')).toHaveText('附近園所的變化')
    await expect(changes.locator('.changes__empty')).toHaveText('近 12 個月，3 公里內沒有新設、停辦或類型變動的園所。')
    await expect(changes.locator('.changes__note')).toHaveText(/^幼兒園的類型變動與托嬰從 \d+ 月 \d+ 日起記錄。$/)
  })

  await test.step('切到托嬰中心：3 公里內 3 所、總結、地圖自動出現菱形標點', async () => {
    await page.locator('.nearby-panel .el-radio-button', { hasText: '托嬰中心' }).click()
    const list = page.locator('.nearby--babycare')
    await expect(list.locator('.nearby__title')).toHaveText('附近托嬰中心')
    await expect(list.locator('.nearby__item')).toHaveCount(3)
    await expect(list.locator('.nearby__summary')).toHaveText('3 公里內托嬰中心 3 所，核定 82 位，實際收托 56 位。')
    await expect(list).toContainText('托育家園')
    await expect(list).not.toContainText('已停業')
    await expect(list).not.toContainText('測試丁')
    await expect(page.locator('.area-map .area-bc')).toHaveCount(3)
    await expect(page.locator('.area-legend[aria-label="托嬰中心圖例"]')).toContainText('托嬰中心與托育家園')
  })

  await test.step('範圍換 6 公里多一所；點一列展開地址與電話並打開地圖資訊', async () => {
    const list = page.locator('.nearby--babycare')
    await pickRange(page, '6 公里')
    await expect(list.locator('.nearby__item')).toHaveCount(4)
    await expect(list.locator('.nearby__summary')).toContainText('6 公里內托嬰中心 4 所')
    await list.locator('.nearby__row').first().click()
    await expect(list.locator('.nearby__detail')).toContainText('高雄市左營區測試路1號')
    await expect(list.locator('.nearby__detail')).toContainText('07-1111111')
    await expect(page.locator('.leaflet-popup')).toContainText('測試甲托嬰中心')
  })

  await test.step('勾掉地圖上的托嬰圖層，標點消失；切回幼兒園清單', async () => {
    await page.locator('.el-switch', { hasText: '托嬰中心' }).click()
    await expect(page.locator('.area-map .area-bc')).toHaveCount(0)
    await page.locator('.nearby-panel .el-radio-button', { hasText: '幼兒園' }).click()
    await expect(page.locator('.nearby .nearby__title')).toHaveText('附近幼兒園')
    await expect(page.locator('.nearby--babycare')).toHaveCount(0)
  })

  seedProviderChanges()
  await test.step('寫入異動後重新整理（網址的 map=peers 還在、範圍回 3 公里）：停辦的托嬰與設立日在 40 天前的幼兒園，新到舊', async () => {
    await page.reload()
    await expect(page.locator('.area-map .leaflet-container')).toBeVisible()
    const rows = page.locator('.changes .changes__item')
    await expect(rows).toHaveCount(2)
    await expect(rows.nth(0)).toContainText('停辦')
    await expect(rows.nth(0)).toContainText('托嬰')
    await expect(rows.nth(0)).toContainText('測試已停辦托嬰中心')
    await expect(rows.nth(0)).toContainText('起不在名單')
    await expect(rows.nth(1)).toContainText('新設')
    await expect(rows.nth(1)).toContainText('幼兒園')
    await expect(rows.nth(1)).toContainText('測試乙幼兒園')
    await expect(rows.nth(1)).toContainText('設立日')
    await expect(page.locator('.changes .changes__empty')).toHaveCount(0)
  })

  await test.step('同業模式的右欄沒有 serious／critical 的無障礙問題', async () => {
    await expectNoSeriousA11y(page, '.area-workbench__side')
  })

  await page.screenshot({ path: path.join(SHOTS, 'area-workbench-peers-1440-full.png'), fullPage: true })
  expect(errors, '頁面不該有未處理的錯誤').toEqual([])
  await context.close()
})

test('390px：托嬰中心清單與園所變化不撐出頁面', async ({ browser }) => {
  mkdirSync(SHOTS, { recursive: true })
  const { context, page } = await openAs(browser, 'super_admin', PHONE)
  await openArea(page, CAMPUS, 'map=peers')
  await page.locator('.nearby-panel .el-radio-button', { hasText: '托嬰中心' }).click()
  await expect(page.locator('.nearby--babycare .nearby__item').first()).toBeAttached()
  await expect(page.locator('.changes')).toBeVisible()
  await expectNoHorizontalOverflow(page)
  await page.screenshot({ path: path.join(SHOTS, 'area-workbench-peers-390-full.png'), fullPage: true })
  await context.close()
})

test('近幾年的出生數：6 期、缺月註明、增減只比兩期都有的月份', async ({ browser }) => {
  test.setTimeout(90_000)
  mkdirSync(SHOTS, { recursive: true })
  seedBirthSeries()
  const { context, page } = await openAs(browser, 'super_admin')
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await openArea(page, CAMPUS, 'table=births')

  const series = page.locator('.birth-series')
  await test.step('標題與 6 期（最新在前）', async () => {
    await expect(series.locator('.birth-series__title')).toHaveText('近幾年的出生數（本校 3 公里內）')
    const rows = series.locator('.birth-series__row:not(.birth-series__row--head)')
    await expect(rows).toHaveCount(6)
    await expect(rows.nth(0).locator('.birth-series__label')).toHaveText('114 年 10 月～115 年 9 月')
    await expect(rows.nth(5).locator('.birth-series__label')).toHaveText('109 年 10 月～110 年 9 月')
  })

  await test.step('111-03 缺月：那一期寫「缺 111 年 3 月」，增減只比兩期都有的月份', async () => {
    const rows = series.locator('.birth-series__row:not(.birth-series__row--head)')
    await expect(rows.nth(4).locator('.birth-series__label')).toHaveText('110 年 10 月～111 年 9 月')
    await expect(rows.nth(4).locator('.birth-series__missing')).toHaveText('缺 111 年 3 月')
    // 每個里每月出生數 2、2、3、3、4、4：0%、−33.3%、0%、−25.0%（缺月那一年比 11 個月）、0%、最舊一期沒有前一期。
    await expect(rows.locator('.birth-series__change')).toHaveText(['0.0%', '−33.3%', '0.0%', '−25.0%', '0.0%', '—'])
  })

  await test.step('位置：在「完整表格」的「出生走勢」分頁，一次只畫這一頁（不再夾在里表裡）', async () => {
    await expect(tableTab(page, '出生走勢')).toHaveAttribute('aria-selected', 'true')
    expect(queryParam(page, 'table')).toBe('births')
    await expect(page.locator('.area-full-tables .birth-series')).toHaveCount(1)
    await expect(page.locator('.village-table')).toHaveCount(0)
  })

  await test.step('新區塊沒有 serious／critical 的無障礙問題', async () => {
    await expectNoSeriousA11y(page, '.birth-series')
  })

  await expectNoHorizontalOverflow(page)
  await series.scrollIntoViewIfNeeded()
  await page.screenshot({ path: path.join(SHOTS, 'area-workbench-births-1440-full.png'), fullPage: true })
  expect(errors, '頁面不該有未處理的錯誤').toEqual([])
  await context.close()
})

test('390px：近幾年的出生數不撐出頁面', async ({ browser }) => {
  mkdirSync(SHOTS, { recursive: true })
  seedBirthSeries()
  const { context, page } = await openAs(browser, 'super_admin', PHONE)
  await openArea(page, CAMPUS, 'table=births')
  await expect(page.locator('.birth-series')).toBeVisible()
  await expect(page.locator('.birth-series__row:not(.birth-series__row--head)')).toHaveCount(6)
  await expectNoHorizontalOverflow(page)
  await page.screenshot({ path: path.join(SHOTS, 'area-workbench-births-390-full.png'), fullPage: true })
  await context.close()
})

test('在籍學生：預設模式畫出學生點 → 右欄班別篩選點跟著變 → 表格數字；沒匯入的校按鈕停用', async ({ browser }) => {
  test.setTimeout(90_000)
  mkdirSync(SHOTS, { recursive: true })
  const api = await adminApi('super_admin')
  const area = await api.get<{ campus: { lat: number; lng: number } }>(`/admin/admissions/area?campus_key=${CAMPUS}`)
  const { lat, lng } = area.campus
  seedEnrolled(CAMPUS, [
    [lat + 0.001, lng, '小班', '左營區', '新上里'],
    [lat + 0.001, lng, '中班', '左營區', '新上里'],
    [lat - 0.004, lng + 0.002, '大班', '左營區', '新上里'],
  ], 1)
  const { context, page } = await openAs(browser, 'super_admin')
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await openArea(page)
  const side = page.locator('.area-workbench__side')

  await test.step('匯入清冊的校預設就是在籍學生：兩個點（一個兩位、畫大一級），圖例寫地圖上 3 位、沒有點 1 位，右欄總結寫距離分布', async () => {
    await expect(modeButton(page, '在籍學生')).toHaveClass(/is-active/)
    await expect(page.locator('.area-map path.area-enrolled')).toHaveCount(2)
    await expect(page.locator('.area-map path.area-enrolled--multi')).toHaveCount(1)
    const legend = page.locator('.area-legend--enrolled')
    await expect(legend).toContainText('清冊 2026/10/15・115 學年班別・門牌 115 年 10 月版・地圖上 3 位')
    await expect(legend).toContainText('沒有點 1 位（只對到里 1）')
    await expect(side.locator('.area-pane__title')).toHaveText('在籍學生')
    await expect(side.locator('.area-pane__line')).toContainText('4 位，3 位（75%）住 1 公里內、3 位（75%）住 3 公里內。')
    await page.locator('.area-workbench').screenshot({ path: path.join(SHOTS, 'area-workbench-enrolled-1440.png') })
  })

  await test.step('右欄篩大班：只剩一個點、排行一列；「在籍學生」分頁的里排行跟著換', async () => {
    await page.locator('.area-grade .el-radio-button', { hasText: '大班' }).click()
    await expect(page.locator('.area-map path.area-enrolled')).toHaveCount(1)
    await expect(side.locator('.area-ranking__item')).toHaveCount(1)
    await openTableTab(page, '在籍學生', 'enrolled')
    await expect(statsBlock(page, '在籍學生里排行（大班）').locator('tbody tr')).toHaveCount(1)
  })

  await test.step('距離分布：1 公里內 3 位、無距離 1 位', async () => {
    const rows = statsBlock(page, '在籍學生距離分布').locator('tbody tr')
    await expect(rows.first().locator('th, td').last()).toHaveText('3')
    await expect(rows.last().locator('th, td').first()).toHaveText('無距離')
    await expect(rows.last().locator('th, td').last()).toHaveText('1')
  })

  await test.step('在籍學生的右欄、圖例與表格沒有 serious／critical 的無障礙問題', async () => {
    await expectNoSeriousA11y(page, '.area-workbench__side', '.area-legend--enrolled', '.enrolled-panel')
  })

  await test.step('沒匯入的校：在籍學生按鈕停用並寫原因', async () => {
    await openArea(page, UNLOCATED_CAMPUS)
    await expect(page.locator(`${MODE_GROUP} .el-radio-button.is-disabled`, { hasText: '在籍學生' })).toHaveCount(1)
    await expect(page.locator('.area-toolbar__note')).toContainText('尚未匯入在籍名冊。')
  })

  expect(errors, '頁面不該有未處理的錯誤').toEqual([])
  await Promise.all([context.close(), api.dispose()])
})

test('390px：在籍學生的右欄班別篩選換行，不撐出頁面', async ({ browser }) => {
  mkdirSync(SHOTS, { recursive: true })
  const api = await adminApi('super_admin')
  const area = await api.get<{ campus: { lat: number; lng: number } }>(`/admin/admissions/area?campus_key=${CAMPUS}`)
  seedEnrolled(CAMPUS, [[area.campus.lat + 0.001, area.campus.lng, '小班', '左營區', '新上里']], 0)
  const { context, page } = await openAs(browser, 'super_admin', PHONE)
  await openArea(page)
  await expect(modeButton(page, '在籍學生')).toHaveClass(/is-active/)
  await expect(page.locator('.area-grade .el-radio-button').first()).toBeVisible()
  await expectNoHorizontalOverflow(page)
  await page.screenshot({ path: path.join(SHOTS, 'area-workbench-enrolled-390-full.png'), fullPage: true })
  await Promise.all([context.close(), api.dispose()])
})

test('390px：地圖手機預設不攔單指，按「移動地圖」才接手，按「完成移動地圖」還給頁面捲動', async ({ browser }) => {
  const { context, page } = await openAs(browser, 'super_admin', PHONE)
  await openArea(page)
  const leafletMap = page.locator('.area-map .leaflet-container')
  // 地圖沒有拖曳／縮放手勢時 touch-action 維持 auto，整頁捲得動。
  await expect(leafletMap).toHaveCSS('touch-action', 'auto')
  // exact：開啟後鈕名變成「完成移動地圖」，不加 exact 的「移動地圖」會同時對到兩種狀態。
  await page.getByRole('button', { name: '移動地圖', exact: true }).click()
  await expect(leafletMap).toHaveCSS('touch-action', 'none')
  await page.getByRole('button', { name: '完成移動地圖', exact: true }).click()
  await expect(leafletMap).toHaveCSS('touch-action', 'auto')
  await expect(page.getByRole('button', { name: '移動地圖', exact: true })).toBeVisible()
  await context.close()
})

// 種子會多三所幼兒園且不清掉：這兩則必須留在檔尾。
// 工作台後：公告收費的全部內容在「同業收費」分頁，清單在「同業」模式的右欄（年齡兩邊共用）。
test('附近同業收費：總結、落點條、切換年齡、清單收費、托嬰月費', async ({ browser }) => {
  test.setTimeout(90_000)
  mkdirSync(SHOTS, { recursive: true })
  seedPeerFees()
  const { context, page } = await openAs(browser, 'super_admin')
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await openArea(page, CAMPUS, 'map=peers&table=fees')
  const panel = page.locator('.peer-fees')
  const side = page.locator('.area-workbench__side')

  await test.step('預設 3 歲：學年、總結、落點條四點、兩張表；右欄標題區寫同一句總結', async () => {
    const summary = '3 公里內私立幼兒園（不含準公共）有 3 所公布收費，3 歲班一學期中位數 80,000 元；本校 89,750 元，第 2 高。'
    await expect(panel.locator('.peer-fees__title')).toHaveText('附近同業收費')
    await expect(panel.locator('.peer-fees__subtitle')).toContainText('114 學年・全日班・一學期公告收費')
    await expect(panel.locator('.peer-fees__summary')).toHaveText(summary)
    await expect(side.locator('.area-pane__line')).toHaveText(summary)
    await expect(panel.locator('.peer-strip__dot')).toHaveCount(4)
    await expect(panel.locator('table.peer-table')).toHaveCount(2)
    await expect(panel).toContainText('不是家長實付')
  })

  await test.step('附近幼兒園清單列上有 3 歲學期收費', async () => {
    await expect(page.locator('.nearby .nearby__item', { hasText: '常春藤崇德幼兒園' }).locator('.nearby__meta')).toContainText('3 歲學期 89,750')
    await expect(page.locator('.nearby .nearby__item', { hasText: '測試丙' }).locator('.nearby__meta')).toContainText('未公布收費')
  })

  await test.step('切到 4 歲：總結與清單一起變', async () => {
    await panel.locator('.el-radio-button', { hasText: '4 歲' }).click()
    await expect(panel.locator('.peer-fees__summary')).toHaveText(
      '3 公里內私立幼兒園（不含準公共）有 3 所公布收費，4 歲班一學期中位數 65,000 元；本校 85,000 元，第 1 高。',
    )
    await expect(page.locator('.nearby .nearby__item', { hasText: '常春藤崇德幼兒園' }).locator('.nearby__meta')).toContainText('4 歲學期 85,000')
  })

  await test.step('托嬰：月費、標籤與月費對照', async () => {
    await page.locator('.nearby-panel .el-radio-button', { hasText: '托嬰中心' }).click()
    const list = page.locator('.nearby--babycare')
    await expect(list.locator('.nearby__fees')).toHaveText('日間托育月費中位數 17,900 元（15,000–21,000）；本校 2 歲班月均 19,264 元。')
    await expect(list.locator('.nearby__item', { hasText: '測試甲托嬰中心' })).toContainText('評鑑 優等')
  })

  await test.step('新區塊沒有 serious／critical 的無障礙問題', async () => {
    await expectNoSeriousA11y(page, '.peer-fees', '.area-workbench__side')
  })

  await page.screenshot({ path: path.join(SHOTS, 'area-workbench-peer-fees-1440-full.png'), fullPage: true })
  expect(errors, '頁面不該有未處理的錯誤').toEqual([])
  await context.close()
})

test('390px：附近同業收費不撐出頁面', async ({ browser }) => {
  mkdirSync(SHOTS, { recursive: true })
  seedPeerFees()
  const { context, page } = await openAs(browser, 'super_admin', PHONE)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await openArea(page, CAMPUS, 'table=fees')
  await page.locator('.peer-fees').scrollIntoViewIfNeeded()
  await expect(page.locator('.peer-fees__summary')).toBeVisible()
  await expectNoHorizontalOverflow(page)
  await page.screenshot({ path: path.join(SHOTS, 'area-workbench-peer-fees-390-full.png'), fullPage: true })
  expect(errors, '頁面不該有未處理的錯誤').toEqual([])
  await context.close()
})
