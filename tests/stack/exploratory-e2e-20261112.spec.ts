import { expect, test, type Page } from '@playwright/test'
import { adminApi } from './api'
import { expectNoHorizontalOverflow, openAs } from './pages'
import { WEB_ORIGIN } from './stack-env'

// 2026-11-12 探索式 E2E 找到、11-13 修正的公開站問題（來龍去脈見 README 11-13 段落）。
// 同一輪的另外 8 條已由 fix/qa-report-20261112 修掉，測試在各自的 spec，這裡不重複。
// 只讀公開頁，或改完一定還原。

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

  test('未登入開 /preview：有標題，「跳至主要內容」有目標', async ({ page }) => {
    await page.goto('/preview')
    await expect(page.getByText('這個頁面只給已登入的後台管理者看草稿內容。')).toBeVisible()
    await expect(page).toHaveTitle(/草稿預覽/)
    await expect(page.locator('main#main')).toHaveCount(1)
  })

  test('頁尾底部備註放沒有斷點的長字串：手機 390／375 不橫向溢出', async ({ browser }) => {
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
    // 一定要是沒有任何斷點的一串字（沒有空白、斜線、連字號）：帶「/」的網址瀏覽器自己會斷行，
    // 沒修的版本也不會溢出，測不到東西（2026-11-13 在 main 上實測：90 個 A 把 390 寬撐到 908px）。
    const token = 'A'.repeat(90)
    const version = await publish({ ...original, bottom_note: `授權碼 ${token}` }, before.latest_version)
    try {
      for (const viewport of [{ width: 390, height: 844 }, { width: 375, height: 812 }]) {
        const { context, page } = await openAs(browser, null, { viewport, isMobile: true, hasTouch: true })
        // 已發布內容的 SSR 快取 3 秒：等新的備註出現再量。
        await expect.poll(async () => {
          await page.goto('/curriculum')
          return page.locator('.footer-bottom').innerText()
        }, { timeout: 15_000 }).toContain(token.slice(0, 20))
        await expectNoHorizontalOverflow(page)
        await context.close()
      }
    } finally {
      await publish(original, version)
      await api.dispose()
    }
  })
})
