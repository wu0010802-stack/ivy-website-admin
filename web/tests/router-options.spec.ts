import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// app/router.options.ts 照抄 Nuxt 預設的 scrollBehavior，只多兩處差異（2026-09-29 手機審查）。
// Nuxt 升版改了預設實作時，這裡會失敗：拿新的原檔比對、把修正帶進 app/router.options.ts，再更新雜湊。
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const nuxtRoot = dirname(createRequire(import.meta.url).resolve('nuxt/package.json'))
// 4.6.2 → 4.6.3 只差 //#region 註解標記，scrollBehavior 實作沒變（2026-11-01 逐行 diff）
const COPIED_FROM = '6cf07ab3a537f65634a6ac6679512c5bce59f28660603badea754b9aa6abc188' // Nuxt 4.6.3

describe('換頁捲動（app/router.options.ts）', () => {
  it('Nuxt 預設的 scrollBehavior 沒變（變了要重新比對照抄的內容）', () => {
    const source = readFileSync(join(nuxtRoot, 'dist/pages/runtime/router.options.js'))
    expect(createHash('sha256').update(source).digest('hex')).toBe(COPIED_FROM)
  })

  it('只多兩處差異：初次載入與重新整理交給瀏覽器還原、返回首頁等版面穩定', () => {
    const options = read('../app/router.options.ts')
    expect(options).toContain('if (from === START_LOCATION && (!to.hash || _isRestoredLoad())) return savedPosition ?? false')
    expect(options).toMatch(/entry\?\.type === 'reload' \|\| entry\?\.type === 'back_forward'/)
    expect(options).toContain("const waitForLayout = Boolean(savedPosition) && to.path === '/'")
    // 其餘照預設：同路徑 hash、scrollToTop meta、等 page:loading:end 與換頁過場
    expect(options).toContain("nuxtApp.hooks.hookOnce('page:loading:end'")
    expect(options).toContain("nuxtApp['~transitionPromise']")
    expect(options).toContain('to.meta.scrollToTop')
  })
})
