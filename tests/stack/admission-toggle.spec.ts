import { expect, test } from '@playwright/test'
import { adminApi } from './api'
import { gotoAdmin, skipEntrance } from './pages'
import { storageStatePath } from './stack-env'

// 後台「網站標題與電話」的入學資訊分頁開關（2026-11-11）：關掉並發布後，/admission 回 404，
// 主選單、頁尾、關於頁與環境頁結尾都沒有入學資訊，舊站的入學網址改去首頁；打開再發布就回來。
// 結束時一定把開關打開，之後的 spec（a11y、hydration、keyboard）看到的仍是有入學資訊的官網。
test.describe.configure({ mode: 'serial', retries: 0 })
test.use({ storageState: storageStatePath('super_admin') })

const LEGACY_PATH = `/${encodeURIComponent('分班表')}`

async function setAdmission(enabled: boolean): Promise<void> {
  const api = await adminApi('super_admin')
  const item = await api.get<{ latest_version: number; latest_revision: { payload: Record<string, unknown> } }>(
    '/admin/content-items/site_meta',
  )
  const saved = await api.send<{ latest_revision: { id: string } }>('POST', '/admin/content-items/site_meta/revisions', {
    expected_version: item.latest_version,
    payload: { ...item.latest_revision.payload, admission_enabled: enabled },
  })
  await api.send('POST', '/admin/content-items/site_meta/publish', { revision_id: saved.latest_revision.id })
  await api.dispose()
}

test.afterAll(async () => {
  await setAdmission(true)
})

test('後台隱藏入學資訊分頁並發布：分頁、選單、頁尾與其他頁的連結都拿掉；打開後回來', async ({ page }) => {
  await test.step('預設顯示：分頁 200，舊站入學網址 301 到入學頁', async () => {
    expect((await page.request.get('/admission')).status()).toBe(200)
    const legacy = await page.request.get(LEGACY_PATH, { maxRedirects: 0 })
    expect(legacy.status()).toBe(301)
    expect(legacy.headers().location).toBe('/admission#classes')
  })

  await test.step('後台關掉開關並發布', async () => {
    await gotoAdmin(page, '/content/site-meta', '網站標題與電話')
    const toggle = page.getByRole('switch', { name: '在官網顯示入學資訊分頁' })
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

  await test.step('官網：分頁 404，首頁、關於頁、環境頁都沒有連到入學資訊的連結', async () => {
    // 官網 SSR 有 3 秒已發布內容快取（web/server/utils/published-site.ts）。
    await expect.poll(async () => (await page.request.get('/admission')).status(), { timeout: 15_000 }).toBe(404)
    await page.goto('/')
    await skipEntrance(page)
    await expect(page.getByRole('link', { name: '關於常春藤' }).first()).toBeAttached()
    await expect(page.locator('a[href^="/admission"]')).toHaveCount(0)
    await page.goto('/about')
    await expect(page.locator('.abh-next a')).toHaveCount(2)
    await expect(page.locator('a[href^="/admission"]')).toHaveCount(0)
    await page.goto('/environment')
    await expect(page.locator('.renv-next-link')).toHaveCount(2)
    await expect(page.locator('a[href^="/admission"]')).toHaveCount(0)
  })

  await test.step('隱藏期間舊站入學網址暫時去首頁（302、不快取）', async () => {
    const legacy = await page.request.get(LEGACY_PATH, { maxRedirects: 0 })
    expect(legacy.status()).toBe(302)
    expect(legacy.headers().location).toBe('/')
  })

  await test.step('打開再發布：入學資訊回來', async () => {
    await setAdmission(true)
    await expect.poll(async () => (await page.request.get('/admission')).status(), { timeout: 15_000 }).toBe(200)
    await page.goto('/')
    await skipEntrance(page)
    await expect(page.locator('a[href="/admission"]').first()).toBeAttached()
    await page.goto('/about')
    await expect(page.locator('.abh-next a[href="/admission"]')).toBeAttached()
    await page.goto('/environment')
    await expect(page.locator('.renv-next-link[href="/admission"]')).toBeAttached()
    const legacy = await page.request.get(LEGACY_PATH, { maxRedirects: 0 })
    expect(legacy.status()).toBe(301)
  })
})
