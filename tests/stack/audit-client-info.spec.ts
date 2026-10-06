import { expect, test } from '@playwright/test'
import { gotoAdmin, openAs } from './pages'
import { USERS } from './stack-env'

// 操作紀錄的 IP 與裝置（2026-10-06）：要走真的官網代理才驗得到——IP 是代理從
// X-Forwarded-For 取出、放進 x-website-client-ip 再轉給 API，User-Agent 由代理
// 原樣轉送。登入本身就會留一筆紀錄，用它來驗。

const IPHONE_LINE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari Line/15.10.0'
const IP = '203.0.113.50'

test('從手機 LINE 登入，操作紀錄寫出裝置與 IP（桌機與手機版面）', async ({ browser }) => {
  const { context, page } = await openAs(browser, null, { userAgent: IPHONE_LINE, extraHTTPHeaders: { 'X-Forwarded-For': IP } })
  await page.goto('/admin/login')
  await page.getByLabel('帳號', { exact: true }).fill(USERS.super_admin.email)
  await page.getByLabel('密碼', { exact: true }).fill(USERS.super_admin.password)
  await page.getByRole('button', { name: '登入', exact: true }).click()
  await expect(page).not.toHaveURL(/\/admin\/login/)

  await gotoAdmin(page, '/audit', '操作紀錄')
  const source = page.locator('[data-test="audit-source"]').filter({ hasText: IP }).first()
  await expect(source).toHaveText(`iPhone・LINE・${IP}`)
  await expect(source).toHaveAttribute('title', IPHONE_LINE)

  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.locator('[data-test="audit-source-mobile"]').filter({ hasText: IP }).first()).toBeVisible()
  await context.close()
})
