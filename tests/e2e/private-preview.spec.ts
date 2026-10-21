import { test, expect, request as pwRequest, type APIRequestContext } from '@playwright/test'
import { ADMIN, API_ORIGIN } from './e2e-env'

// 管理者帳號由 start-api.sh 在拋棄式測試庫建立（bootstrap-admin 只從 stdin 讀密碼），
// 這裡只登入、不另建帳號；測試結束把關於區塊的草稿復原，不影響同一輪的其他 spec。
const API_BASE = API_ORIGIN
const ADMIN_EMAIL = ADMIN.email
const ADMIN_PASSWORD = ADMIN.password

test.describe('/preview：私有草稿殼', () => {
  test('未登入直接開 /preview：拒絕看到任何草稿內容', async ({ page }) => {
    await page.goto('/preview')
    await expect(page.locator('.preview-notice')).toContainText('只給已登入的後台管理者')
    await expect(page.locator('.preview-banner')).toHaveCount(0)
  })

  test('/preview 回應一律 private/no-store 與 noindex，跟是否登入無關', async ({ page }) => {
    const res = await page.request.get('/preview')
    expect(res.headers()['cache-control']).toBe('private, no-store')
    expect(res.headers()['x-robots-tag']).toBe('noindex, nofollow')
  })

  test('公開首頁不會受 /preview 存在與否影響（各自獨立渲染）', async ({ page }) => {
    const res = await page.goto('/')
    expect(res?.status()).toBe(200)
    await expect(page.locator('.preview-banner')).toHaveCount(0)
  })
})

test.describe('/preview：已登入管理者可看未發布草稿', () => {
  let apiContext: APIRequestContext
  let csrfToken: string
  let originalAboutPayload: { title: string; since_label: string; body_text: string; caption: string }
  const draftMarker = `E2E-PREVIEW-DRAFT-${Date.now()}`

  test.beforeAll(async () => {
    apiContext = await pwRequest.newContext({ baseURL: API_BASE })
    const loginRes = await apiContext.post('/api/website/v1/auth/login', {
      data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD }
    })
    expect(loginRes.status()).toBe(200)
    csrfToken = (await loginRes.json()).csrf_token

    const item = await apiContext.get('/api/website/v1/admin/content-items/home_about').then((r) => r.json())
    originalAboutPayload = item.latest_revision.payload

    // 建一版草稿但「不發布」——這正是要測的情境：/preview 讀得到，公開站
    // 讀不到。
    await apiContext.post('/api/website/v1/admin/content-items/home_about/revisions', {
      headers: { 'x-csrf-token': csrfToken },
      data: {
        expected_version: item.latest_version,
        payload: {
          title: draftMarker,
          since_label: draftMarker,
          body_text: draftMarker,
          caption: draftMarker
        }
      }
    })
  })

  test.afterAll(async () => {
    // 草稿從未發布過，公開內容本來就沒被動到；这里只要把 latest_revision
    // 復原成測試前的版本，避免留下多一版看起來像真的編輯紀錄的草稿。
    const item = await apiContext
      .get('/api/website/v1/admin/content-items/home_about', {
        headers: { 'x-csrf-token': csrfToken }
      })
      .then((r) => r.json())
    await apiContext.post('/api/website/v1/admin/content-items/home_about/revisions', {
      headers: { 'x-csrf-token': csrfToken },
      data: { expected_version: item.latest_version, payload: originalAboutPayload }
    })
    await apiContext.dispose()
  })

  test('公開首頁看不到未發布的草稿', async ({ page }) => {
    const res = await page.request.get('/')
    expect(await res.text()).not.toContain(draftMarker)
  })

  test('登入後開 /preview 看得到草稿內容與草稿橫幅', async ({ page }) => {
    // /preview 靠瀏覽器 cookie 判斷登入狀態（打 /auth/me），所以要讓
    // 這個瀏覽器 context 真的帶到後端登入時發的 session cookie。
    const loginRes = await page.request.post(`${API_BASE}/api/website/v1/auth/login`, {
      data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD }
    })
    expect(loginRes.status()).toBe(200)

    await page.goto('/preview')
    await expect(page.locator('.preview-banner')).toBeVisible()
    await expect(page.locator('.preview-banner')).toContainText('草稿預覽')
    await expect(page.locator('body')).toContainText(draftMarker)
  })
})
