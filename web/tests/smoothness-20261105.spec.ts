import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// 2026-11-05 前台流暢度：全站共用的兩條（README 同日段落、DESIGN.md 同日章節）。
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const files = (dir: string, ext: RegExp) => readdirSync(fileURLToPath(new URL(dir, import.meta.url))).filter((name) => ext.test(name)).map((name) => `${dir}/${name}`)
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '')
const cssSources = [
  ...files('../app/assets/css', /\.css$/),
  ...files('../app/components', /\.vue$/),
  ...files('../app/pages', /\.vue$/),
  '../app/app.vue',
  '../app/error.vue'
]

describe('不要用 body／html 當 :has 的錨點再接後代選擇器', () => {
  // body:has(…) X：body 底下任何節點插入或移除，Blink 都要重新判定 body 的 :has，
  // 失效範圍是整棵子樹（量到每次 630–820 個元素重算）。只作用在 body／html 自己的 :has 可以留著。
  it.each(cssSources)('%s', (path) => {
    const css = stripComments(read(path))
    expect(css).not.toMatch(/(?:^|[\s,}(])(?:body|html):has\((?:[^()]|\([^()]*\))*\)\s*(?:[>~+]\s*)?[.#[:a-z*]/im)
  })

  it('頁首的首頁與膠囊狀態改掛在 header 自己的 class 上', () => {
    const header = read('../app/components/SiteHeader.vue')
    expect(header).toContain("defineProps<{ content: SiteContent; hero?: boolean }>()")
    expect(header).toContain("'is-hero-page': hero")
    expect(header).toContain("'is-pill-nav': usePanel")
    expect(read('../app/pages/index.vue')).toContain('<SiteHeader :content="data.content" hero />')
    expect(read('../app/pages/preview.vue')).toContain(`<SiteHeader :content="draft" :hero="page === 'home'" />`)
    const studio = read('../app/assets/css/studio.css')
    expect(studio).toContain('body .header.is-hero-page {\n  position:fixed;')
    expect(studio).toContain('body :is(.is-hero-page,.is-pill-nav) .header-pill {')
    // --hero-line 只有 .header-top 讀，定義跟著搬到 header
    expect(studio).toMatch(/body \.header\.is-hero-page \{\n {2}--hero-line:/)
  })
})

describe('@property 只在每頁一開始就載的 studio.css 註冊', () => {
  // 其他頁的 NuxtLink 會預取首頁與 /visit，Vite 把那些頁的 CSS 掛進目前頁；載入後才註冊新屬性，整頁重算一次。
  it.each(cssSources.filter((path) => !path.endsWith('/studio.css')))('%s 沒有 @property', (path) => {
    expect(stripComments(read(path))).not.toContain('@property')
  })

  it('首頁元件用到的六個屬性都在 studio.css', () => {
    const studio = read('../app/assets/css/studio.css')
    for (const name of ['--tab-art-opacity', '--tab-art-brightness', '--tab-colour-opacity', '--tab-draw', '--news-paper-progress', '--home-footer-progress']) {
      expect(studio).toMatch(new RegExp(`@property ${name} ?\\{`))
    }
    expect(studio).toContain("@property --tab-draw{syntax:'<number>';inherits:true;initial-value:1}")
  })
})
