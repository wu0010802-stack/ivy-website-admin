import { expect, test, type Page } from '@playwright/test'
import { taipeiDate } from './api'
import { answerMessageBox, expectNoHorizontalOverflow, gotoAdmin, openAs } from './pages'

// 2026-11-16：招生統計 → 廣告成效。總管理者看得到 Google 列（stack 沒設 GA4，顯示「未設定」），
// 新增本月 ChatGPT 花費 3,000 → 表上出現 ChatGPT 列與 3,000 → 刪除後列消失。
// 自己建、自己清：開頭先清掉上一次中斷留下的同月同平台花費，不依賴別支 spec 的資料。

const ADS_PATH = '/admissions-stats?sub=ads'
const MONTH = taipeiDate(0).slice(0, 7)
const DELETE_LABEL = `刪除 ${MONTH} ChatGPT`

async function removeLeftover(page: Page): Promise<void> {
  const leftover = page.getByRole('button', { name: DELETE_LABEL })
  if (await leftover.count()) {
    await leftover.click()
    await answerMessageBox(page, '刪除這筆花費？', '刪除')
    await expect(leftover).toHaveCount(0)
  }
}

for (const { name, device } of [
  { name: '1440', device: { viewport: { width: 1440, height: 900 } } },
  { name: '390', device: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
] as const) {
  test(`${name}px：廣告成效表有 Google「未設定」，新增、刪除 ChatGPT 花費`, async ({ browser }) => {
    const { context, page } = await openAs(browser, 'super_admin', device)
    await gotoAdmin(page, ADS_PATH, '招生統計')
    await expect(page.getByRole('tab', { name: '廣告成效', selected: true })).toBeVisible()
    const table = page.locator('.ads-main')
    await expect(table).toBeVisible()
    await removeLeftover(page)

    await expect(table.getByRole('row', { name: /Google/ })).toContainText('未設定')
    await expect(table.getByRole('row', { name: /ChatGPT/ })).toHaveCount(0)
    await expectNoHorizontalOverflow(page)

    try {
      await page.locator('[data-test="ads-add"]').click()
      const dialog = page.getByRole('dialog', { name: '新增花費' })
      await expect(dialog).toBeVisible()
      await dialog.locator('.el-select').click()
      await page.getByRole('option', { name: 'ChatGPT' }).click()
      await dialog.locator('[data-test="ads-amount"] input').fill('3000')
      await dialog.locator('[data-test="ads-save"]').click()
      await expect(dialog).toBeHidden()

      const row = table.getByRole('row', { name: /ChatGPT/ })
      await expect(row).toBeVisible()
      await expect(row).toContainText('3,000')
      await expectNoHorizontalOverflow(page)
    } finally {
      await page.reload()
      await expect(page.locator('.ads-main')).toBeVisible()
      await removeLeftover(page)
    }
    await expect(table.getByRole('row', { name: /ChatGPT/ })).toHaveCount(0)
    await context.close()
  })
}
