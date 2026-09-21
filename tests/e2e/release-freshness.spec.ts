import { test, expect, request as pwRequest, type APIRequestContext } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import path from 'node:path'

const API_BASE = process.env.WEBSITE_API_BASE ?? 'http://127.0.0.1:8000'
const BACKEND_DIR = process.env.WEBSITE_BACKEND_DIR ?? path.resolve(__dirname, '../../backend')
const DB_URL =
  process.env.WEBSITE_TEST_ADMIN_DB_URL ?? 'postgresql+asyncpg://yilunwu@localhost/ivy_website_dev'

const ADMIN_EMAIL = `e2e-freshness-${Date.now()}@ivy.example`
const ADMIN_PASSWORD = 'e2e-freshness-password-123'

/**
 * 用 CLI 的互動式 bootstrap-admin 建測試帳號，而不是直接寫 DB 或用測試
 * 專用的後門 API——密碼故意不接受命令列參數／不寫 log 是刻意的安全設計
 * （見 backend/app/cli.py bootstrap_admin 的註解），這裡照樣走 stdin。
 */
function createAdminUser() {
  execFileSync('uv', ['run', 'python', '-m', 'app.cli', 'bootstrap-admin'], {
    cwd: BACKEND_DIR,
    input: `${ADMIN_EMAIL}\n${ADMIN_PASSWORD}\n${ADMIN_PASSWORD}\n`,
    env: {
      ...process.env,
      WEBSITE_ENVIRONMENT: 'development',
      WEBSITE_DATABASE_URL: DB_URL,
      WEBSITE_TEST_DATABASE_URL:
        process.env.WEBSITE_TEST_DATABASE_URL ?? 'postgresql+asyncpg://yilunwu@localhost/ivy_website_test',
      WEBSITE_MEDIA_ROOT: './var/media',
      WEBSITE_SESSION_SECRET: 'dev-local-session-secret-32-bytes-min-xxxx'
    }
  })
}

function deleteAdminUser() {
  execFileSync(
    'psql',
    [
      DB_URL.replace('postgresql+asyncpg://', 'postgresql://'),
      '-c',
      `DELETE FROM users WHERE email = '${ADMIN_EMAIL}';`
    ],
    { stdio: 'ignore' }
  )
}

test.describe('SSR 發布新鮮度：發布新 revision 後，新請求／重新整理／站內換頁都讀到新內容', () => {
  // beforeAll／test／afterAll 各自的 `request` fixture是獨立的
  // APIRequestContext（各自的 cookie jar），登入拿到的 session cookie
  // 不會互通，所以整組測試改用自己建立、手動管理生命週期的一個
  // APIRequestContext，確保 session／csrf 從登入到清理都是同一份。
  let apiContext: APIRequestContext
  let csrfToken: string
  let originalHeroPayload: { eyebrow: string; copy_lines: string[]; cta_label: string }

  test.beforeAll(async () => {
    createAdminUser()
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
    deleteAdminUser()
  })

  test('發布一版新的 hero 文案後，新的 HTTP 請求立刻讀到新內容', async ({ page }) => {
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

    // 1) 全新的 HTTP 請求（非快取）立刻讀到新內容——這裡用 page.request
    //    才會走 baseURL（Nuxt 站），不是直接打後端。
    const homeRes = await page.request.get('/')
    expect(await homeRes.text()).toContain(marker)

    // 2) 真的用瀏覽器開新頁再重新整理一次，一樣要是新內容。
    await page.goto('/')
    await expect(page.locator('.hero .eyebrow, header .eyebrow, .hero-copy').first()).toBeVisible()
    await expect(page.locator('body')).toContainText(marker)
    await page.reload()
    await expect(page.locator('body')).toContainText(marker)

    // 3) 站內換頁（先去分校頁，再點回首頁）也要讀到新內容，不是永久快取
    //    同一個 useAsyncData key 而卡住舊資料。
    await page.goto('/campuses/minghua')
    await expect(page.locator('body')).not.toContainText(marker)
    await page.getByRole('link', { name: '首頁' }).first().click()
    await page.waitForURL('**/')
    await expect(page.locator('body')).toContainText(marker)
  })
})
