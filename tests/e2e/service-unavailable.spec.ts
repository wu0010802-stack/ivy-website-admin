import { test, expect } from '@playwright/test'
import { spawn, type ChildProcess } from 'node:child_process'
import path from 'node:path'

// 這支測試故意讓後端連不上，驗證「後端掛掉時公開頁面要回真的錯誤
// （503），不能安靜退回 fixture 假裝是正常內容」（見計畫 Task 8）。
// 不能直接把共用的 127.0.0.1:8000／:3000 backend/Nuxt 停掉去測——那兩個
// port 同時被其他 e2e spec 檔平行使用，殺了會拖垮別的測試。改成另外
// 在一個空 port 上，用已經 build 好的同一份 .output，把
// NUXT_WEBSITE_API_INTERNAL_BASE 指到一個保證連不上的 port（Nitro 在
// process 啟動時仍會吃這個 runtime override，不需要重新 build）。

const WEB_DIR = path.resolve(__dirname, '../../web')
const PORT = 3099
const BASE_URL = `http://127.0.0.1:${PORT}`

let nuxtProcess: ChildProcess

async function waitForServer(url: string, timeoutMs = 15000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      await fetch(url)
      return
    } catch {
      await new Promise((r) => setTimeout(r, 200))
    }
  }
  throw new Error(`server at ${url} did not start within ${timeoutMs}ms`)
}

test.describe('後端不可用時的公開頁面行為', () => {
  test.beforeAll(async () => {
    nuxtProcess = spawn('node', ['.output/server/index.mjs'], {
      cwd: WEB_DIR,
      env: {
        ...process.env,
        PORT: String(PORT),
        NUXT_WEBSITE_API_INTERNAL_BASE: 'http://127.0.0.1:19999' // 保證連不上
      },
      stdio: 'ignore'
    })
    await waitForServer(BASE_URL)
  })

  test.afterAll(() => {
    nuxtProcess?.kill()
  })

  test('首頁回 503，不是假裝正常的 200 fixture 頁面', async ({ request }) => {
    const res = await request.get(BASE_URL)
    expect(res.status()).toBe(503)
    expect(await res.text()).toContain('網站內容服務暫時無法使用')
  })

  test('分校頁與 /visit 頁同樣回 503，不會有些頁面壞、有些頁面看起來正常', async ({ request }) => {
    const campusRes = await request.get(`${BASE_URL}/campuses/minghua`)
    expect(campusRes.status()).toBe(503)

    const visitRes = await request.get(`${BASE_URL}/visit`)
    expect(visitRes.status()).toBe(503)
  })
})
