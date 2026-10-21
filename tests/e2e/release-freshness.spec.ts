import { test, expect, request as pwRequest, type APIRequestContext } from '@playwright/test'
import { ADMIN, API_ORIGIN } from './e2e-env'

// 管理者帳號由 start-api.sh 在拋棄式測試庫建立（bootstrap-admin 只從 stdin 讀密碼），
// 這裡只登入、不另建帳號；測試結束把首頁文案復原，不影響同一輪的其他 spec。
const API_BASE = API_ORIGIN
const ADMIN_EMAIL = ADMIN.email
const ADMIN_PASSWORD = ADMIN.password

test.describe('SSR 發布新鮮度：發布新 revision 後，新請求、重新整理與之後的站內換頁都讀到新內容', () => {
  // beforeAll／test／afterAll 各自的 `request` fixture是獨立的
  // APIRequestContext（各自的 cookie jar），登入拿到的 session cookie
  // 不會互通，所以整組測試改用自己建立、手動管理生命週期的一個
  // APIRequestContext，確保 session／csrf 從登入到清理都是同一份。
  let apiContext: APIRequestContext
  let csrfToken: string
  let originalHeroPayload: { eyebrow: string; copy_lines: string[]; cta_label: string }

  test.beforeAll(async () => {
    apiContext = await pwRequest.newContext({ baseURL: API_BASE })
    const loginRes = await apiContext.post('/api/website/v1/auth/login', {
      data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD }
    })
    expect(loginRes.status()).toBe(200)
    csrfToken = (await loginRes.json()).csrf_token

    const item = await apiContext.get('/api/website/v1/admin/content-items/home_hero').then((r) => r.json())
    originalHeroPayload = item.latest_revision.payload
  })

  test.afterAll(async () => {
    // 復原成測試前的文案，不讓這組測試改壞其他測試／手動驗證看到的首頁。
    const item = await apiContext
      .get('/api/website/v1/admin/content-items/home_hero', {
        headers: { 'x-csrf-token': csrfToken }
      })
      .then((r) => r.json())
    const revisionRes = await apiContext.post('/api/website/v1/admin/content-items/home_hero/revisions', {
      headers: { 'x-csrf-token': csrfToken },
      data: { expected_version: item.latest_version, payload: originalHeroPayload }
    })
    const revision = await revisionRes.json()
    await apiContext.post('/api/website/v1/admin/content-items/home_hero/publish', {
      headers: { 'x-csrf-token': csrfToken },
      data: { revision_id: revision.latest_revision.id }
    })
    await apiContext.dispose()
  })

  test('發布一版新的 hero 文案後，新的 HTTP 請求在快取 TTL（3 秒）內讀到新內容', async ({ page }) => {
    const marker = `E2E-FRESHNESS-${Date.now()}`

    const item = await apiContext
      .get(`${API_BASE}/api/website/v1/admin/content-items/home_hero`, {
        headers: { 'x-csrf-token': csrfToken }
      })
      .then((r) => r.json())

    const revisionRes = await apiContext.post('/api/website/v1/admin/content-items/home_hero/revisions', {
      headers: { 'x-csrf-token': csrfToken },
      data: {
        expected_version: item.latest_version,
        payload: { eyebrow: marker, copy_lines: [marker], cta_label: marker }
      }
    })
    expect(revisionRes.status()).toBe(201)
    const revision = await revisionRes.json()

    const publishRes = await apiContext.post('/api/website/v1/admin/content-items/home_hero/publish', {
      headers: { 'x-csrf-token': csrfToken },
      data: { revision_id: revision.latest_revision.id }
    })
    expect(publishRes.status()).toBe(200)

    // 1) 發布後 TTL（3 秒，web/server/utils/published-site.ts 的
    //    PUBLISHED_SITE_TTL_MS）內，全新的 HTTP 請求讀到新內容——這裡用
    //    page.request 才會走 baseURL（Nuxt 站），不是直接打後端。之後的
    //    goto／reload 時快取已經更新，照常直接斷言。
    await expect
      .poll(async () => (await page.request.get('/')).text(), { timeout: 10_000 })
      .toContain(marker)

    // 2) 真的用瀏覽器開新頁再重新整理一次，一樣要是新內容。
    await page.goto('/')
    await expect(page.locator('.hero .eyebrow, header .eyebrow, .hero-copy').first()).toBeVisible()
    await expect(page.locator('body')).toContainText(marker)
    await page.reload()
    await expect(page.locator('body')).toContainText(marker)

    // 3) 發布後才開的頁面，站內換頁回首頁沿用的是這次載入的新內容。站內 NuxtLink 換頁
    //    刻意不重抓 /api/published-site（web/app/composables/usePublishedSite.ts，DESIGN
    //    「效能第四輪」），所以發布前就開著的分頁要重新整理才看得到新版；這裡不測那種情況。
    await page.goto('/visit')
    await expect(page.locator('body')).not.toContainText(marker)
    await page.getByRole('link', { name: '首頁' }).first().click()
    await page.waitForURL('**/')
    await expect(page.locator('body')).toContainText(marker)
  })
})
