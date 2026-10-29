// 2026-10-13 精修（以國際設計獎的完成度為標準的全站檢查）：自動稽核找到的版面、圖片與 CLS 問題。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { splitTrailingParen } from '../app/utils/cjkWrap'

const read = (path: string) => readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), 'utf8')

describe('splitTrailingParen（標題結尾括號整段換行）', () => {
  it('拆出結尾的全形括號', () => {
    expect(splitTrailingParen('適應期（上學前三天）')).toEqual({ head: '適應期', paren: '（上學前三天）' })
    expect(splitTrailingParen('註冊了 （快樂來上學）')).toEqual({ head: '註冊了', paren: '（快樂來上學）' })
  })
  it('沒有結尾括號、整句都是括號或括號在中間時不拆', () => {
    expect(splitTrailingParen('開心上學')).toEqual({ head: '開心上學', paren: '' })
    expect(splitTrailingParen('（上學前三天）')).toEqual({ head: '（上學前三天）', paren: '' })
    expect(splitTrailingParen('餐具（碗、湯匙）與水壺')).toEqual({ head: '餐具（碗、湯匙）與水壺', paren: '' })
  })
  it('入學頁新生準備標題用它，括號字級跟著字欄寬縮', () => {
    expect(read('app/components/AdmissionContent.vue')).toContain('phaseTitles = computed(() => admission.value.phases.map(phase => splitTrailingParen(phase.title)))')
    const css = read('app/assets/css/admission-passport.css')
    expect(css).toContain('.ap-phase-head > div { container-type: inline-size; }')
    expect(css).toMatch(/\.ap-keep \{ display: inline-block; font-size: min\(1em, calc\(100cqi \/ \(var\(--ap-keep-chars, 8\) \+ \.3\)\)\); \}/)
  })
})

describe('30 週年開場飛進相框不算版面位移', () => {
  const intro = read('app/components/AnniversaryIntro.vue')
  it('只動 transform 與 clip-path，不再動 left/top/width/height', () => {
    expect(intro).not.toMatch(/left: `\$\{b\.left\}px`/)
    expect(intro).not.toContain('const kf =')
    expect(intro).toContain('clipPath: `inset(${iy}px ${ix}px round ${radius / s}px)`')
    expect(intro).toContain('transform: `translate(${dx}px, ${dy}px) rotate(${b.tilt}) scale(${s})`')
  })
  it('結束時連影片與海報的縮放動畫一起取消', () => {
    expect(intro).toContain('frame.value?.getAnimations({ subtree: true }).forEach((a) => a.cancel())')
  })
})

describe('常春藤環境頁首屏大標兩欄時不擠出孤字', () => {
  it('901 以上字級上限 4.5vw（字欄約 44.4vw、每行 9 字）', () => {
    expect(read('app/assets/css/environment.css')).toContain('@media (width>900px){.renv-hero h1{font-size:clamp(2.3rem,min(1.3rem + 2.8vw,4.5vw),3.6rem)}}')
  })
})

describe('預約第一步選校卡照片 sizes 依 4:3 白框相片算（2026-10-29 視覺方向 B，原本 3:4 直框）', () => {
  it('桌機 340px、761–960 為 45vw（框寬 × 1.43）', () => {
    const form = read('app/components/VisitForm.vue')
    expect(form).toContain("(max-width: 960px) 45vw, 340px')")
    expect(form).not.toContain("(max-width: 960px) 77vw, 620px')")
  })
})

describe('全站選取與原生控制用品牌色', () => {
  it('只引用既有色票', () => {
    expect(read('app/assets/css/styles.css')).toContain('::selection{background:var(--yellow);color:var(--deep)}:root{accent-color:var(--green)}')
  })
})

describe('入學頁第二批（2026-10-13 逐頁檢查）', () => {
  const css = read('app/assets/css/admission-passport.css')
  it('壓章落定後 SVG 字重排，不留第一格的縮小字', () => {
    const motion = read('app/utils/admission-motion.ts')
    expect(motion).toContain("clearProps: 'opacity,transform', onComplete: () => relayoutSvgText(stamp) }")
    expect(motion).toMatch(/svg\.style\.display = 'none'\n {2}void svg\.getBoundingClientRect\(\)\n {2}svg\.style\.display = ''/)
  })
  it('補助券存根的編號縱中橫、跟「補助券」同字型', () => {
    expect(read('app/components/AdmissionContent.vue')).toContain('<small>第<span class="ap-tcy">{{ pad2(i + 1) }}</span>張</small>')
    expect(css).toContain('.ap-tcy { text-combine-upright: all; letter-spacing: 0; }')
    expect(css).toContain('.ap-coupon-stub > span { writing-mode')
    expect(css).toContain('.ap-coupon-stub small { writing-mode: vertical-rl; font-family: var(--ap-serif);')
  })
  it('`.ap ol { margin: 0 }` 權重較高：班別條、答案下一行、叮嚀清單的間距選擇器帶 .ap', () => {
    expect(css).toContain('.ap ol, .ap ul { margin: 0; padding: 0; list-style: none; }')
    expect(css).toMatch(/^\.ap \.ap-slots \{ grid-area: slots;.*margin-top: 28px;/m)
    expect(css).toContain('  .ap .ap-slots { margin-top: 16px; }')
    expect(css).toMatch(/^\.ap \.ap-answer-next \{/m)
    expect(css).toContain('.ap .ap-tips { margin-top: 8px; }')
  })
  it('窄卡片的橢圓章接在日期下面、補助券金額跟著券面寬收', () => {
    expect(css).toContain('@container (width < 440px) { .ap-range-mark { position: static; display: block; margin-top: 8px; } }')
    expect(css).toContain('font-size: clamp(var(--fs-4xl), (100cqi - 64px) / 3.7, var(--fs-5xl))')
    expect(css).not.toContain('.ap-coupons { grid-template-columns: 1fr; max-width: 560px; }')
  })
  it('退費條文一組一列、焦點框用葉綠', () => {
    expect(css).toContain('.ap-clause-body > div { display: grid; grid-template-columns: 7em minmax(0, 1fr); gap: 2px 16px; }')
    expect(css).toContain('.ap-field input:focus-visible { outline: 3px solid var(--leaf); outline-offset: 3px; }')
  })
})

describe('特色教學水彩：顏料色不被 8 位元 canvas 的四捨五入帶偏', () => {
  const wc = read('app/composables/useWatercolor.ts')
  it('逐層只疊濃度（黑色），每幀用 source-in 一次上滿顏料色', () => {
    expect(wc).toContain('target.fillStyle = `rgb(0 0 0 / ${job.alpha})`')
    expect(wc).toContain("tint.globalCompositeOperation = 'source-in'")
    expect(wc).toContain('tint.fillStyle = `rgb(${job.rgb})`')
    expect(wc).not.toContain('job.ctx.fillStyle = `rgb(${job.rgb} / ${job.alpha})`')
  })
})
