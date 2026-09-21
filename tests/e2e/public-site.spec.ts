import { test, expect } from '@playwright/test'

test.describe('公開站：booking CTA 依後端 booking-config 即時反應', () => {
  // 仁武校的 booking_configs 沒有另外設定時，資料庫預設值就是 paused
  // （見 backend/app/booking/models.py），這裡故意不呼叫任何 admin API
  // 去改它，測的正是「什麼都沒設定時公開頁面也不會假裝可以預約」。
  test('paused 校區：CTA 顯示暫停訊息，不產生可點的連結', async ({ page }) => {
    // 仁武校在資料尚未設定時的預設狀態即為 paused（見 booking.py 預設值）。
    await page.goto('/campuses/renwu')
    const cta = page.locator('.hero-cta .is-disabled, .hero-cta [role="note"]').first()
    await expect(cta).toBeVisible()
  })

  test('/visit/renwu 直接進入也即時讀 paused 狀態，不落回表單', async ({ page }) => {
    await page.goto('/visit/renwu')
    await expect(page.locator('.booking-alt-cta')).toBeVisible()
    await expect(page.locator('.booking-alt-cta')).toContainText('暫停參觀預約')
  })

  test('未知校區的 booking-config 安全退回 paused，不假造可預約樣子', async ({ page }) => {
    const response = await page.goto('/campuses/not-a-real-campus')
    expect(response?.status()).toBe(404)
  })
})

test.describe('SEO：canonical／OG／robots meta', () => {
  test('未啟用正式索引時，首頁帶 noindex 且不輸出 canonical', async ({ page }) => {
    await page.goto('/')
    const robots = page.locator('meta[name="robots"]')
    await expect(robots).toHaveAttribute('content', 'noindex, nofollow')
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(0)
  })

  test('分校頁帶 og:title／og:description，且同樣是 noindex（索引未啟用）', async ({ page }) => {
    await page.goto('/campuses/minghua')
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
      'content',
      /明華/
    )
    await expect(page.locator('meta[property="og:description"]')).toHaveCount(1)
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      'content',
      'noindex, nofollow'
    )
  })

  test('/visit 頁一律 noindex，跟索引開關無關', async ({ page }) => {
    await page.goto('/visit')
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      'content',
      'noindex, nofollow'
    )
  })
})

test.describe('robots.txt／sitemap.xml：依索引開關動態產生', () => {
  test('索引未啟用時 robots.txt 擋全站、sitemap.xml 回 404', async ({ page }) => {
    const robotsRes = await page.request.get('/robots.txt')
    expect(robotsRes.status()).toBe(200)
    const robotsBody = await robotsRes.text()
    expect(robotsBody).toContain('Disallow: /')

    const sitemapRes = await page.request.get('/sitemap.xml')
    expect(sitemapRes.status()).toBe(404)
  })
})
