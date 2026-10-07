import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// 2026-10-06 方向 D：/preview 的即時預覽模式不能把草稿外洩。這幾條用原始碼檢查守住
// （頁面本身要 Nuxt 執行環境，行為另由 tests/stack/editor-live-preview.spec.ts 驗）。
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const page = read('../app/pages/preview.vue')
const files = {
  page,
  live: read('../app/utils/preview-live.ts'),
  highlight: read('../app/utils/preview-highlight.ts'),
  composable: read('../app/composables/useDraftPreview.ts')
}

describe('/preview 即時預覽不外洩草稿', () => {
  it('整頁仍是 client-only、noindex', () => {
    expect(page).toContain('definePageMeta({ ssr: false })')
    expect(page).toContain("{ name: 'robots', content: 'noindex, nofollow' }")
  })

  it('不寫 storage、cookie、useState；postMessage 不用 *', () => {
    for (const [name, source] of Object.entries(files)) {
      expect(source, name).not.toMatch(/localStorage|sessionStorage|useState\(|useCookie\(|document\.cookie/)
      expect(source, name).not.toMatch(/postMessage\([^)]*['"]\*['"]/)
    }
  })

  it('拿到授權之後才掛 message listener；沒授權回 denied', () => {
    const ready = page.indexOf("status.value = 'ready'")
    const listen = page.indexOf("window.addEventListener('message'")
    expect(ready).toBeGreaterThan(0)
    expect(listen).toBeGreaterThan(ready)
    expect(page).toMatch(/status\.value = 'denied'\s*\n\s*receiver\?\.denied\(\)/)
  })

  it('即時預覽模式擋連結換頁、錯誤不換成整頁錯誤畫面；框線用預覽工具列的 token', () => {
    expect(page).toContain("document.addEventListener('click', stayOnPreview, true)")
    expect(page).toContain('onErrorCaptured(')
    expect(page).toMatch(/\.preview-live-hit \{[^}]*var\(--ivy-dev-bar-text\)[^}]*var\(--ivy-dev-bar\)/)
  })
})
