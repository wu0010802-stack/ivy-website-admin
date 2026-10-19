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

describe('關於頁 900px 以下：上翻畫冊（2026-10-19 取代上下兩頁的立體書）', () => {
  const css = read('../app/assets/css/about-flipbook.css')
  it('書最寬 520px 置中（平板直拿不會撐滿）；上下排開時卡紙寬用百分比，釘住（頁高固定）才用舞台高 cqh', () => {
    expect(css).toContain('.afb-book{position:relative;display:grid;gap:22px;width:min(100% - 28px,520px);margin-inline:auto}')
    expect(css).toContain('.is-cover .afb-pop{width:86%}')
    expect(css).toContain('.afb.is-pinned .is-cover .afb-pop{width:min(86cqw,calc((92cqh - 44px) / .75))}')
    // 頁高不固定時 cqh 算成 0（2026-10-19 實測卡紙變成一條線）：用到 cqh 的規則都要在 .afb.is-pinned 底下
    const rules = css.replace(/\/\*[\s\S]*?\*\//g, '').split('}').filter((rule) => /\d+cqh|var\(--map-h\)/.test(rule))
    expect(rules.length).toBeGreaterThan(5)
    for (const rule of rules) expect(rule.trim()).toMatch(/^(@media[^{]*\{\s*)?\.afb\.is-pinned /)
  })
})

describe('小字對比與點擊範圍', () => {
  it('環境頁還沒到的餐點只淡化手寫大標，時間與小字不淡化', () => {
    const css = read('../app/assets/css/environment.css')
    expect(css).toContain('.renv-day.is-live .renv-meal:not(.is-lit) b{opacity:.72}')
    expect(css).not.toContain('.renv-meal:not(.is-lit){opacity')
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
