import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { adminApi } from './api'
import { expectNoHorizontalOverflow, skipEntrance } from './pages'

// 隱私權政策頁（規格 P07、P09、P10、P12）。同一支 spec 內依序：未發布 → 404；用後台 API 發布 → 頁面、
// 頁尾入口、預約表單入口、截圖與 axe。發布後政策會留在這個庫裡，之後的 spec 看到的頁尾是「隱私權政策」連結，
// 所以放在同一個 describe 並關掉重試（重試時政策已發布，404 那一步會誤報）。
test.describe.configure({ mode: 'serial', retries: 0 })

const POLICY = {
  title: '隱私權政策',
  updated_on: '2026-10-03',
  sections: [
    { heading: '適用範圍', body: '本政策適用本網站。\n\n- 條列一\n- 條列二\n\n詳見 https://policies.google.com/privacy 與一段很長很長的網址 https://example.com/' + 'a'.repeat(120) },
    { heading: '聯絡我們', body: '各校電話請見「五所校園」。<b>不是粗體</b>' },
  ],
}

test('未發布時 /privacy 是 404、頁尾沒有隱私權政策連結', async ({ page }) => {
  const response = await page.goto('/privacy')
  expect(response?.status()).toBe(404)
  await page.goto('/')
  await skipEntrance(page)
  await expect(page.getByRole('link', { name: '隱私權政策' })).toHaveCount(0)
})

test('發布後：頁面、目錄、連結、頁尾與預約表單入口', async ({ page }) => {
  const api = await adminApi('super_admin')
  const item = await api.get<{ latest_version: number }>('/admin/content-items/privacy_policy')
  const saved = await api.send<{ latest_revision: { id: string } }>('POST', '/admin/content-items/privacy_policy/revisions', {
    expected_version: item.latest_version,
    payload: POLICY,
  })
  await api.send('POST', '/admin/content-items/privacy_policy/publish', { revision_id: saved.latest_revision.id })
  await api.dispose()

  // 官網 SSR 有 3 秒已發布內容快取（web/server/utils/published-site.ts）。
  await expect.poll(async () => (await page.request.get('/privacy')).status(), { timeout: 15_000 }).toBe(200)

  await page.goto('/privacy')
  await expect(page.getByRole('heading', { level: 1, name: '隱私權政策' })).toBeVisible()
  await expect(page.getByText('最後更新：2026 年 10 月 3 日')).toBeVisible()
  await expect(page.getByRole('heading', { level: 2, name: '適用範圍' })).toBeVisible()
  await expect(page.getByRole('listitem').filter({ hasText: '條列一' })).toBeVisible()
  // 只有 https:// 變連結；HTML 字元照原文顯示
  const link = page.getByRole('link', { name: /policies\.google\.com\/privacy/ })
  await expect(link).toHaveAttribute('target', '_blank')
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  await expect(page.getByText('<b>不是粗體</b>', { exact: false })).toBeVisible()
  // 目錄跳到段落
  await page.getByRole('navigation', { name: '本頁段落' }).getByRole('link', { name: '聯絡我們' }).click()
  await expect(page).toHaveURL(/#privacy-section-2$/)

  // SEO
  await expect(page).toHaveTitle(/^隱私權政策｜/)
  const robots = await page.locator('meta[name="robots"]').first().getAttribute('content')
  expect(robots).toBeTruthy()

  // axe：serious／critical 一律擋
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  expect(results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([])

  // sitemap（stack 沒開索引時是空的 sitemap，只在有網址時才驗）
  const sitemap = await (await page.request.get('/sitemap.xml')).text()
  if (sitemap.includes('<url>')) expect(sitemap).toContain('/privacy')

  // 頁尾入口
  await page.goto('/')
  await skipEntrance(page)
  const footerLink = page.locator('footer').getByRole('link', { name: '隱私權政策' })
  await expect(footerLink).toBeVisible()
  await footerLink.click()
  await expect(page).toHaveURL(/\/privacy$/)
})

test('預約表單：個資使用說明對話框有完整政策連結', async ({ page, context }) => {
  // global.setup.ts 已發布個資使用說明，所以表單會顯示對話框入口。
  await page.goto('/visit/yihua')
  await skipEntrance(page)
  await page.getByRole('button', { name: '閱讀個資使用說明' }).click()
  const dialog = page.getByRole('dialog', { name: '個資使用說明' })
  const policy = dialog.getByRole('link', { name: /完整隱私權政策/ })
  await expect(policy).toHaveAttribute('href', '/privacy')
  const [popup] = await Promise.all([context.waitForEvent('page'), policy.click()])
  await expect(popup).toHaveURL(/\/privacy$/)
  await popup.close()
})

for (const viewport of [{ name: '1440', width: 1440, height: 900 }, { name: '390', width: 390, height: 844 }]) {
  test(`${viewport.name}px：/privacy 不橫向溢出、截圖留存`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await page.goto('/privacy')
    await expect(page.getByRole('heading', { level: 1, name: '隱私權政策' })).toBeVisible()
    await expectNoHorizontalOverflow(page)
    await page.screenshot({ path: `output/playwright/privacy-${viewport.name}.png`, fullPage: true })
  })
}
