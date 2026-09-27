import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { CURRICULUM_ENTER_CLASS, REVEAL_CORE, bloomGeometry, shouldBloomIntoCurriculum } from '../app/utils/curriculumEnter'

// 進入特色教學頁的水彩暈開（2026-09-28 使用者選 A「中央暈開」，mock：design/curriculum-enter-transition-20260928）。
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const ok = { initial: false, popstate: false, supported: true, reducedMotion: false, forcedColors: false, masksReady: true }

describe('什麼時候暈開', () => {
  it('從其他頁點連結進入 /curriculum 才暈開', () => {
    expect(shouldBloomIntoCurriculum('/curriculum', '/environment', ok)).toBe(true)
    expect(shouldBloomIntoCurriculum('/curriculum', '/', ok)).toBe(true)
  })
  it('其他換頁一律不動（2026-09-26「不開全站換頁動畫」仍然有效）', () => {
    expect(shouldBloomIntoCurriculum('/environment', '/curriculum', ok)).toBe(false)
    expect(shouldBloomIntoCurriculum('/admission', '/', ok)).toBe(false)
    expect(shouldBloomIntoCurriculum('/curriculum', '/curriculum', ok)).toBe(false)
  })
  it('首次進站、上一頁／下一頁（含 iPhone 左滑返回）不暈開', () => {
    expect(shouldBloomIntoCurriculum('/curriculum', '/', { ...ok, initial: true })).toBe(false)
    expect(shouldBloomIntoCurriculum('/curriculum', '/environment', { ...ok, popstate: true })).toBe(false)
  })
  it('不支援 View Transitions、減少動態、強制色彩、遮罩還沒產生好：直接換頁', () => {
    for (const key of ['supported', 'masksReady'] as const) expect(shouldBloomIntoCurriculum('/curriculum', '/', { ...ok, [key]: false })).toBe(false)
    for (const key of ['reducedMotion', 'forcedColors'] as const) expect(shouldBloomIntoCurriculum('/curriculum', '/', { ...ok, [key]: true })).toBe(false)
  })
})

describe('暈開的幾何', () => {
  it.each([[1440, 900], [390, 844], [1024, 768], [320, 568]])('%i×%i：從畫面中央開始，最後的實心核心蓋得到四個角', (width, height) => {
    const { x, y, size } = bloomGeometry(width, height)
    expect([x, y]).toEqual([width / 2, height / 2])
    expect(size * REVEAL_CORE).toBeGreaterThanOrEqual(Math.hypot(width / 2, height / 2))
  })
})

describe('樣式與掛載', () => {
  const css = read('../app/assets/css/styles.css')
  const plugin = read('../app/plugins/curriculum-enter.client.ts')
  it('只在 html.curriculum-enter 期間生效：頁首有名字留在原位、新頁帶遮罩、舊頁不淡出', () => {
    expect(CURRICULUM_ENTER_CLASS).toBe('curriculum-enter')
    expect(css).toContain('.curriculum-enter .header{view-transition-name:site-header}')
    expect(css).toContain('.curriculum-enter::view-transition-old(root){animation:none}')
    expect(css).toMatch(/\.curriculum-enter::view-transition-new\(root\)\{[^}]*mask-image:var\(--cur-enter-blob-1\)/)
    expect(css).toContain('@keyframes curriculum-bloom')
    // 頁首的名字不能常駐，否則每次換頁都會多一個 view transition 群組
    expect(css).not.toMatch(/(^|[}\n])\.header\{[^}]*view-transition-name/)
  })
  it('新頁畫好（page:finish）才讓瀏覽器拍新畫面，並有逾時與錯誤收尾', () => {
    expect(plugin).toContain("nuxtApp.hook('page:finish'")
    expect(plugin).toContain("nuxtApp.hook('vue:error'")
    expect(plugin).toContain('CURRICULUM_ENTER_TIMEOUT')
    expect(plugin).toContain("addEventListener('popstate'")
  })
  it('頁首與頁尾的一般 <a> 連到 /curriculum 時改走路由（否則整頁載入不會有過場），其他連結不攔', () => {
    expect(plugin).toContain("document.addEventListener('click'")
    expect(plugin).toMatch(/url\.pathname !== CURRICULUM_PATH\) return/)
    // 只在這次真的會暈開時才攔；不會播就讓瀏覽器照原本方式整頁載入
    expect(plugin).toMatch(/if \(!willBloom\(url\.pathname, router\.currentRoute\.value\.path, false\)\) return\s+event\.preventDefault\(\)/)
  })
})
