import { expect, test } from '@playwright/test'
import { adminApi, findVisit, submitPublicRequest } from './api'
import { gotoAdmin, openAs } from './pages'
import { INQUIRY_CAMPUS, SLOTS_CAMPUS } from './stack-env'

// 角色與校區範圍（規格 7 權限表）：側欄只列得到的頁面、直接輸入網址會被導回、
// 他校案件在清單看不到，API 也回 404（後端才是真正的權限檢查）。

const YIHUA_PARENT = '義華範圍家長'
const MINGHUA_PARENT = '明華範圍家長'

test.beforeAll(async () => {
  await submitPublicRequest(SLOTS_CAMPUS, YIHUA_PARENT, '0912000331')
  await submitPublicRequest(INQUIRY_CAMPUS, MINGHUA_PARENT, '0912000332')
})

test('接待人員：只有參觀預約相關頁面，只看得到義華的案件', async ({ browser }) => {
  const { context, page } = await openAs(browser, 'reception')
  await gotoAdmin(page, '/visit-requests', '參觀案件')
  const nav = page.getByRole('navigation', { name: '主選單' })
  await expect(nav.getByRole('link', { name: '參觀案件' })).toBeVisible()
  await expect(nav.getByText('官網內容')).toHaveCount(0)
  await expect(nav.getByRole('link', { name: '使用者' })).toHaveCount(0)

  await page.getByRole('textbox', { name: /搜尋家長/ }).fill('範圍家長')
  await expect(page.getByRole('link', { name: YIHUA_PARENT }).first()).toBeVisible()
  await expect(page.getByRole('link', { name: MINGHUA_PARENT })).toHaveCount(0)

  await page.goto('/admin/content/campus-profile')
  await expect(page).toHaveURL(/\/admin\/$/)
  await expect(page.getByRole('heading', { level: 1, name: '營運總覽' })).toBeVisible()
  await context.close()
})

test('內容編輯：沒有參觀預約，直接輸入網址會回到內容頁', async ({ browser }) => {
  const { context, page } = await openAs(browser, 'editor')
  await page.goto('/admin/visit-requests')
  await expect(page).toHaveURL(/\/admin\/content\/campus-profile/)
  await expect(page.getByRole('heading', { level: 1, name: '五校介紹' })).toBeVisible()
  const nav = page.getByRole('navigation', { name: '主選單' })
  await expect(nav.getByRole('button', { name: '參觀預約' })).toHaveCount(0)
  await expect(nav.getByRole('button', { name: '全站與素材' })).toBeVisible()
  await context.close()
})

test('分校管理者：他校案件與使用者管理都進不去', async ({ browser }) => {
  const superAdmin = await adminApi('super_admin')
  const minghua = await findVisit(superAdmin, MINGHUA_PARENT)
  await superAdmin.dispose()

  const campusAdmin = await adminApi('campus_admin')
  const forbidden = await campusAdmin.context.get(`/api/website/v1/admin/visit-requests/${minghua.id}`)
  expect(forbidden.status()).toBe(404)
  await campusAdmin.dispose()

  const { context, page } = await openAs(browser, 'campus_admin')
  await page.goto(`/admin/visit-requests/${minghua.id}`)
  await expect(page.getByRole('alert').filter({ hasText: '不在你的校區範圍' })).toBeVisible()
  await expect(page.getByRole('heading', { level: 1, name: MINGHUA_PARENT })).toHaveCount(0)
  await page.goto('/admin/users')
  await expect(page).toHaveURL(/\/admin\/$/)
  await context.close()
})
