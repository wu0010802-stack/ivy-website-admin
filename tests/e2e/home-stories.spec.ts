import { test, expect } from '@playwright/test'

// 首頁最新消息（2026-10-17 改版）：桌機依校區篩選、手機動態。
// 手機的活動影片併進動態：點 YouTube 播放鍵要在檢視裡原地換成 iframe，進度停住不跳下一則。

async function openHome(page: import('@playwright/test').Page) {
  // 等 hydration 完（dev 首次載入慢），太早點不會有反應
  await page.goto('/', { waitUntil: 'networkidle' })
  const skip = page.getByRole('button', { name: /略過/ })
  if (await skip.count()) await skip.first().click()
  await page.locator('#latest-news').scrollIntoViewIfNeeded()
}

test.describe('首頁最新消息', () => {
  test('桌機：選一校只看這一校，「所有最新消息」帶著校區', async ({ page, isMobile }) => {
    test.skip(isMobile, '手機是動態，不出篩選')
    await openHome(page)
    const filter = page.locator('.hn-filter')
    test.skip(!(await filter.count()), '少於兩校有自己的消息時不出篩選')
    const option = filter.locator('label').nth(1)
    const key = await option.locator('input').getAttribute('value')
    await option.click()
    await expect(page.locator('.hn-news .hn-head .hn-more')).toHaveAttribute('href', `/news?campus=${key}`)
    await expect(option.locator('input')).toBeChecked()
  })

  test('手機：點卡片打開動態，Esc 關閉後焦點回到卡片', async ({ page, isMobile }) => {
    test.skip(!isMobile, '桌機不顯示動態')
    await openHome(page)
    const card = page.locator('.hs-card[data-story^="news:"]').first()
    await card.scrollIntoViewIfNeeded()
    await card.click()
    const viewer = page.locator('dialog.hsv')
    await expect(viewer).toHaveAttribute('open', '')
    await expect(viewer.getByRole('link', { name: '看完整消息' })).toHaveAttribute('href', /^\/news\//)
    await page.keyboard.press('Escape')
    await expect(viewer).not.toHaveAttribute('open', '')
    await expect(card).toBeFocused()
  })

  test('手機：YouTube 影片在檢視裡原地播放', async ({ page, isMobile }) => {
    test.skip(!isMobile, '桌機不顯示動態')
    await page.route('https://www.youtube-nocookie.com/**', route =>
      route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>stub</title>' })
    )
    await openHome(page)
    const card = page.locator('.hs-card[data-story^="film:yt-"]').first()
    test.skip(!(await card.count()), '目前沒有 YouTube 影片')
    await card.scrollIntoViewIfNeeded()
    await card.click()
    const viewer = page.locator('dialog.hsv')
    await viewer.getByRole('button', { name: /在 YouTube 播放/ }).click()
    await expect(viewer.locator('iframe')).toHaveAttribute('src', /youtube-nocookie\.com\/embed\//)
    await expect(viewer).toHaveAttribute('open', '')
  })
})
