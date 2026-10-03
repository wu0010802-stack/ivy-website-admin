import { expect, test } from '@playwright/test'
import { answerMessageBox, gotoAdmin, openAs } from './pages'

// 內容送審（計畫 Task 11 A06、A18）：內容編輯改分校介紹 → 送審 → 官網還看不到 →
// 分校管理者核准並發布 → 官網已發布內容出現新介紹（分校頁已移除，改查 /api/public-site）。兩個角色都只負責義華。

test('內容編輯送審、分校管理者核准後官網才更新', async ({ browser }) => {
  const marker = '（端到端測試：送審後核准發布）'
  const editor = await openAs(browser, 'editor')
  const approver = await openAs(browser, 'campus_admin')
  const visitor = await openAs(browser, null)

  let description = ''
  await test.step('內容編輯修改義華的地址並送審', async () => {
    const { page } = editor
    await gotoAdmin(page, '/content/campus-profile?campus=yihua', '五校介紹')
    const field = page.getByRole('textbox', { name: '地址' })
    await expect(field).not.toHaveValue('')
    description = `${await field.inputValue()}${marker}`
    await field.fill(description)
    // 內容編輯沒有發布權限，只能送審。
    await expect(page.getByRole('button', { name: /發布到官網/ })).toHaveCount(0)
    await page.getByRole('button', { name: '儲存並送審' }).click()
    await expect(page.getByRole('button', { name: '已送審' })).toBeDisabled()
  })

  await test.step('核准前官網仍是舊內容', async () => {
    const { page } = visitor
    // 分校頁已移除，公開內容改看官網讀的已發布內容（SSR 同一份資料）。
    expect(await (await page.request.get('/api/public-site')).text()).not.toContain(marker)
  })

  await test.step('分校管理者打開同一頁核准並發布', async () => {
    const { page } = approver
    await gotoAdmin(page, '/content/campus-profile?campus=yihua', '五校介紹')
    await expect(page.getByRole('textbox', { name: '地址' })).toHaveValue(description)
    await page.getByRole('button', { name: '核准並發布' }).click()
    // 確認框標題寫出內容與校區，並列出和官網目前版本的差異。
    await answerMessageBox(page, '核准並發布「五校介紹（義華）」？', '核准並發布')
    await expect(page.getByRole('button', { name: '核准並發布' })).toHaveCount(0)
  })

  await test.step('已發布內容出現新介紹', async () => {
    const { page } = visitor
    // 官網 SSR 有 3 秒已發布內容快取（web/server/utils/published-site.ts 的
    // PUBLISHED_SITE_TTL_MS），發布後最多晚 3 秒；toContainText 只重試 DOM、不會
    // 重新載入，所以整個「讀取＋檢查」一起重試。
    await expect(async () => {
      expect(await (await page.request.get('/api/public-site')).text()).toContain(marker)
    }).toPass({ timeout: 10_000 })
  })

  await Promise.all([editor.context.close(), approver.context.close(), visitor.context.close()])
})
