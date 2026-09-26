import { expect, test, type Locator, type Page } from '@playwright/test'
import { adminApi, findVisit, submitPublicRequest } from './api'
import { gotoAdmin } from './pages'
import { INQUIRY_CAMPUS, storageStatePath } from './stack-env'

// 後台關鍵頁面的像素回歸（計畫 Task 11）。資料固定（每次重建的測試庫＋這裡自己建的
// 案件），動畫由 config 關掉；伺服器產生的時間與隨其他測試變動的數字一律遮罩。
// 基準圖在 macOS 系統字型下拍（tests/stack/visual.spec.ts-snapshots/），其他平台只跑流程
// 不比對（playwright.stack.config.ts 的 ignoreSnapshots）。刻意改版後更新：
//   npm run test:e2e:stack -- visual --update-snapshots

const PARENT = '畫面基準家長'

/** 每張圖都要遮的：側欄待辦數字（其他測試會改變）、所有時間。 */
function dynamicParts(page: Page): Locator[] {
  return [page.locator('.sidebar__badge'), page.locator('time'), page.locator('.num')]
}

async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle')
  // 等 Element Plus 的 loading 遮罩與訊息都消失。
  await expect(page.locator('.el-loading-mask')).toHaveCount(0)
  await page.evaluate(() => document.fonts.ready)
}

test.describe('後台畫面基準', () => {
  test.use({ storageState: storageStatePath('super_admin') })
  let visitId = ''

  test.beforeAll(async () => {
    await submitPublicRequest(INQUIRY_CAMPUS, PARENT, '0912000551')
    const api = await adminApi('super_admin')
    visitId = (await findVisit(api, PARENT)).id
    await api.dispose()
  })

  test('案件明細', async ({ page }) => {
    await gotoAdmin(page, `/visit-requests/${visitId}`, PARENT)
    await settle(page)
    await expect(page).toHaveScreenshot('visit-detail.png', {
      // 送出時間與同意時間是伺服器當下時間。
      mask: [...dynamicParts(page), page.locator('.detail__head p').first(), page.getByRole('cell', { name: /家長勾選同意/ })],
    })
  })

  test('各校預約方式', async ({ page }) => {
    await gotoAdmin(page, '/booking', '各校預約方式')
    await settle(page)
    await expect(page).toHaveScreenshot('booking-settings.png', { mask: dynamicParts(page) })
  })

  test('五校介紹（崇德，其他測試不會改）', async ({ page }) => {
    await gotoAdmin(page, '/content/campus-profile?campus=chongde', '五校介紹')
    await expect(page.getByRole('textbox', { name: '校名' })).not.toHaveValue('')
    await settle(page)
    await expect(page).toHaveScreenshot('campus-profile.png', {
      mask: [...dynamicParts(page), page.locator('.editor__status')],
    })
  })

  test('使用者', async ({ page }) => {
    await gotoAdmin(page, '/users', '使用者')
    await settle(page)
    await expect(page).toHaveScreenshot('users.png', { mask: dynamicParts(page) })
  })
})

test('後台登入頁', async ({ page }) => {
  await page.goto('/admin/login')
  await expect(page.getByRole('button', { name: /登入/ }).first()).toBeVisible()
  await settle(page)
  await expect(page).toHaveScreenshot('login.png')
})
