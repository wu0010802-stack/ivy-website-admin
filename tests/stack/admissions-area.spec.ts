import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { currentTerm } from '../../admin/src/admissions/academic'
import { adminApi, taipeiDate, type AdminApi } from './api'
import { expectNoHorizontalOverflow, gotoAdmin, openAs } from './pages'
import { ROOT } from './stack-env'

// 招生區域分析（2026-10-08 規格 14.4）：start-api.sh 用 tests/stack/fixtures/geo-* 匯入門牌與幼兒園樣本
// （不連外）。在崇德校建兩筆訪視——admissions-flow.spec 的統計斷言只看義華，不互相影響：
// 一筆左營區新上里（距崇德約 1.2 公里）、一筆臺南地址（非高雄市）。地圖底圖圖磚一律攔下回透明圖，
// 並確認它真的被請求、被 Leaflet 載入（blockTiles／expectTilesLoaded）。
// 其餘：里界 GeoJSON 經官網代理壓成 gzip（2026-10-12）、390px 地圖「移動地圖」手勢、
// 本校地址比對不到門牌（仁武校暫時改地址，結束還原）、1440／390 截圖（output/playwright/，給人看，
// 不比對像素）與「頁面不橫向溢出」。

const CAMPUS = 'chongde'
// 本校位置未定位的測試對象：admissions-flow 等其他 spec 都不碰仁武校。
const UNLOCATED_CAMPUS = 'renwu'
const UNLOCATED_ADDRESS = '高雄市仁武區測試路1號'
const TERM = currentTerm(taipeiDate(0))
const CHILD_NEAR = '區域分析甲童'
const CHILD_TAINAN = '區域分析乙童'
const CHILD_UNLOCATED = '區域分析丙童'
const SHOTS = path.join(ROOT, 'output/playwright')
const TRANSPARENT_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
)
const TILE_URL = /^https:\/\/wmts\.nlsc\.gov\.tw\/wmts\/EMAP\/default\/GoogleMapsCompatible\/\d+\/\d+\/\d+$/
const areaPath = (campus: string) => `/admissions?campus=${campus}&tab=stats&sub=area`

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

/** 打開某校的區域分析，等到地圖畫好（里界、圖磚都在）、骨架消失、沒有地圖錯誤提示。 */
async function openArea(page: Page, campus: string = CAMPUS): Promise<void> {
  const tiles = await blockTiles(page)
  await gotoAdmin(page, areaPath(campus), '招生入學')
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
  const tiles = await blockTiles(page)

  await test.step('統計分析 → 區域分析：狀態列與三張表', async () => {
    await gotoAdmin(page, areaPath(CAMPUS), '招生入學')
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

  await test.step('地圖：里界載入、底圖圖磚載入，新上里是最深的一級', async () => {
    await expect(page.locator('.area-map .leaflet-container')).toBeVisible()
    await expect(page.locator('.area-map path.area-village--l5')).toHaveCount(1)
    await expectTilesLoaded(page, tiles)
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

test('里界 GeoJSON：官網代理壓成 gzip 後送出，用 ETag 重驗回 304', async ({ browser }) => {
  const { context, page } = await openAs(browser, 'super_admin')
  await blockTiles(page)
  // 新的瀏覽器 context 沒有 HTTP 快取，進區域分析頁一定會抓里界；先掛監聽再開頁。
  const loaded = page.waitForResponse(
    (response) => response.request().method() === 'GET' && new URL(response.url()).pathname.endsWith('/admin/admissions/area/boundaries'),
  )
  await gotoAdmin(page, areaPath(CAMPUS), '招生入學')
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
      address: '813高雄市左營區明華一路175號3樓',
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
    await test.step('附近幼兒園：寫原因，不列清單', async () => {
      await expect(page.locator('.nearby__empty')).toHaveText('本校地址比對不到門牌，無法列出附近幼兒園。')
      await expect(page.locator('.nearby__item')).toHaveCount(0)
    })
    await test.step('三張表：里排行照常，距離分布改寫原因', async () => {
      await expect(page.locator('.area-summary')).toContainText('有地址 1 筆：到里 1 筆')
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

const DESKTOP = { viewport: { width: 1440, height: 900 } }
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }
const VIEWPORTS = [
  { name: '1440', device: DESKTOP },
  { name: '390', device: PHONE },
]

for (const { name, device } of VIEWPORTS) {
  test(`${name}px：區域分析截圖，頁面不橫向溢出`, async ({ browser }) => {
    mkdirSync(SHOTS, { recursive: true })
    const { context, page } = await openAs(browser, 'super_admin', device)
    await openArea(page)
    // 幼兒園清單也讀完了（崇德校 3 公里內至少有本機構）。
    await expect(page.locator('.nearby__item').first()).toBeAttached()
    await test.step('不橫向溢出', () => expectNoHorizontalOverflow(page))
    await page.screenshot({ path: path.join(SHOTS, `admissions-area-${name}.png`), fullPage: true })
    await context.close()
  })
}

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
