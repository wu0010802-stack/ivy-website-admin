import { test, expect, type Locator } from '@playwright/test'

// 特色教學 03 兒童美術館手機橫滑（2026-11-16）：清單尾端留白，最後一件也停在起點（原本左邊會露出上一件的殘邊）；
// 「1 / 8　左右滑動」換成一件一段的進度條，點一段捲到那一件。760px 以下才橫滑，桌機是作品牆、不顯示進度條。
const leftOf = (rail: Locator, index: number) => rail.evaluate((el, i) => {
  const item = el.children[i] as HTMLElement
  return item.getBoundingClientRect().left - el.getBoundingClientRect().left
}, index)

test.describe('特色教學美術館橫滑', () => {
  test('手機：滑到底最後一件停在起點，點進度條捲到那一件', async ({ page }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('mobile'), '760px 以下才橫滑')
    await page.goto('/curriculum', { waitUntil: 'networkidle' })
    const gallery = page.locator('#gallery')
    const rail = gallery.locator('.cur-art-wall')
    const ticks = gallery.locator('.cur-ticks button')
    await rail.scrollIntoViewIfNeeded()

    const count = await rail.locator(':scope > li').count()
    expect(count).toBeGreaterThan(1)
    await expect(ticks).toHaveCount(count)
    await expect(ticks.first()).toHaveAttribute('aria-current', 'true')
    await expect(gallery).not.toContainText('左右滑動')
    const origin = await leftOf(rail, 0)

    await rail.evaluate((el) => el.scrollTo({ left: el.scrollWidth }))
    await expect.poll(async () => Math.abs(await leftOf(rail, count - 1) - origin)).toBeLessThanOrEqual(1)
    await expect(ticks.last()).toHaveAttribute('aria-current', 'true')

    await ticks.nth(2).click()
    await expect.poll(async () => Math.abs(await leftOf(rail, 2) - origin)).toBeLessThanOrEqual(1)
    await expect(ticks.nth(2)).toHaveAttribute('aria-current', 'true')
    await expect(gallery.locator('.cur-ticks [aria-current="true"]')).toHaveCount(1)
  })

  test('桌機：作品牆不橫捲，進度條不顯示', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('mobile'), '桌機與平板才是作品牆')
    await page.goto('/curriculum', { waitUntil: 'networkidle' })
    await expect(page.locator('#gallery .cur-ticks')).toBeHidden()
    expect(await page.locator('#gallery .cur-art-wall').evaluate((el) => getComputedStyle(el).overflowX)).toBe('visible')
  })
})
