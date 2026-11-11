import { expect, test, type APIRequestContext } from '@playwright/test'
import { adminApi } from './api'
import { gotoAdmin, skipEntrance } from './pages'
import { storageStatePath } from './stack-env'

// 後台「網站標題與電話」的最新消息開關（2026-11-11）：關掉並發布後，首頁沒有最新消息那一章、
// /news 與單篇消息導回首頁、主選單與頁尾沒有最新消息，消息編輯頁提醒官網目前不顯示；打開再發布就回來。
// 結束時一定把開關打開，之後的 spec（a11y、visual）看到的仍是有最新消息的官網。
test.describe.configure({ mode: 'serial', retries: 0 })
test.use({ storageState: storageStatePath('super_admin') })

// 首頁最新消息那一章的錨點（content.news.sectionId）；首頁 HTML 有它＝那一章有放。
const NEWS_SECTION = 'id="latest-news"'
const HIDDEN_NOTICE = '官網目前沒有顯示最新消息'

async function homeHtml(request: APIRequestContext): Promise<string> {
  return (await request.get('/')).text()
}

async function newsStatus(request: APIRequestContext, path = '/news'): Promise<number> {
  return (await request.get(path, { maxRedirects: 0 })).status()
}

async function setNews(enabled: boolean): Promise<void> {
  const api = await adminApi('super_admin')
  const item = await api.get<{ latest_version: number; latest_revision: { payload: Record<string, unknown> } }>(
    '/admin/content-items/site_meta',
  )
  const saved = await api.send<{ latest_revision: { id: string } }>('POST', '/admin/content-items/site_meta/revisions', {
    expected_version: item.latest_version,
    payload: { ...item.latest_revision.payload, news_enabled: enabled },
  })
  await api.send('POST', '/admin/content-items/site_meta/publish', { revision_id: saved.latest_revision.id })
  await api.dispose()
}

test.afterAll(async () => {
  await setNews(true)
})

test('後台關掉最新消息並發布：首頁那一章、消息頁、選單與頁尾連結都拿掉；打開後回來', async ({ page }) => {
  await test.step('預設開：首頁有那一章、列表頁 200、消息編輯頁沒有提醒', async () => {
    expect(await homeHtml(page.request)).toContain(NEWS_SECTION)
    expect(await newsStatus(page.request)).toBe(200)
    await gotoAdmin(page, '/content/home-news', '最新消息與活動')
    await expect(page.getByText(HIDDEN_NOTICE)).toHaveCount(0)
  })

  await test.step('後台關掉開關並發布', async () => {
    await gotoAdmin(page, '/content/site-meta', '網站標題與電話')
    const toggle = page.getByRole('switch', { name: '在官網顯示最新消息' })
    await expect(toggle).toBeChecked()
    // Element Plus 的 switch：真正的 input 是隱藏的，點外框。
    await page.locator('.el-switch', { has: toggle }).click()
    await expect(toggle).not.toBeChecked()
    await page.getByRole('button', { name: '儲存並發布到官網' }).click()
    const confirm = page.getByRole('dialog', { name: /到官網？$/ })
    await confirm.getByRole('button', { name: '儲存並發布' }).click()
    await expect(confirm).toBeHidden()
    await expect(page.getByRole('button', { name: '發布到官網' })).toBeDisabled()
  })

  await test.step('官網：消息頁導回首頁、首頁沒有那一章、選單與頁尾沒有最新消息', async () => {
    // 官網 SSR 有 3 秒已發布內容快取（web/server/utils/published-site.ts）。
    await expect.poll(() => newsStatus(page.request), { timeout: 15_000 }).toBe(302)
    const redirect = await page.request.get('/news', { maxRedirects: 0 })
    expect(redirect.headers().location).toBe('/')
    // 單篇頁不論有沒有這一則都導回首頁，不露出 404
    expect(await newsStatus(page.request, '/news/no-such-article')).toBe(302)
    const html = await homeHtml(page.request)
    expect(html).not.toContain(NEWS_SECTION)
    await page.goto('/')
    await skipEntrance(page)
    await expect(page.locator('#campuses')).toBeAttached()
    await expect(page.locator('.home-news, .news-transition')).toHaveCount(0)
    await expect(page.locator('a[href^="/news"]')).toHaveCount(0)
    await expect(page.getByRole('link', { name: '關於常春藤' }).first()).toBeAttached()
    await page.goto('/news')
    await expect(page).toHaveURL(/\/$/)
  })

  await test.step('後台消息編輯頁提醒官網目前不顯示', async () => {
    await gotoAdmin(page, '/content/home-news', '最新消息與活動')
    await expect(page.getByText(HIDDEN_NOTICE)).toBeVisible()
  })

  await test.step('打開再發布：最新消息回來', async () => {
    await setNews(true)
    await expect.poll(() => newsStatus(page.request), { timeout: 15_000 }).toBe(200)
    expect(await homeHtml(page.request)).toContain(NEWS_SECTION)
    await page.goto('/')
    await skipEntrance(page)
    await expect(page.locator('a[href="/news"]').first()).toBeAttached()
  })
})
