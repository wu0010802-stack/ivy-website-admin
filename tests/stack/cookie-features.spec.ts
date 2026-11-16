import { expect, test, type Page } from '@playwright/test'
import { adminApi, findVisit } from './api'
import { gotoAdmin, openAs, pickVisitDate } from './pages'
import { SECOND_CAMPUS, SLOTS_CAMPUS, WEB_ORIGIN } from './stack-env'

// 官網 cookie 功能（2026-11-16，docs/specs/2026-11-16-cookie-features-design.md）在真的瀏覽器＋代理＋API 上走一次。
// stack 的官網關著第一方統計（start-web.sh），進站時不會寫 ivy_src；這裡直接放一個官網格式的 ivy_src，
// 驗「經過同源代理送到 API、寫進預約、後台看得到」這一段。寫入規則另有 web 單元測試。

// 和 web/tests/attribution-cookie.spec.ts、backend/tests/test_cookie_features_20261116.py 同一組樣本：
// 第一次 Facebook（11/10），預約前最後一次付費廣告 chatgpt-five-campuses（11/16）。
const SAMPLE_SITE_COOKIE =
  'eyJ2IjoxLCJmIjp7InMiOiJmYWNlYm9vayIsImQiOiIyMDI2LTExLTEwIn0sImwiOnsicyI6ImFkcyIsImQiOiIyMDI2LTExLTE2IiwiYyI6' +
  'ImNoYXRncHQtZml2ZS1jYW1wdXNlcyJ9LCJvIjp7InYiOiJvcHBfQWJDLjEyMy14IiwidCI6MTc5NDc4NzIwMDAwMH0sImIiOnsidiI6Ikl3' +
  'QVIwYWJjX0RFRi0xMjMiLCJ0IjoxNzk0Nzg3MjAwMDAwfX0'

// 公開送單每來源每校每小時 5 筆：這兩支各用自己的來源 IP（文件保留網段），不吃掉其他 spec 的額度。
const ownSource = (ip: string) => ({ extraHTTPHeaders: { 'X-Forwarded-For': ip } })

async function bookOnline(page: Page, parentName: string, phone: string): Promise<void> {
  await page.goto(`/visit/${SLOTS_CAMPUS}`)
  await expect(page.getByRole('heading', { name: '填寫參觀資料' })).toBeVisible()
  await pickVisitDate(page)
  await page.locator('.visit-slot-options input[type="radio"]').first().check()
  await page.getByLabel('寶貝姓名').fill('記住寶貝')
  await page.getByLabel('寶貝出生年月日').fill('2022-03-15')
  await page.getByLabel('家長稱呼').fill(parentName)
  await page.getByLabel('聯絡電話').fill(phone)
  // Email 選填（2026-11-13）：不填，正是「關掉結果頁就找不回修改連結」的那種家長。
  await page.getByRole('button', { name: '確認預約' }).click()
  await expect(page.locator('#booking-result')).toContainText('預約成功')
}

test('沒留 Email 的家長關掉結果頁後，回到預約頁還能修改；按「不是我的預約」就不再出現', async ({ browser }) => {
  const parent = await openAs(browser, null, ownSource('198.51.100.116'))
  const { page, context } = parent
  await bookOnline(page, '記住媽媽', '0955000333')
  expect((await context.cookies()).some(cookie => cookie.name === 'ivy_visit_remember' && cookie.httpOnly)).toBe(true)

  await test.step('從首頁站內換頁到預約頁，上方出現「您已預約」', async () => {
    await page.goto('/')
    await page.locator('a[href="/visit"]').first().click()
    await expect(page).toHaveURL(/\/visit$/)
    const notice = page.locator('.visit-remembered')
    await expect(notice).toContainText('您已預約')
    await expect(notice).toContainText('義華')
    // 只顯示日期、場次與校區，不顯示家長資料。
    await expect(notice).not.toContainText('記住媽媽')
  })

  await test.step('按「修改或取消預約」進管理頁', async () => {
    await page.getByRole('button', { name: '修改或取消預約' }).click()
    await expect(page).toHaveURL(/\/visit\/manage$/)
    await expect(page.locator('.parent-visit-status')).toHaveText('預約成功')
  })

  await test.step('「不是我的預約」：收起來，重新整理也不再出現，預約本身還在', async () => {
    await page.goto('/visit')
    await page.getByRole('button', { name: '不是我的預約' }).click()
    await expect(page.locator('.visit-remembered')).toHaveCount(0)
    await page.reload()
    await expect(page.getByRole('heading', { name: '想先認識哪所校園？' })).toBeVisible()
    await expect(page.locator('.visit-remembered')).toHaveCount(0)
    expect((await context.cookies()).some(cookie => cookie.name === 'ivy_visit_remember')).toBe(false)
  })

  const api = await adminApi('super_admin')
  expect((await findVisit(api, '記住媽媽')).status).toBe('confirmed')
  await Promise.all([context.close(), api.dispose()])
})

test('網站來源 cookie 經代理寫進預約，後台案件明細與招生統計看得到', async ({ browser }) => {
  const parent = await openAs(browser, null, ownSource('198.51.100.117'))
  await parent.context.addCookies([{ name: 'ivy_src', value: SAMPLE_SITE_COOKIE, url: WEB_ORIGIN, httpOnly: true, sameSite: 'Lax' }])
  await bookOnline(parent.page, '來源媽媽', '0955000444')
  await parent.context.close()

  const api = await adminApi('super_admin')
  const visit = await findVisit(api, '來源媽媽')
  const detail = await api.get<{ first_touch_source: string | null; last_touch_source: string | null; last_touch_campaign: string | null }>(
    `/admin/visit-requests/${visit.id}`,
  )
  expect(detail).toMatchObject({ first_touch_source: 'facebook', last_touch_source: 'ads', last_touch_campaign: 'chatgpt-five-campuses' })
  await api.dispose()

  const admin = await openAs(browser, 'super_admin')
  await gotoAdmin(admin.page, `/admissions-stats?campus=${SLOTS_CAMPUS}&sub=booking`, '招生統計')
  const panel = admin.page.locator('section.attribution')
  await expect(panel.getByRole('heading', { name: /網站來源/ })).toBeVisible()
  await expect(panel).toContainText('付費廣告・chatgpt-five-campuses')
  await panel.getByRole('radio', { name: '第一次進站' }).check({ force: true })
  await expect(panel).toContainText('Facebook')
  await admin.context.close()
})

test('選過的校區會被記住：首頁五校卡第一個畫面就停在那一校', async ({ browser }) => {
  const { page, context } = await openAs(browser, null)
  await page.goto('/visit')
  await page.locator(`.visit-campus-link[data-key="${SECOND_CAMPUS}"]`).click()
  await expect(page).toHaveURL(new RegExp(`/visit/${SECOND_CAMPUS}$`))
  expect((await context.cookies()).find(cookie => cookie.name === 'ivy_campus')?.value).toBe(SECOND_CAMPUS)

  // 伺服器渲染的 HTML 就已經選在那一校（不是載入後才切過去）。
  const html = await (await page.request.get('/', { headers: { cookie: `ivy_campus=${SECOND_CAMPUS}` } })).text()
  expect(html).toMatch(new RegExp(`id="campus-tab-${SECOND_CAMPUS}"[^>]*aria-selected="true"`))
  await page.goto('/')
  await expect(page.locator(`#campus-tab-${SECOND_CAMPUS}`)).toHaveAttribute('aria-selected', 'true')
  await context.close()
})

// 帶著這次新增的 cookie 開頁面：SSR 依 cookie 輸出不同內容（記住的校區、開場閘門、記住的預約），
// 瀏覽器接手時不能出現 hydration mismatch（hydration.spec.ts 是沒有 cookie 的版本）。
for (const path of ['/', '/anniversary', '/visit']) {
  test(`${path} 帶著校區與開場 cookie 也沒有 hydration mismatch`, async ({ browser }) => {
    const { page, context } = await openAs(browser, null)
    await context.addCookies(['ivy_campus', 'ivy_seen_entrance', 'ivy_seen_anni_intro', 'ivy_visit_remember'].map(name => ({
      name, value: name === 'ivy_campus' ? SECOND_CAMPUS : name === 'ivy_visit_remember' ? 'not-a-real-token' : '1', url: WEB_ORIGIN,
    })))
    const problems: string[] = []
    page.on('console', (message) => {
      if (/hydrat/i.test(message.text())) problems.push(`[${message.type()}] ${message.text()}`)
    })
    page.on('pageerror', (error) => problems.push(`[pageerror] ${error.message}`))
    const response = await page.goto(path, { waitUntil: 'networkidle' })
    // /anniversary 可能被後台開關關掉（404）；開著才檢查。
    test.skip(response?.status() === 404, '30 週年分頁沒開')
    await expect(page.locator('#__nuxt')).not.toBeEmpty()
    await page.waitForTimeout(300)
    expect(problems).toEqual([])
    // 偽造的 ivy_visit_remember 查不到預約：不顯示提示列，cookie 被清掉。
    if (path === '/visit') {
      await expect(page.locator('.visit-remembered')).toHaveCount(0)
      await expect.poll(async () => (await context.cookies()).some(cookie => cookie.name === 'ivy_visit_remember')).toBe(false)
    }
    await context.close()
  })
}
