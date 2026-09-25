import { test, expect } from '@playwright/test'

// 手機版「活動影片」：點 YouTube 播放鍵要原地換成 iframe。
// 2026-09-25 第一次放進真的 YouTube 影片時，點播放會被當成「點兩側」翻到下一張、iframe 隨即被拔掉。
test.describe('手機活動影片 YouTube 播放', () => {
  test('點播放鍵原地插入 iframe，輪播不跳走', async ({ page, isMobile }) => {
    test.skip(!isMobile, '桌機隱藏活動影片')
    await page.route('https://www.youtube-nocookie.com/**', route =>
      route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>stub</title>' })
    )
    // 等 hydration 完（dev 首次載入慢），太早點圓點不會有反應
    await page.goto('/', { waitUntil: 'networkidle' })
    const skip = page.getByRole('button', { name: /略過/ })
    if (await skip.count()) await skip.first().click()

    const slides = page.locator('.home-films .film-slide')
    const k = await slides.evaluateAll(els => els.findIndex(el => el.querySelector('.film-play')))
    test.skip(k < 0, '目前沒有 YouTube 影片')
    const dot = page.locator('.home-films .film-dot').nth(k)
    await dot.click()
    await expect(dot).toHaveAttribute('aria-current')

    await slides.nth(k).locator('.film-play').click()
    await expect(slides.nth(k).locator('iframe')).toHaveAttribute('src', /youtube-nocookie\.com\/embed\//)
    await expect(dot).toHaveAttribute('aria-current')
  })
})
