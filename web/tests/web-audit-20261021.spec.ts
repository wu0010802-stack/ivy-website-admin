import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { beforeAll, describe, expect, it } from 'vitest'
import { ANNI_INTRO_SESSION_KEY } from '../app/utils/anniversary/timeline'
import { HERO_MIN_DOWNLINK_MBPS } from '../app/utils/media-policy'

// 2026-10-21 正式站效能與畫面掃描的前五條修正（README 同日段落）。
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')

describe('three 不進任何頁面的 SSR prefetch', () => {
  type Entry = { src?: string; file?: string; prefetch?: boolean }
  let hook: (manifest: Record<string, Entry>) => void
  beforeAll(async () => {
    ;(globalThis as { defineNuxtConfig?: unknown }).defineNuxtConfig = (config: unknown) => config
    const config = (await import('../nuxt.config')).default as { hooks: { 'build:manifest': typeof hook } }
    hook = config.hooks['build:manifest']
  })
  it('三個來源都排除：three-lite 共用 chunk、three 套件本身、布幕引擎', () => {
    const manifest: Record<string, Entry> = {
      'utils/three-lite.ts': { src: 'utils/three-lite.ts', file: 'DoRHXMqb.js', prefetch: true },
      'node_modules/three/build/three.module.js': { src: 'node_modules/three/build/three.module.js', prefetch: true },
      'utils/entranceCurtain.ts': { src: 'utils/entranceCurtain.ts', prefetch: true },
      'utils/paperPrints.ts': { src: 'utils/paperPrints.ts', prefetch: true }
    }
    hook(manifest)
    expect(manifest['utils/three-lite.ts']!.prefetch).toBe(false)
    expect(manifest['node_modules/three/build/three.module.js']!.prefetch).toBe(false)
    expect(manifest['utils/entranceCurtain.ts']!.prefetch).toBe(false)
    expect(manifest['utils/paperPrints.ts']!.prefetch).toBe(true)
  })
})

describe('30 週年開場影片的連線閘門', () => {
  const intro = read('../app/components/AnniversaryIntro.vue')
  const template = /innerHTML: `([^`]+)`/.exec(intro)![1]!
  const gate = template
    .replace('${ANNI_INTRO_SESSION_KEY}', ANNI_INTRO_SESSION_KEY)
    .replace('${HERO_MIN_DOWNLINK_MBPS}', String(HERO_MIN_DOWNLINK_MBPS))

  function run(connection?: object) {
    const dataset: Record<string, string> = {}
    runInNewContext(gate, {
      document: { documentElement: { dataset } },
      location: { hash: '' },
      matchMedia: () => ({ matches: false }),
      sessionStorage: { getItem: () => null },
      navigator: { connection },
      setTimeout: () => 0
    })
    return dataset.anniIntro
  }

  it('沒有連線資訊（Safari／Firefox）或快速網路照常自動播', () => {
    expect(run()).toBe('pending')
    expect(run({ effectiveType: '4g', downlink: 10 })).toBe('pending')
  })
  it.each([
    { saveData: true }, { effectiveType: '3g' }, { effectiveType: '2g' }, { effectiveType: 'slow-2g' },
    { effectiveType: '4g', downlink: 1.6 }
  ])('慢速或省流量不自動播：%j', (connection) => {
    expect(run(connection)).toBeUndefined()
  })
})

describe('鍵盤焦點看得見', () => {
  it('米白膠囊裡的焦點框用膠囊字色，不是米白', () => {
    const css = read('../app/assets/css/studio.css')
    expect(css).toContain('body:has(:is(.studio-hero,.is-pill-nav)) .header-pill :focus-visible {outline-color:var(--pill-fg)}')
    expect(css).not.toContain('.header-pill :focus-visible {outline-color:var(--paper)}')
  })
  it('加入行事曆選單的焦點有外框，高對比模式也有', () => {
    const calendar = read('../app/components/HomeEventCalendar.vue')
    expect(calendar).toContain('.hn-cal-menu a:focus-visible { outline: 2px solid var(--ivy-news-green); outline-offset: -2px; }')
    expect(calendar).not.toMatch(/\.hn-cal-menu a:focus-visible \{[^}]*outline: none/)
    expect(calendar).toContain('.hn-cal-menu a:focus-visible { outline-color: Highlight; }')
  })
})

describe('預約頁 LCP 圖', () => {
  it('第一張校區照 fetchpriority=high，網址帶校區時不給', () => {
    const form = read('../app/components/VisitForm.vue')
    expect(form).toContain(':fetchpriority="i === 0 && !initialCampus ? \'high\' : undefined"')
  })
})
