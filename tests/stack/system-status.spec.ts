import { expect, test } from '@playwright/test'
import { readMail } from './mail'
import { expectNoHorizontalOverflow, gotoAdmin, openAs } from './pages'
import { USERS } from './stack-env'

// 系統狀態頁（2026-10-15）：總管理者看四區、寄測試信（stack 寫進本機 sink）；手機不溢出；櫃台看不到。
const SUBJECT = '【常春藤官網後台】測試信'
const mine = () => readMail((mail) => mail.to === USERS.super_admin.email && mail.subject === SUBJECT)

test('總管理者看系統狀態、寄測試信；櫃台看不到這一頁', async ({ browser }) => {
  const { context, page } = await openAs(browser, 'super_admin')
  await gotoAdmin(page, '/system-status', '系統狀態')
  // 正向對照：總管理者的側欄看得到「系統狀態」，底下櫃台那段的 toHaveCount(0) 才不是因為側欄沒渲染而空過。
  const superNav = page.getByRole('navigation', { name: '主選單' })
  await expect(superNav.getByRole('link', { name: '系統狀態' })).toBeVisible()
  for (const title of ['對外服務設定', '背景工作', '公開資料', '通知與發布']) {
    await expect(page.getByRole('heading', { level: 2, name: title })).toBeVisible()
  }
  const smtp = page.locator('li.status-row[data-key="smtp"]')
  await expect(smtp).toContainText('本機資料夾')

  const before = (await mine()).length
  await smtp.getByRole('button', { name: '寄一封測試信給我' }).click()
  await expect(page.getByRole('status').filter({ hasText: '已寄到' })).toBeVisible()
  await expect.poll(async () => (await mine()).length).toBe(before + 1)

  // 等「重新整理」真的打了一次 GET 並回來，再看畫面；資料時間在點擊前就已經看得到，不能只靠它。
  const refreshed = page.waitForResponse(
    (response) => response.request().method() === 'GET' && new URL(response.url()).pathname.endsWith('/admin/system-status'),
  )
  await page.getByRole('button', { name: '重新整理' }).click()
  expect((await refreshed).status()).toBe(200)
  await expect(page.getByRole('button', { name: '重新整理' })).toBeEnabled()
  await expect(page.getByText(/資料時間/)).toBeVisible()
  await page.screenshot({ path: 'output/playwright/system-status-1440.png', fullPage: true })
  await context.close()

  const mobile = await openAs(browser, 'super_admin', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  await gotoAdmin(mobile.page, '/system-status', '系統狀態')
  // h1 出來時列表還在骨架載入；等四區與寄信列都載入後才量溢出，否則量到的是骨架畫面。
  for (const title of ['對外服務設定', '背景工作', '公開資料', '通知與發布']) {
    await expect(mobile.page.getByRole('heading', { level: 2, name: title })).toBeVisible()
  }
  await expect(mobile.page.locator('li.status-row[data-key="smtp"]').getByRole('button', { name: '寄一封測試信給我' })).toBeVisible()
  await expectNoHorizontalOverflow(mobile.page)
  await mobile.page.screenshot({ path: 'output/playwright/system-status-390.png', fullPage: true })
  await mobile.context.close()

  const desk = await openAs(browser, 'reception')
  await desk.page.goto('/admin/system-status')
  await expect(desk.page).toHaveURL(/\/admin\/$/)
  // 先等側欄渲染出櫃台看得到的連結，再斷言看不到「系統狀態」，否則側欄還沒出來時 count 也是 0。
  const deskNav = desk.page.getByRole('navigation', { name: '主選單' })
  await expect(deskNav.getByRole('link', { name: '營運總覽' })).toBeVisible()
  await expect(deskNav.getByRole('link', { name: '系統狀態' })).toHaveCount(0)
  await desk.context.close()
})
