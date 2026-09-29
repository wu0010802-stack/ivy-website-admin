import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { bandPaths, ROSETTES, rosettePaths, trochoid } from '../app/utils/guilloche'
import { ovalLayout, roundLayout, splitStampText, squareLayout } from '../app/utils/passport-stamp'
import { createAdmissionMotion } from '../app/utils/admission-motion'

// 2026-09-28 入學資訊頁改成「入學護照」（比稿 design/admission-theme-directions-20260928/ B）。
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const points = (d: string) => [...d.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])] as const)

describe('防偽細紋（utils/guilloche.ts）', () => {
  it('hypotrochoid 走完 r / gcd(R, r) 圈會回到起點', () => {
    const list = points(trochoid(100, 35, 58, 1, 0, 0))
    expect(list.length).toBe(Math.round((35 / 5) * 180) + 1)
    expect(list.at(-1)![0]).toBeCloseTo(list[0]![0], 0)
    expect(list.at(-1)![1]).toBeCloseTo(list[0]![1], 0)
  })

  it.each(Object.keys(ROSETTES) as (keyof typeof ROSETTES)[])('%s 玫瑰紋每一條都畫在邊長 size 的正方形裡', (kind) => {
    const size = 320
    const paths = rosettePaths(kind, size)
    expect(paths).toHaveLength(ROSETTES[kind].length)
    for (const [x, y] of paths.flatMap(points)) {
      expect(x).toBeGreaterThanOrEqual(0)
      expect(x).toBeLessThanOrEqual(size)
      expect(y).toBeGreaterThanOrEqual(0)
      expect(y).toBeLessThanOrEqual(size)
    }
  })

  it('波浪帶鋪滿整個寬度、上下不超出帶高，同樣寬度算出同樣的線', () => {
    const paths = bandPaths(600)
    expect(paths).toHaveLength(7)
    for (const [x, y] of paths.flatMap(points)) {
      expect(y).toBeGreaterThanOrEqual(0)
      expect(y).toBeLessThanOrEqual(24)
      expect(x).toBeLessThanOrEqual(603)
    }
    expect(Math.max(...points(paths[0]!).map(([x]) => x))).toBeGreaterThanOrEqual(600)
    expect(bandPaths(600)).toEqual(paths)
  })
})

describe('印章版面（utils/passport-stamp.ts）', () => {
  it('兩個字以下一行，三個字以上從中間拆兩行（前半多一個字）', () => {
    expect(splitStampText('已備')).toEqual(['已備'])
    expect(splitStampText('預約參觀')).toEqual(['預約', '參觀'])
    expect(splitStampText('開心上學囉')).toEqual(['開心上', '學囉'])
  })

  it('方章：兩行字上下置中、字級是邊長的 0.3', () => {
    const layout = squareLayout('保留名額', 92)
    expect(layout.texts.map((t) => t.text)).toEqual(['保留', '名額'])
    expect(layout.texts[0]!.size).toBeCloseTo(27.6, 1)
    expect((layout.texts[0]!.y + layout.texts[1]!.y) / 2).toBeCloseTo(46, 0)
  })

  it('圓章：環狀字不超過上半圈，label 模式上小下大', () => {
    const layout = roundLayout({ ring: '常春藤幼兒園・分班對照', lines: ['115 學年度', '中班'], size: 230 })
    const pr = 230 / 2 - 230 * 0.14
    expect(layout.ring!.length).toBeLessThanOrEqual(Math.PI * pr * 0.86 + 0.1)
    expect(layout.texts[1]!.size).toBeGreaterThan(layout.texts[0]!.size)
  })

  it('橢圓章：字數多時縮小，不超出橢圓寬度', () => {
    const layout = ovalLayout('寶貝的生日在這', 150, 44)
    expect(layout.texts[0]!.size * 7).toBeLessThanOrEqual(150 * 0.72 + 0.1)
    expect(ovalLayout('制服', 104, 50, true).shapes[0]!.dashed).toBe(true)
  })
})

describe('印章元件（components/PassportStamp.vue）', () => {
  // 單元測試不經 Nuxt（沒有 .vue 外掛），只檢查原始碼的約定
  const stamp = read('../app/components/PassportStamp.vue')

  it('整個印章 aria-hidden；兩層共用頁面上的 #ap-bleed／#ap-ink 濾鏡，濾鏡定義在頁面裡', () => {
    expect(stamp).toMatch(/<span class="ap-stamp"[^>]*aria-hidden="true"/)
    expect(stamp).toContain("filter: 'url(#ap-bleed)'")
    expect(stamp).toContain("filter: 'url(#ap-ink)'")
    const page = read('../app/components/AdmissionContent.vue')
    expect(page).toContain('<filter id="ap-ink"')
    expect(page).toContain('<filter id="ap-bleed"')
  })

  it('圓章的環狀字引用自己的路徑 id（useId，SSR 與瀏覽器一致）', () => {
    expect(stamp).toContain('const ringId = useId()')
    expect(stamp).toContain(':id="ringId"')
    expect(stamp).toContain(':href="`#${ringId}`"')
  })
})

describe('蓋章動態（utils/admission-motion.ts）', () => {
  it('壓下與拿起都在補間結束時呼叫 done；離開頁面時 kill 還在跑的補間', () => {
    const completes: (() => void)[] = []
    const killed: string[] = []
    const timeline = (vars: { onComplete: () => void }) => {
      completes.push(vars.onComplete)
      const tl = { fromTo: () => tl, kill: () => killed.push('timeline') }
      return tl
    }
    const to = (_el: unknown, vars: { onComplete: () => void }) => {
      completes.push(vars.onComplete)
      return { kill: () => killed.push('tween') }
    }
    const motion = createAdmissionMotion({ timeline, to } as never)
    const el = { style: { getPropertyValue: () => '-7deg' }, querySelector: () => null }
    const pressed = vi.fn()
    const lifted = vi.fn()
    motion.press(el as never, pressed, 0.2)
    motion.lift(el as never, lifted)
    completes[0]!()
    expect(pressed).toHaveBeenCalledOnce()
    motion.destroy()
    expect(killed).toEqual(['tween'])
    expect(lifted).not.toHaveBeenCalled()
  })
})

describe('入學護照頁面（AdmissionContent.vue）', () => {
  const component = read('../app/components/AdmissionContent.vue')
  const css = read('../app/assets/css/admission-passport.css')

  it('這頁不放預約參觀：主體沒有往 /visit 的連結', () => {
    expect(component).not.toMatch(/(to|href)="\/visit/)
    expect(component).not.toContain('adm-visit')
  })

  it('大章寫「分班對照」「預計入學」，不寫「核定」「錄取」（避免家長以為名額已確定）', () => {
    expect(component).toContain('常春藤幼兒園・分班對照')
    expect(component).toContain('常春藤幼兒園・預計入學')
    const code = component.replace(/<!--[\s\S]*?-->|\/\/.*$/gm, '')
    expect(code).not.toMatch(/核定|錄取|核准/)
  })

  it('gsap 只在瀏覽器端動態載入，不進頁面主 chunk', () => {
    expect(component).toContain("import('gsap')")
    expect(component).not.toMatch(/from 'gsap'/)
  })

  it('顏色一律走 token：樣式表不寫色碼', () => {
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\((?!var\()|oklch\(/i)
    expect(read('../app/assets/css/tokens.css')).toMatch(/--ivy-passport-red: oklch\(/)
  })

  it('文案不用破折號', () => {
    const text = component.replace(/<!--[\s\S]*?-->|\/\/.*$/gm, '')
    expect(text).not.toContain('—')
  })
})
