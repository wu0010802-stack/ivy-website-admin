// 2026-10-20 手機孩子的一天：停下滑動、卡片已在畫面上才換成 WebGL 紙，換手那一刻字距與紙色不能跳。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { fillSpaced } from '../app/utils/paperPrints'

const read = (path: string) => readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), 'utf8')
const paper = read('app/utils/paperPrints.ts')

// 不支援 ctx.letterSpacing 的 2D context：每個字寬 10
function fakeCtx(align: CanvasTextAlign = 'left') {
  const calls: Array<[string, number]> = []
  const ctx = {
    textAlign: align,
    measureText: (text: string) => ({ width: Array.from(text).length * 10 }),
    fillText: (text: string, x: number) => calls.push([text, x])
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls }
}

describe('WebGL 紙照 CSS 字距畫字', () => {
  it('小標、標題、時間戳都讀 computed letter-spacing', () => {
    expect(paper).toContain('kickerSpacing: spacingOf(kickerEl)')
    expect(paper).toContain('titleSpacing: spacingOf(titleEl)')
    expect(paper).toContain('stampSpacing: spacingOf(stamp)')
    expect(paper).not.toContain('ctx.fillText(copy.kicker')
    expect(paper).not.toContain('ctx.fillText(copy.time')
  })
  it('沒有字距就整串畫一次', () => {
    const { ctx, calls } = fakeCtx()
    fillSpaced(ctx, '早安', 5, 0, 0)
    expect(calls).toEqual([['早安', 5]])
  })
  it('不支援 ctx.letterSpacing 時逐字畫，每個字後面加字距', () => {
    const { ctx, calls } = fakeCtx()
    fillSpaced(ctx, '早安入', 0, 0, 2)
    expect(calls).toEqual([['早', 0], ['安', 12], ['入', 24]])
  })
  it('靠右對齊照 CSS 把最後一個字的字距也算進去，畫完還原對齊', () => {
    const { ctx, calls } = fakeCtx('right')
    fillSpaced(ctx, '08', 100, 0, 1)
    expect(calls).toEqual([['0', 78], ['8', 89]])
    expect(ctx.textAlign).toBe('right')
  })
})

describe('WebGL 紙平放時跟 CSS 紙同色', () => {
  it('主光白光、環境光補到平放時合計 π', () => {
    expect(paper).toContain('new three.DirectionalLight(0xffffff, KEY_LIGHT)')
    expect(paper).toContain('Math.PI - KEY_LIGHT * (key.position.z / key.position.length())')
    expect(paper).not.toContain('DirectionalLight(0xfff4e0')
  })
})
