import { readFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { adminApi } from './api'
import { answerMessageBox, gotoAdmin } from './pages'
import { ROOT, storageStatePath } from './stack-env'

// 素材（計畫 Task 11 A23、A24）：素材庫上傳 → 內容頁從素材庫選圖 → 發布 → 官網用新照片。
test.use({ storageState: storageStatePath('super_admin') })

const FILE_NAME = 'e2e-about-photo.webp'
const ALT = '端到端測試：孩子們笑著指向前方'

test('素材庫上傳照片，在「關於常春藤」選用並發布到官網', async ({ page }) => {
  await test.step('素材庫上傳一張照片並填圖片說明', async () => {
    await gotoAdmin(page, '/media', '素材庫')
    await page.getByRole('button', { name: '上傳素材' }).first().click()
    const dialog = page.getByRole('dialog', { name: '上傳素材' })
    await dialog.locator('input[type="file"]').setInputFiles({
      name: FILE_NAME,
      mimeType: 'image/webp',
      buffer: readFileSync(path.join(ROOT, 'web/public/assets/about-curious.webp')),
    })
    await dialog.getByPlaceholder('簡短描述照片內容').fill(ALT)
    await dialog.getByRole('button', { name: '上傳 1 個檔案' }).click()
    await expect(dialog.getByRole('button', { name: '關閉' })).toBeEnabled({ timeout: 30_000 })
    await dialog.getByRole('button', { name: '關閉' }).click()
    await expect(page.locator('.media__name', { hasText: FILE_NAME })).toBeVisible()
  })

  const api = await adminApi('super_admin')
  const assets = await api.get<{ id: string; original_filename: string; status: string }[]>('/admin/media')
  const asset = assets.find((item) => item.original_filename === FILE_NAME)
  expect(asset?.status).toBe('ready')

  await test.step('「關於常春藤」從素材庫選這張照片', async () => {
    await gotoAdmin(page, '/content/home-about', '關於常春藤')
    await page.getByRole('button', { name: '從素材庫選照片' }).click()
    const picker = page.getByRole('dialog', { name: '選擇照片' })
    await picker.getByRole('button', { name: new RegExp(FILE_NAME) }).click()
    await expect(picker).toBeHidden()
    await expect(page.locator('.slot__name', { hasText: FILE_NAME })).toBeVisible()
    await page.getByRole('button', { name: '儲存並發布到官網' }).click()
    await answerMessageBox(page, '發布到官網？', '儲存並發布')
    await expect(page.getByRole('button', { name: '發布到官網' })).toBeDisabled()
  })

  const item = await api.get<{ latest_revision: { payload: { photo: { media_id: string } | null } } }>(
    '/admin/content-items/home_about',
  )
  expect(item.latest_revision.payload.photo?.media_id).toBe(asset?.id)
  await api.dispose()

  await test.step('官網首頁的關於區塊改用素材庫的照片', async () => {
    await page.goto('/')
    const photo = page.locator(`img[src*="${asset?.id}"], img[srcset*="${asset?.id}"]`).first()
    await expect(photo).toBeAttached()
    await expect(photo).toHaveAttribute('alt', ALT)
  })
})
