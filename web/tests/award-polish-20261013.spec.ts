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

describe('預約第一步選校卡照片 sizes 依直框裁切算', () => {
  it('桌機 620px、761–960 為 77vw（卡寬 × 2.56）', () => {
    const form = read('app/components/VisitForm.vue')
    expect(form).toContain("(max-width: 960px) 77vw, 620px')")
    expect(form).not.toContain("(max-width: 960px) 30vw, 260px')")
  })
})

describe('全站選取與原生控制用品牌色', () => {
  it('只引用既有色票', () => {
    expect(read('app/assets/css/styles.css')).toContain('::selection{background:var(--yellow);color:var(--deep)}:root{accent-color:var(--green)}')
  })
})
