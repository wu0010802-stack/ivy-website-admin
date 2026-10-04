import { expect, test } from '@playwright/test'
import { readMail } from './mail'
import { gotoAdmin, openAs } from './pages'
import { RESET_TARGET } from './stack-env'

// 總管理者寄重設密碼連結 → 同事從信裡的連結設定新密碼 → 用新密碼登入（2026-10-03）。
// 信由 API 同步寫進本機 sink（start-api.sh 的 WEBSITE_NOTIFICATION_EMAIL_SINK_DIR），不用等背景工作。
const NEW_PASSWORD = 'e2e-reset-new-password-2'

test('總管理者寄重設連結，同事從信裡設定新密碼後用新密碼登入，同一條連結不能再用', async ({ browser }) => {
  const { context: adminContext, page: admin } = await openAs(browser, 'super_admin')
  await gotoAdmin(admin, '/users', '使用者')
  const row = admin.getByRole('row', { name: new RegExp(RESET_TARGET.email.replace(/\./g, '\\.')) })
  await row.getByRole('button', { name: '重設密碼' }).click()
  const dialog = admin.getByRole('dialog', { name: /的密碼/ })
  await expect(dialog.getByRole('radio', { name: /寄重設連結/ })).toBeChecked()
  await dialog.getByRole('button', { name: '寄出重設連結' }).click()
  await expect(dialog.getByText(`已寄出重設連結到 ${RESET_TARGET.email}`)).toBeVisible()
  await dialog.getByRole('button', { name: '完成' }).click()
  await adminContext.close()

  const mails = await readMail(mail => mail.to === RESET_TARGET.email && mail.subject.includes('重設密碼'))
  expect(mails).toHaveLength(1)
  const url = mails[0]!.body.match(/https?:\/\/\S+\/admin\/reset-password#token=[A-Za-z0-9_-]+/)?.[0]
  expect(url, mails[0]!.body).toBeTruthy()

  const { context, page } = await openAs(browser, null)
  await page.goto(url!)
  await expect(page.getByText(RESET_TARGET.email)).toBeVisible()
  expect(page.url()).not.toContain('token=')
  await page.getByLabel('新密碼', { exact: true }).fill(NEW_PASSWORD)
  await page.getByLabel('再輸入一次新密碼').fill(NEW_PASSWORD)
  await page.getByRole('button', { name: '設定新密碼' }).click()
  await expect(page.getByText('密碼已更新，請用新密碼登入')).toBeVisible()

  await page.getByLabel('帳號', { exact: true }).fill(RESET_TARGET.email)
  await page.getByLabel('密碼', { exact: true }).fill(NEW_PASSWORD)
  await page.getByRole('button', { name: '登入', exact: true }).click()
  await expect(page).not.toHaveURL(/\/admin\/login/)

  await page.goto(url!)
  await expect(page.getByText('這個重設連結已經用過了')).toBeVisible()
  await context.close()
})
