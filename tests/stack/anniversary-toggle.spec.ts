import { expect, test, type APIRequestContext } from '@playwright/test'
import { adminApi } from './api'
import { gotoAdmin, skipEntrance } from './pages'
import { storageStatePath } from './stack-env'

// 後台「網站標題與電話」的 30 週年開關（2026-10-24）：關掉並發布後，首頁不放進站布幕、
// /anniversary 回 404、主選單與頁尾沒有 30 週年；打開再發布就回來。
// 結束時一定把開關打開，之後的 spec（a11y、visual）看到的仍是有 30 週年的官網。
test.describe.configure({ mode: 'serial', retries: 0 })
test.use({ storageState: storageStatePath('super_admin') })

// 進站布幕 bootstrap 裡的字串（web/app/utils/entrance-policy.ts）；首頁 HTML 有它＝會播布幕。
const CURTAIN_MARK = '__ivyEntranceSeen'

async function homeHtml(request: APIRequestContext): Promise<string> {
  return (await request.get('/')).text()
}

async function setAnniversary(enabled: boolean): Promise<void> {
  const api = await adminApi('super_admin')
  const item = await api.get<{ latest_version: number; latest_revision: { payload: Record<string, unknown> } }>(
    '/admin/content-items/site_meta',
  )
  const saved = await api.send<{ latest_revision: { id: string } }>('POST', '/admin/content-items/site_meta/revisions', {
    expected_version: item.latest_version,
    payload: { ...item.latest_revision.payload, anniversary_enabled: enabled },
  })
  await api.send('POST', '/admin/content-items/site_meta/publish', { revision_id: saved.latest_revision.id })
  await api.dispose()
}

test.afterAll(async () => {
  await setAnniversary(true)
})

test('後台關掉 30 週年並發布：布幕、分頁、選單與頁尾連結都拿掉；打開後回來', async ({ page }) => {
  await test.step('預設開：有布幕、分頁 200、選單有 30 週年', async () => {
    expect(await homeHtml(page.request)).toContain(CURTAIN_MARK)
    expect((await page.request.get('/anniversary')).status()).toBe(200)
  })

  await test.step('後台關掉開關並發布', async () => {
    await gotoAdmin(page, '/content/site-meta', '網站標題與電話')
    const toggle = page.getByRole('switch', { name: '在官網顯示 30 週年內容' })
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

  await test.step('官網：分頁 404、首頁沒有布幕、選單與頁尾沒有 30 週年', async () => {
    // 官網 SSR 有 3 秒已發布內容快取（web/server/utils/published-site.ts）。
    await expect.poll(async () => (await page.request.get('/anniversary')).status(), { timeout: 15_000 }).toBe(404)
    expect(await homeHtml(page.request)).not.toContain(CURTAIN_MARK)
    await page.goto('/')
    await expect(page.locator('dialog.entrance-curtain')).toHaveCount(0)
    await expect(page.locator('a[href^="/anniversary"]')).toHaveCount(0)
    await expect(page.getByRole('link', { name: '關於常春藤' }).first()).toBeAttached()
  })

  await test.step('打開再發布：30 週年回來', async () => {
    await setAnniversary(true)
    await expect.poll(async () => (await page.request.get('/anniversary')).status(), { timeout: 15_000 }).toBe(200)
    expect(await homeHtml(page.request)).toContain(CURTAIN_MARK)
    await page.goto('/')
    await skipEntrance(page)
    await expect(page.locator('a[href="/anniversary"]').first()).toBeAttached()
  })
})
