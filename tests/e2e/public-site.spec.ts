import { test, expect } from '@playwright/test'

test.describe('公開站：booking CTA 依後端 booking-config 即時反應', () => {
  // 仁武校的 booking_configs 沒有另外設定時，資料庫預設值就是 paused
  // （見 backend/app/booking/models.py），這裡故意不呼叫任何 admin API
  // 去改它，測的正是「什麼都沒設定時公開頁面也不會假裝可以預約」。
  test('/visit/renwu 直接進入也即時讀 paused 狀態，不落回表單', async ({ page }) => {
    await page.goto('/visit/renwu')
    await expect(page.locator('.booking-alt-cta')).toBeVisible()
    await expect(page.locator('.booking-alt-cta')).toContainText('暫停參觀預約')
  })
})

test.describe('SEO：canonical／OG／robots meta', () => {
  test('未啟用正式索引時，首頁帶 noindex 且不輸出 canonical', async ({ page }) => {
    await page.goto('/')
    const robots = page.locator('meta[name="robots"]')
    await expect(robots).toHaveAttribute('content', 'noindex, nofollow')
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(0)
  })

  test('已移除的分校頁網址 301 轉回首頁', async ({ request }) => {
    for (const path of ['/campuses/minghua', '/campuses/not-a-real-campus']) {
      const res = await request.get(path, { maxRedirects: 0 })
      expect(res.status()).toBe(301)
      expect(new URL(res.headers().location!, 'http://x').pathname).toBe('/')
    }
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
