import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// 2026-09-30 首屏改版（design/hero-brush-mockup-20260930/watercolor.html 定案：筆刷／金／原位／滿版裁切／關鍵字 -2°）。
// 畫面寫法沒有獨立 util，比照 ux-critique-20260929 鎖住原始碼的關鍵寫法。
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const hero = read('../app/components/HeroVideo.vue')
const css = read('../app/assets/css/studio.css')
const fixture = JSON.parse(read('../server/data/site-fixture.json'))

describe('首屏文字', () => {
  it('不顯示小標（後台欄位保留，官網不畫）', () => {
    expect(hero).not.toContain('hero.eyebrow')
    expect(hero).not.toContain('class="eyebrow"')
  })

  it('主標不加標點；標點欄位有值時才畫', () => {
    expect(fixture.home.hero.titleParts.punctAfterBefore).toBe('')
    expect(fixture.home.hero.titleParts.punctAfterGrowingWord).toBe('')
    expect(hero).toContain('v-if="heroText.titleParts.punctAfterBefore" class="punct"')
    expect(hero).toContain('v-if="heroText.titleParts.punctAfterGrowingWord" class="punct"')
  })

  it('重點詞是金色乾刷色塊，不是黃色底線', () => {
    expect(hero).not.toContain('hero-underline')
    expect(hero).toContain('<svg class="hero-swatch" viewBox="0 0 300 100" preserveAspectRatio="none" aria-hidden="true">')
    expect(hero).toContain('<filter id="hero-brush"')
    expect(hero.match(/<path d="M2\d\d \d+L\d+ \d+L\d+ \d+L\d+ \d+Z" \/>/g)).toHaveLength(5)
    expect(hero).toContain('<span class="hero-key-text">{{ heroText.titleParts.growingWord }}</span>')
    expect(css).toContain('.studio-hero .hero-swatch g {fill:var(--gold);opacity:.75}')
  })

  it('字與色塊一起歪 -2°，用 rotate 屬性（不和進場的 transform 互相覆蓋）', () => {
    expect(css).toMatch(/\.studio-hero \.hero-key \{[^}]*rotate:-2deg;transform-origin:0 70%/)
    expect(css).not.toMatch(/\.studio-hero \.hero-key \{[^}]*transform:rotate/)
  })

  it('減少動態時色塊直接是完成狀態', () => {
    expect(css).toMatch(/@media\(prefers-reduced-motion:reduce\) \{\n  \.studio-hero-copy>\*,\.studio-hero \.hero-swatch \{animation:none!important/)
    expect(css).toContain('.studio-hero .hero-swatch {clip-path:none}')
  })
})
