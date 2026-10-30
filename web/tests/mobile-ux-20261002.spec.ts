import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// 2026-10-02 手機版審查後的修正：都是版面與樣式，比照 ux-critique-20260929 鎖住原始碼裡的關鍵寫法，
// 避免之後改版時悄悄退回。實測數字見 README 同日段落。
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')

describe('首頁拍立得 WebGL 畫布不造成版面位移', () => {
  it('插入前就把 left／top 放到 -MARGIN，之後只改大小', () => {
    const prints = read('../app/utils/paperPrints.ts')
    const place = prints.indexOf('view.style.left = view.style.top = `${-MARGIN}px`')
    expect(place).toBeGreaterThan(0)
    expect(place).toBeLessThan(prints.indexOf('wrap.append(view)'))
  })
})

describe('小字對比與點擊範圍', () => {
  // 2026-10-30 木頭積木版拿掉太陽走過才亮的餐點：時間軸上的字一律不淡化
  it('環境頁一天五餐的字不淡化（時間、餐名、小字都維持對比）', () => {
    const css = read('../app/assets/css/environment.css')
    expect(css).not.toMatch(/\.renv-day[^{]*\{[^}]*opacity/)
  })
  it('消息頁麵包屑「首頁」左右補到 44px', () => {
    const css = read('../app/assets/css/news-page.css')
    expect(css).toMatch(/\.np-crumb a\{position:relative;/)
    expect(css).toContain('.np-crumb a::before{content:"";position:absolute;inset:0 min(0px,calc(50% - 22px))}')
  })
  it('入學頁 360 以下「每天穿什麼」印章最寬等於欄寬', () => {
    const css = read('../app/assets/css/admission-passport.css')
    const narrow = css.slice(css.indexOf('@media (max-width: 360px)'))
    expect(narrow).toContain('.ap-wear .ap-stamp svg { width: min(62px, 100%); height: auto;')
  })
})
