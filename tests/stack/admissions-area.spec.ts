import { mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { currentTerm } from '../../admin/src/admissions/academic'
import { adminApi, taipeiDate, type AdminApi } from './api'
import { seedBirthSeries, seedProviderChanges } from './db'
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

// 招生機會（2026-10-13 規格 9）：start-api.sh 匯入 115 年 9 月高雄市各里人口（真實資料）。崇德校附近參觀很少
// （這個 spec 只建了幾筆），所以總結寫「先不判斷」；表格的 2–5 歲人數要和人口檔一致。
test('招生機會：狀態列人口月份 → 總結與各里排行 → 換半徑 → 地圖改依孩子／招生機會著色', async ({ browser }) => {
  test.setTimeout(90_000)
  mkdirSync(SHOTS, { recursive: true })
  const population = JSON.parse(readFileSync(path.join(ROOT, 'tests/stack/fixtures/geo-population-11509.json'), 'utf8')) as {
    responseData: Record<string, string>[]
  }
  const xinshang = population.responseData.find((row) => row.site_id === '高雄市左營區' && row.village === '新上里')!
  const children = [2, 3, 4, 5].reduce((sum, age) => sum + Number(xinshang[`people_age_00${age}_m`]) + Number(xinshang[`people_age_00${age}_f`]), 0)
  const api = await adminApi('super_admin')
  await api.send('POST', `/admin/admissions/records?campus_key=${CAMPUS}`, {
    visit_date: taipeiDate(0),
    child_name: '招生機會甲童',
    birthday: `${TERM.schoolYear + 1911 - 3}-05-20`,
    target_school_year: TERM.schoolYear,
    target_semester: TERM.semester,
    address: '813高雄市左營區明華一路175號3樓',
  })
  const { context, page } = await openAs(browser, 'super_admin')
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await openArea(page)
  const block = statsBlock(page, '招生機會（本校 3 公里內）')

  await test.step('狀態列寫人口月份；總結寫半徑內合計，參觀太少先不判斷', async () => {
    await expect(page.locator('.area-status')).toContainText('各里人口 115 年 9 月')
    const summary = block.locator('.opportunity-summary')
    await expect(summary).toContainText(/本校 3 公里內 \d+ 個里，2–5 歲孩子 [\d,]+ 位，參觀 \d+ 位/)
    await expect(summary).toContainText('附近參觀還不到 10 位，先不判斷哪些里偏少。')
  })

  await test.step('各里排行：先列 10 個里，「顯示全部」展開；新上里的 2–5 歲人數和人口檔一致、有參觀；說明寫資料來源', async () => {
    await expect(block.locator('tbody tr')).toHaveCount(10)
    await block.getByRole('button', { name: /^顯示全部 \d+ 列$/ }).click()
    expect(await block.locator('tbody tr').count()).toBeGreaterThan(10)
    const cells = block.locator('tbody tr', { hasText: '左營區新上里' }).locator('th, td')
    await expect(cells.nth(3)).toHaveText(String(children))
    expect(Number(await cells.nth(5).textContent())).toBeGreaterThanOrEqual(1)
    await expect(cells.nth(8)).toHaveText('還不判斷')
    await expect(block.locator('.stats-block__caption')).toContainText('資料來源：內政部戶政司')
  })

  await test.step('地圖改依 2–5 歲孩子著色：半徑內孩子最多的里是最深一級；招生機會模式有圖例', async () => {
    const modes = page.locator('.area-map__modes')
    await modes.locator('.el-radio-button', { hasText: '2–5 歲孩子' }).click()
    await expect(page.locator('.area-map path.area-village--l5').first()).toBeAttached()
    await expect(page.locator('.area-legend--levels li').first()).toContainText('位')
    await page.locator('.area-top').screenshot({ path: path.join(SHOTS, 'admissions-opportunity-children-1440.png') })
    await modes.locator('.el-radio-button', { hasText: '招生機會' }).click()
    await expect(page.locator('.area-legend--signals')).toBeVisible()
    await page.screenshot({ path: path.join(SHOTS, 'admissions-opportunity-1440.png'), fullPage: true })
  })

  await test.step('換 1 公里：標題、總結與地圖範圍跟著換', async () => {
    await page.locator('.nearby .el-radio-button', { hasText: '1 公里' }).click()
    const near = statsBlock(page, '招生機會（本校 1 公里內）')
    await expect(near.locator('.opportunity-summary')).toContainText('本校 1 公里內')
  })

  expect(errors, '頁面不該有未處理的錯誤').toEqual([])
  await Promise.all([context.close(), api.dispose()])
})

test('390px：招生機會切換與表格不撐出頁面', async ({ browser }) => {
  mkdirSync(SHOTS, { recursive: true })
  const { context, page } = await openAs(browser, 'super_admin', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  await openArea(page)
  await page.locator('.area-map__modes .el-radio-button', { hasText: '招生機會' }).click()
  await expect(page.locator('.area-legend--signals')).toBeVisible()
  await expect(statsBlock(page, '招生機會（本校 3 公里內）').locator('tbody tr').first()).toBeAttached()
  await expectNoHorizontalOverflow(page)
  await page.screenshot({ path: path.join(SHOTS, 'admissions-opportunity-390.png'), fullPage: true })
  await context.close()
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

// 托嬰中心與園所變化（2026-10-14 規格 7）：start-api.sh 匯入 stack 專用的托嬰樣本（崇德校 3 公里內 3 所、
// 3–6 公里 1 所）。同步只會建立基準、不會有異動，所以空狀態先看，再用 db.ts 寫入異動看有內容的畫面。
test('托嬰中心與園所變化：切換名單、地圖圖層、變化區塊', async ({ browser }) => {
  test.setTimeout(90_000)
  mkdirSync(SHOTS, { recursive: true })
  const { context, page } = await openAs(browser, 'super_admin')
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await openArea(page)
  const changes = page.locator('.changes')

  await test.step('預設是幼兒園清單，托嬰圖層沒有打開；變化區塊是空的並說明從哪天起記錄', async () => {
    await expect(page.locator('.nearby .nearby__title')).toHaveText('附近幼兒園')
    await expect(page.locator('.nearby--babycare')).toHaveCount(0)
    await expect(page.locator('.area-map .area-bc')).toHaveCount(0)
    await expect(changes.locator('.changes__title')).toHaveText('附近園所的變化')
    await expect(changes.locator('.changes__empty')).toHaveText('近 12 個月，3 公里內沒有新設、停辦或類型變動的園所。')
    await expect(changes.locator('.changes__note')).toHaveText(/^停辦與類型變動從 \d+ 月 \d+ 日起記錄；新設以設立日為準（托嬰從 \d+ 月 \d+ 日起記錄）。$/)
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

  await test.step('換 6 公里多一所；點一列展開地址與電話並打開地圖資訊', async () => {
    const list = page.locator('.nearby--babycare')
    await list.locator('.el-radio-button', { hasText: '6 公里' }).click()
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
  await test.step('寫入異動後重新整理：停辦的托嬰與設立日在 40 天前的幼兒園，新到舊', async () => {
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

  await test.step('新區塊沒有 serious／critical 的無障礙問題', async () => {
    const results = await new AxeBuilder({ page }).include('.area-top__side').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
    const serious = results.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
    expect(serious.map((violation) => `${violation.id}：${violation.nodes.map((node) => node.target.join(' ')).join('；')}`)).toEqual([])
  })

  await page.screenshot({ path: path.join(SHOTS, 'admissions-provider-changes-1440.png'), fullPage: true })
  expect(errors, '頁面不該有未處理的錯誤').toEqual([])
  await context.close()
})

test('390px：托嬰中心清單與園所變化不撐出頁面', async ({ browser }) => {
  mkdirSync(SHOTS, { recursive: true })
  const { context, page } = await openAs(browser, 'super_admin', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  await openArea(page)
  await page.locator('.nearby-panel .el-radio-button', { hasText: '托嬰中心' }).click()
  await expect(page.locator('.nearby--babycare .nearby__item').first()).toBeAttached()
  await expect(page.locator('.changes')).toBeVisible()
  await expectNoHorizontalOverflow(page)
  await page.screenshot({ path: path.join(SHOTS, 'admissions-provider-changes-390.png'), fullPage: true })
  await context.close()
})

test('近幾年的出生數：6 期、缺月註明、增減只比兩期都有的月份', async ({ browser }) => {
  test.setTimeout(90_000)
  mkdirSync(SHOTS, { recursive: true })
  seedBirthSeries()
  const { context, page } = await openAs(browser, 'super_admin')
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await openArea(page)

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

  await test.step('位置：在「里的變化」區塊內、總結句下面、里表上面', async () => {
    const block = page.locator('.stats-block', { has: page.locator('.stats-block__title', { hasText: '里的變化（本校 3 公里內）' }) }).first()
    const order = await block.evaluate((element) => {
      const children = [...element.querySelectorAll('.trends-summary, .birth-series, table.stats-table')]
      return children.map((child) => (child.matches('.trends-summary') ? 'summary' : child.matches('.birth-series') ? 'series' : 'table'))
    })
    expect(order.indexOf('summary')).toBeLessThan(order.indexOf('series'))
    expect(order.indexOf('series')).toBeLessThan(order.indexOf('table'))
  })

  await test.step('新區塊沒有 serious／critical 的無障礙問題', async () => {
    const results = await new AxeBuilder({ page }).include('.birth-series').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
    const serious = results.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
    expect(serious.map((violation) => `${violation.id}：${violation.nodes.map((node) => node.target.join(' ')).join('；')}`)).toEqual([])
  })

  await expectNoHorizontalOverflow(page)
  await series.scrollIntoViewIfNeeded()
  await page.screenshot({ path: path.join(SHOTS, 'admissions-birth-series-1440.png'), fullPage: true })
  expect(errors, '頁面不該有未處理的錯誤').toEqual([])
  await context.close()
})

test('390px：近幾年的出生數不撐出頁面', async ({ browser }) => {
  mkdirSync(SHOTS, { recursive: true })
  seedBirthSeries()
  const { context, page } = await openAs(browser, 'super_admin', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  await openArea(page)
  await expect(page.locator('.birth-series')).toBeVisible()
  await expect(page.locator('.birth-series__row:not(.birth-series__row--head)')).toHaveCount(6)
  await expectNoHorizontalOverflow(page)
  await page.screenshot({ path: path.join(SHOTS, 'admissions-birth-series-390.png'), fullPage: true })
  await context.close()
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
