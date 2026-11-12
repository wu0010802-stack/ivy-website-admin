import { expect, request, test, type Page } from '@playwright/test'
import { adminApi } from './api'
import { expectNoHorizontalOverflow, openAs, pickVisitDate } from './pages'
import { SLOTS_CAMPUS, WEB_ORIGIN } from './stack-env'

// 2026-11-12 全專案探索式 E2E 找到、已修正的問題（各條的來龍去脈見 README 同日段落）。
// 只讀公開頁或改完一定還原；預約那一條攔下送單請求，不在共用測試庫建案件、不占場次名額。

const EMPTY_STATE = { cookies: [], origins: [] }

test.describe('公開站', () => {
  test('從 404 頁點站內連結離開再按上一頁：回到的 404 照常顯示，不是白畫面', async ({ page }) => {
    for (const path of ['/news/no-such-article-20261112', '/no-such-page-20261112']) {
      const response = await page.goto(path)
      expect(response?.status(), path).toBe(404)
      await expect(page.getByRole('heading', { level: 1, name: '找不到這一頁' })).toBeVisible()
      // 用站內連結（NuxtLink，push 一筆歷程）離開；「回到首頁」是 clearError 的 replace，按上一頁回不到這裡。
      await page.locator('main.error-page').getByRole('link', { name: /預約參觀/ }).click()
      await expect(page).toHaveURL(`${WEB_ORIGIN}/visit`)
      await page.goBack()
      await expect(page).toHaveURL(`${WEB_ORIGIN}${path}`)
      await expect(page.getByRole('heading', { level: 1, name: '找不到這一頁' }), path).toBeVisible()
    }
  })

  async function shiftTabIntoPill(page: Page) {
    // 捲過頁首收合的門檻，從 main 第一個可聚焦的元素（不捲動地聚焦）往回按一次 Shift+Tab，焦點進膠囊。
    await page.evaluate(() => window.scrollTo(0, 400))
    await expect(page.locator('header.header')).toHaveAttribute('data-state', 'compact')
    await page.evaluate(() => {
      const first = document.querySelector('main')!.querySelector<HTMLElement>('a[href], button:not([disabled]), [tabindex="0"]')!
      first.focus({ preventScroll: true })
    })
    await page.keyboard.press('Shift+Tab')
  }

  for (const [label, path, viewport] of [
    ['桌機 1440 /about', '/about', { width: 1440, height: 900 }],
    ['手機 390 /environment', '/environment', { width: 390, height: 844 }],
  ] as const) {
    test(`${label}：捲動後用 Shift+Tab 進膠囊，頁面不跳回頂端、膠囊不消失、焦點在膠囊裡`, async ({ browser }) => {
      const { context, page } = await openAs(browser, null, { viewport, ...(viewport.width < 900 ? { isMobile: true, hasTouch: true } : {}) })
      await page.goto(path, { waitUntil: 'networkidle' })
      await shiftTabIntoPill(page)
      await expect.poll(() => page.evaluate(() => Boolean(document.activeElement?.closest('.header-pill')))).toBe(true)
      expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(40)
      await expect(page.locator('header.header')).toHaveAttribute('data-state', 'compact')
      await context.close()
    })
  }

  test('結尾斜線與大寫的頁面網址 301 回標準路徑（頁首的膠囊與目前頁標示才對得上）', async () => {
    const api = await request.newContext({ baseURL: WEB_ORIGIN, storageState: EMPTY_STATE })
    for (const [from, to] of [['/about/', '/about'], ['/About', '/about'], ['/visit/manage/', '/visit/manage'], ['/curriculum/?utm_source=x', '/curriculum?utm_source=x']]) {
      const response = await api.get(from, { maxRedirects: 0 })
      expect(response.status(), from).toBe(301)
      expect(response.headers().location, from).toBe(to)
    }
    expect((await api.get('/about', { maxRedirects: 0 })).status()).toBe(200)
    await api.dispose()
  })

  test('未登入開 /preview：有標題，「跳至主要內容」有目標', async ({ page }) => {
    await page.goto('/preview')
    await expect(page.getByText('這個頁面只給已登入的後台管理者看草稿內容。')).toBeVisible()
    await expect(page).toHaveTitle(/草稿預覽/)
    await expect(page.locator('main#main')).toHaveCount(1)
  })

  test('管理頁已開著時在同一分頁開修改連結：token 不留在網址與 history.state', async ({ page }) => {
    await page.goto('/visit/manage', { waitUntil: 'networkidle' })
    // 同文件的 fragment 導覽（貼上連結、從信裡點開到同一分頁）；token 是假的也一樣要清掉。
    await page.evaluate(() => { window.location.hash = 'token=fake-token-20261112' })
    await expect(page).toHaveURL(`${WEB_ORIGIN}/visit/manage`)
    expect(await page.evaluate(() => JSON.stringify(history.state))).not.toContain('fake-token-20261112')
  })

  test('頁尾底部備註放長網址：手機 390／375 不橫向溢出', async ({ browser }) => {
    const api = await adminApi('super_admin')
    const before = await api.get<{ latest_version: number; current_published_revision_id: string | null; latest_revision: { payload: Record<string, unknown> } }>('/admin/content-items/site_footer')
    const publish = async (payload: Record<string, unknown>, version: number) => {
      const saved = await api.send<{ latest_version: number; latest_revision: { id: string } }>('POST', '/admin/content-items/site_footer/revisions', { expected_version: version, payload })
      await api.send('POST', '/admin/content-items/site_footer/publish', { revision_id: saved.latest_revision.id })
      return saved.latest_version
    }
    // 還原成「目前已發布」的那一版（最新一版可能是別的測試留下、沒發布的草稿）。
    const original = before.current_published_revision_id
      ? (await api.get<{ payload: Record<string, unknown> }>(`/admin/content-items/site_footer/revisions/${before.current_published_revision_id}`)).payload
      : before.latest_revision.payload
    const version = await publish({ ...original, bottom_note: '活動照片授權請洽 https://www.example.com/a-very-long-path/that-keeps-going/without-any-spaces/20261112' }, before.latest_version)
    try {
      for (const viewport of [{ width: 390, height: 844 }, { width: 375, height: 812 }]) {
        const { context, page } = await openAs(browser, null, { viewport, isMobile: true, hasTouch: true })
        // 已發布內容的 SSR 快取 3 秒：等新的備註出現再量。
        await expect.poll(async () => {
          await page.goto('/curriculum')
          return page.locator('.footer-bottom').innerText()
        }, { timeout: 15_000 }).toContain('a-very-long-path')
        await expectNoHorizontalOverflow(page)
        await context.close()
      }
    } finally {
      await publish(original, version)
      await api.dispose()
    }
  })
})

test.describe('家長預約', () => {
  test('送出途中重新整理：還原的資料用同一把 idempotency key 重送，伺服器不會再建一筆', async ({ browser }) => {
    const { context, page } = await openAs(browser, null)
    const keys: string[] = []
    // 只攔官網的送單請求：記下 key、不讓它到後端（不建案件、不占名額）。第一次當成網路斷線，第二次回假的成功。
    await page.route('**/api/website/v1/public/visit-requests', async (route) => {
      keys.push(route.request().headers()['idempotency-key'] ?? '')
      if (keys.length === 1) return route.abort('connectionreset')
      return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ receipt_id: keys[0], status: 'confirmed', manage_path: null }) })
    })
    await page.goto(`/visit/${SLOTS_CAMPUS}`)
    await pickVisitDate(page)
    await page.locator('.visit-slot-options input[type="radio"]').first().check()
    await page.getByLabel('孩子姓名').fill('重整寶貝')
    await page.getByLabel('孩子出生年月日').fill('2022-03-15')
    await page.getByLabel('家長稱呼').fill('重整媽媽')
    await page.getByLabel('聯絡電話').fill('0955000999')
    await page.getByLabel('聯絡 Email').fill('reload-20261112@example.com')
    await page.getByRole('button', { name: '確認預約' }).click()
    await expect.poll(() => keys.length).toBe(1)

    await page.reload()
    await expect(page.getByLabel('家長稱呼')).toHaveValue('重整媽媽')
    await expect(page.locator('.visit-slot-options input[type="radio"]:checked')).toHaveCount(1)
    await page.getByRole('button', { name: '確認預約' }).click()
    await expect.poll(() => keys.length).toBe(2)
    expect(keys[1]).toBe(keys[0])
    await context.close()
  })
})

test.describe('後台', () => {
  test('分校角色開成效統計：不打 Google 的兩個 API、沒有讀不到的錯誤框', async ({ browser }) => {
    const { context, page } = await openAs(browser, 'campus_admin')
    const forbidden: string[] = []
    page.on('response', (response) => {
      if (/\/admin\/(crux|search-insights)/.test(response.url())) forbidden.push(`${response.status()} ${response.url()}`)
    })
    await page.goto('/admin/analytics')
    await expect(page.getByRole('heading', { level: 1, name: '成效統計' })).toBeVisible()
    await page.goto('/admin/analytics?tab=journey')
    await expect(page.getByRole('heading', { level: 1, name: '成效統計' })).toBeVisible()
    await page.waitForLoadState('networkidle')
    await expect(page.getByText(/無法讀取 (Chrome 真實使用者數據|Google 搜尋資料)/)).toHaveCount(0)
    expect(forbidden).toEqual([])
    await context.close()
  })

  test('分校角色的草稿預覽只讀自己校區的草稿，不打出一串 404', async ({ browser }) => {
    const { context, page } = await openAs(browser, 'editor')
    const notFound: string[] = []
    page.on('response', (response) => {
      if (response.status() === 404 && response.url().includes('/admin/content-items/')) notFound.push(response.url())
    })
    await page.goto('/preview', { waitUntil: 'networkidle' })
    await expect(page.locator('.preview-banner')).toBeVisible()
    expect(notFound).toEqual([])
    await context.close()
  })
})
