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

  it('卸載時拿掉 message listener 與點擊攔截（行為由 preview-live-page.spec 驗）', () => {
    expect(page).toContain("window.removeEventListener('message'")
    expect(page).toContain("document.removeEventListener('click', stayOnPreview, true)")
    expect(page).toMatch(/onBeforeUnmount\(\(\) => \{\s*unmounted = true\s*stopLive\?\.\(\)/)
  })

  it('錯誤只在有即時草稿時吞、而且記在 iframe 的 console；畫失敗回報 failed（和找不到位置的 none 分開），已存草稿畫不出來不送 ready', () => {
    // 吞錯誤的兩個地方（computed 的 catch、onErrorCaptured）都要看 liveDraft：沒有即時草稿時照常丟出去。
    expect(page).toContain('if (!live || !liveDraft.value || !lastRendered) throw error')
    expect(page).toMatch(/onErrorCaptured\(\(error\) => \{\s*if \(!live\) return undefined\s*if \(!liveDraft\.value\) \{\s*savedRenderFailed = true\s*return undefined\s*\}\s*reportLiveFailure\(error\)/)
    expect(page).toMatch(/function reportLiveFailure\(error: unknown\) \{\s*liveRenderFailed = true\s*console\.error\(/)
    expect(page).toMatch(/if \(liveRenderFailed\) \{\s*receiver\.applied\(next\.seq, 'failed'\)/)
    expect(page).toContain("receiver.applied(next.seq, liveRenderFailed ? 'failed' : hit)")
    // 取得授權、等一幀後確認已存草稿畫得出來（draft 有值）才掛 listener 並送 ready。
    const check = page.indexOf('if (unmounted || savedRenderFailed || !draft.value) return')
    expect(check).toBeGreaterThan(page.indexOf("status.value = 'ready'"))
    expect(page.indexOf("window.addEventListener('message'")).toBeGreaterThan(check)
    expect(page.indexOf('receiver.ready()')).toBeGreaterThan(page.indexOf("window.addEventListener('message'"))
  })

  it('即時模式有路由守衛擋住程式化換頁；首頁五校「預約參觀」尊重前面 handler 的 preventDefault（行為由 preview-live-page.spec 與 stack e2e 驗）', () => {
    expect(page).toContain('onBeforeRouteLeave(() => !live)')
    // 沒有早退的話，stayOnPreview 擋掉連結後 onBookingClick 仍會自己 navigateTo 帶著 view transition 離開 /preview。
    const board = read('../app/components/CampusBoard.vue')
    expect(board).toMatch(/function onBookingClick\(event: MouseEvent\) \{\s*if \(event\.defaultPrevented \|\| /)
  })

  it('即時預覽模式擋連結換頁、錯誤不換成整頁錯誤畫面；框線用預覽工具列的 token', () => {
    expect(page).toContain("document.addEventListener('click', stayOnPreview, true)")
    expect(page).toContain('onErrorCaptured(')
    expect(page).toMatch(/\.preview-live-hit \{[^}]*var\(--ivy-dev-bar-text\)[^}]*var\(--ivy-dev-bar\)/)
  })
})
