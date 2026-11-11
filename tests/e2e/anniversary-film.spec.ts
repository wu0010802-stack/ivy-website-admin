import { test, expect } from '@playwright/test'

// 30 週年分頁首屏的紀念影片《長成自己喜歡的樣子》（2026-11-11，取代 10-04 的 30 秒開場動畫）。
// 原始碼層的規則在 web/tests/anniversary.spec.ts；這裡驗瀏覽器裡真的會發生的事：
// 正片按了才下載、有聲音、整頁關燈、句子跟著亮、Esc 與捲走會暫停開燈。

const playing = (v: HTMLVideoElement) => !v.paused && !v.ended && v.currentTime > 0.2

test.describe('30 週年紀念影片', () => {
  test('按了才下載正片；播放時關燈、句子跟著亮；Esc 暫停並開燈', async ({ page }) => {
    const films: string[] = []
    page.on('request', (request) => { if (/\/assets\/anniversary-film\/film-/.test(request.url())) films.push(request.url()) })
    await page.goto('/anniversary', { waitUntil: 'networkidle' })
    const film = page.locator('#film')
    const cover = film.locator('.anni-film-cover')
    const video = film.locator('video.anni-film-video')
    // 沒有 JS 時封面就是連到影片檔的連結
    await expect(cover).toHaveAttribute('href', /^\/assets\/anniversary-film\/film-desktop-[0-9a-f]{10}\.mp4$/)
    await expect(video).not.toHaveAttribute('controls', '')
    expect(films, '還沒按播放就下載了正片').toHaveLength(0)

    await cover.click()
    await expect.poll(() => video.evaluate(playing)).toBe(true)
    expect(await video.evaluate((v: HTMLVideoElement) => v.muted)).toBe(false)
    await expect(film).toHaveClass(/is-dark/)
    await expect(cover).toHaveCount(0)
    await expect(video).toHaveAttribute('controls', '')
    // 直拿播直式那一版，其餘播橫式
    const portrait = await page.evaluate(() => matchMedia('(max-aspect-ratio: 4/5)').matches)
    expect(await video.evaluate((v: HTMLVideoElement) => v.currentSrc)).toContain(portrait ? '/film-mobile-' : '/film-desktop-')
    await expect(film.locator('.anni-film-cues button').first()).toHaveAttribute('aria-current', 'true')

    // 點第二句：從 0:53 那個鏡頭開始播，亮的換成第二句
    const second = film.locator('.anni-film-cues button').nth(1)
    await second.click()
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(53)
    await expect(second).toHaveAttribute('aria-current', 'true')
    await expect(film.locator('.anni-film-cues button[aria-current]')).toHaveCount(1)

    await page.keyboard.press('Escape')
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true)
    await expect(film).not.toHaveClass(/is-dark/)
  })

  test('播放中捲到別的區塊：影片暫停、開燈，不在看不到的地方繼續出聲', async ({ page }) => {
    await page.goto('/anniversary', { waitUntil: 'networkidle' })
    const film = page.locator('#film')
    const video = film.locator('video.anni-film-video')
    await film.locator('.anni-film-cover').click()
    await expect.poll(() => video.evaluate(playing)).toBe(true)
    await page.locator('#anni-cake').scrollIntoViewIfNeeded()
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true)
    await expect(film).not.toHaveClass(/is-dark/)
  })

  test('首屏的索引連到時間軸、蠟燭、作品、畫板；片中的六句都在頁面上', async ({ page }) => {
    await page.goto('/anniversary', { waitUntil: 'networkidle' })
    const links = page.locator('.anni-index a')
    await expect(links).toHaveCount(4)
    for (const href of await links.evaluateAll((list) => list.map((a) => a.getAttribute('href')!))) {
      await expect(page.locator(href)).toHaveCount(1)
    }
    await expect(page.locator('.anni-film-cues li')).toHaveCount(6)
    await expect(page.locator('.anni-film-cues')).toContainText('陪伴每一個孩子，長成自己喜歡的樣子。')
    // 舊的開場動畫不再出現
    await expect(page.getByRole('button', { name: '略過開場' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '重看開場影片' })).toHaveCount(0)
  })
})
