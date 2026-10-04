import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { adminApi } from './api'
import { gotoAdmin } from './pages'
import { API_ORIGIN, storageStatePath } from './stack-env'

// 影片背景轉檔（start-api.sh 設 WEBSITE_MEDIA_VIDEO_PROCESSING=background，跟正式站同一條
// 路徑）：上傳請求只排工作就回應，卡片先顯示處理中；API 程序內的背景迴圈（app/workers/
// media_loop.py）轉好後，卡片自己換成擷取的畫面。
test.use({ storageState: storageStatePath('super_admin') })

const FILE_NAME = 'e2e-clip.mp4'
const PROCESSING = /處理中|轉檔中/

/**
 * ffmpeg 產生 2 秒、320×240 的 H.264 樣本（CI 的 e2e job 有裝 ffmpeg）。用 60fps：
 * 原檔已經能直接播、轉出來又沒小多少時後端會沿用原檔、不產生轉檔版本
 * （app/media/processing.py should_keep_original），超過 30fps 才一定會有兩個版本。
 */
function tinyMp4(): Buffer {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'e2e-video-'))
  try {
    const file = path.join(dir, 'clip.mp4')
    execFileSync('ffmpeg', [
      '-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=s=320x240:d=2:r=60',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', file,
    ])
    return readFileSync(file)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('素材庫上傳影片：先顯示處理中，背景轉好後自己變成可用', async ({ page }) => {
  test.setTimeout(90_000)
  await gotoAdmin(page, '/media', '素材庫')
  await page.getByRole('button', { name: '上傳素材' }).first().click()
  const dialog = page.getByRole('dialog', { name: '上傳素材' })
  await dialog.locator('input[type="file"]').setInputFiles({ name: FILE_NAME, mimeType: 'video/mp4', buffer: tinyMp4() })
  await dialog.getByRole('button', { name: '上傳 1 個檔案' }).click()
  // 全部上傳成功時對話框會自己關掉（見 media.spec.ts）。
  await expect(dialog).toBeHidden({ timeout: 30_000 })

  const card = page.locator('article.media', { has: page.locator('.media__name', { hasText: FILE_NAME }) })
  await expect(card).toBeVisible()
  // 對話框關掉前列表已重讀過一次，那時工作才剛排進佇列。
  await expect(card.getByText(PROCESSING).first()).toBeVisible()
  // 處理中的卡片會自己重讀（不必重新整理）：背景轉好後換成擷取的畫面。
  await expect(card.locator('img')).toBeVisible({ timeout: 60_000 })
  await expect(card.getByText(PROCESSING)).toHaveCount(0)

  const api = await adminApi('super_admin')
  const assets = await api.get<{ original_filename: string; status: string; variants: { kind: string }[] }[]>('/admin/media')
  await api.dispose()
  const asset = assets.find((item) => item.original_filename === FILE_NAME)
  expect(asset?.status).toBe('ready')
  expect(asset?.variants.map((v) => v.kind).sort()).toEqual(['poster', 'video_desktop', 'video_mobile'])

  // health 回報迴圈有開、最近一次轉好的時間。
  const health = await (await page.request.get(`${API_ORIGIN}/api/website/v1/health`)).json()
  expect(health.media_jobs.enabled).toBe(true)
  expect(health.media_jobs.last_processed_at).toBeTruthy()
})
