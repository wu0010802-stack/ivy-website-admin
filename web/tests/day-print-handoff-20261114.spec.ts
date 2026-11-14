// @vitest-environment happy-dom
// 2026-11-14 手機孩子的一天：卡片已在畫面上才換成 WebGL 紙，換手那一刻照片、文字、陰影都不能跳（實機錄影回報）。
// 根因與量測見 README 2026-11-14；這裡鎖住會讓兩版對不上的幾個點。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { linesOf, parseShadows } from '../app/utils/paperPrints'

// happy-dom 走瀏覽器端轉換：new URL 的第一個參數寫成樣板字串會被 Vite 當成資源 glob，所以直接傳完整相對路徑
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const paper = read('../app/utils/paperPrints.ts')
const lite = read('../app/utils/three-lite.ts')
const css = read('../app/assets/css/styles.css')

describe('WebGL 紙平放時照片跟 CSS 版同色', () => {
  it('紙面用純漫射材質：有鏡面反射的材質平放時照片暗部整片亮 15～30 階', () => {
    expect(paper).toContain('new three.MeshLambertMaterial({ map: frontTex, alphaTest: 0.5 })')
    expect(paper).toContain('new three.MeshLambertMaterial({ map: backTex, alphaTest: 0.5 })')
    // 暖身場景要用同一種材質，shader program 才會命中快取
    expect(paper).toContain('new three.MeshLambertMaterial({ map: tex, alphaTest: 0.5 })')
    expect(paper).not.toContain('new three.MeshStandardMaterial')
    expect(lite).toContain('MeshLambertMaterial,')
  })
  it('照片上不另外疊亮面漸層與外框線（CSS 版顯影完沒有這兩樣）', () => {
    expect(paper).not.toContain('createLinearGradient')
    expect(paper).not.toContain('strokeRect')
  })
})

describe('WebGL 紙的字跟 DOM 落在同一個位置', () => {
  it('正面小標、標題、時間戳的基線都照 CSS 行框算', () => {
    expect(paper).toContain('baselineIn(ctx, k.y, k.h)')
    expect(paper).toContain('let y = baselineIn(ctx, 0, style.titleLine)')
    expect(paper).toContain('baselineIn(ctx, st.y, st.h)')
    expect(paper).not.toMatch(/\* 0\.7[68]\b/)
    expect(paper).not.toContain('st.h * 0.82')
  })
  it('時間戳量斜切前的版面框、繞框中心斜切，光暈讀 CSS 的 text-shadow', () => {
    expect(paper).toContain("[wrap.querySelector<HTMLElement>('.print-stamp'), { transform: 'none' }]")
    expect(paper).toContain('ctx.transform(1, 0, stampSkew, 1, 0, 0)')
    expect(paper).toContain('ctx.shadowBlur = style.stampGlow.blur * DPR')
    expect(paper).not.toContain("'rgba(255,138,0,.75)'")
  })
  it('背面三段照 DOM 實際的斷行畫，量不到才自己折行', () => {
    expect(paper).toContain('lines.story ?? wrapLines(ctx, copy.story, s.w)')
    expect(paper).toContain('lines.question ?? wrapLines(ctx, copy.question, q.w)')
    expect(paper).toContain('lines.answer ?? wrapLines(ctx, copy.answer, an.w)')
  })
})

describe('linesOf：DOM 實際排出來的每一行', () => {
  afterEach(() => vi.restoreAllMocks())

  // 每個字一個框；tops 依字元順序給（undefined＝沒有框，例如行尾被收掉的空白）
  function layout(tops: Array<number | undefined>) {
    let call = 0
    vi.spyOn(Range.prototype, 'getClientRects').mockImplementation(() => {
      const top = tops[call++]
      return (top === undefined ? [] : [{ top, height: 20 }]) as unknown as DOMRectList
    })
  }

  it('top 往下跳就是新的一行', () => {
    const p = document.createElement('p')
    p.textContent = '摸一摸看一看'
    layout([0, 0, 0, 28, 28, 28])
    expect(linesOf(p)).toEqual(['摸一摸', '看一看'])
  })
  it('同一行裡換字型的小幅高低差不算換行', () => {
    const p = document.createElement('p')
    p.textContent = '30分鐘'
    layout([2, 2, 0, 0])
    expect(linesOf(p)).toEqual(['30分鐘'])
  })
  it('沒有框的字（行尾空白）留在原本那一行', () => {
    const p = document.createElement('p')
    p.textContent = 'ab cd'
    layout([0, 0, undefined, 28, 28])
    expect(linesOf(p)).toEqual(['ab ', 'cd'])
  })
  it('跨多個文字節點（<br>）也照樣分行', () => {
    const h = document.createElement('h3')
    h.append('早安', document.createElement('br'), '今天')
    layout([0, 0, 29, 29])
    expect(linesOf(h)).toEqual(['早安', '今天'])
  })
  it('量不到任何框（沒有版面的環境）回 null，讓呼叫端退回 wrapLines', () => {
    const p = document.createElement('p')
    p.textContent = '早安'
    layout([undefined, undefined])
    expect(linesOf(p)).toBeNull()
    expect(linesOf(null)).toBeNull()
  })
})

describe('WebGL 紙平放時的陰影就是 CSS 版那道 box-shadow', () => {
  it('parseShadows：顏色在前（computed 的寫法），顏色函式裡的逗號不切', () => {
    expect(parseShadows('rgba(31, 46, 38, 0.05) 0px 2px 0px 0px, rgba(31, 46, 38, 0.3) 6px 18px 46px 0px')).toEqual([
      { color: 'rgba(31, 46, 38, 0.05)', x: 0, y: 2, blur: 0, spread: 0 },
      { color: 'rgba(31, 46, 38, 0.3)', x: 6, y: 18, blur: 46, spread: 0 }
    ])
  })
  it('parseShadows：顏色在後、沒寫模糊與擴散、text-shadow 三個長度', () => {
    expect(parseShadows('0px 0px 6px oklch(0.7 0.19 52 / 0.75)')).toEqual([{ color: 'oklch(0.7 0.19 52 / 0.75)', x: 0, y: 0, blur: 6, spread: 0 }])
    expect(parseShadows('-1.5px 2px #203f32')).toEqual([{ color: '#203f32', x: -1.5, y: 2, blur: 0, spread: 0 }])
  })
  it('parseShadows：none、空字串、inset 都不算', () => {
    expect(parseShadows('none')).toEqual([])
    expect(parseShadows('')).toEqual([])
    expect(parseShadows('rgb(0, 0, 0) 0px 0px 4px 0px inset')).toEqual([])
  })
  it('陰影值放在 --print-shadow，CSS 版與 WebGL 紙讀同一份', () => {
    expect(css).toContain('--print-shadow:0 2px 0 rgb(var(--ink) / .05),6px 18px 46px rgb(var(--ink) / .3)')
    expect(css).toMatch(/\.print::after\{[^}]*box-shadow:var\(--print-shadow\)/)
    expect(paper).toContain("resolveShadowsOn(view, 'var(--print-shadow)')")
  })
  it('光源投的影子只在抬起時出現，平放時先畫 CSS 那道再疊上紙', () => {
    expect(paper).toContain('shadowMat.opacity = SHADOW_OPACITY * (1 - 0.35 * height) * aloft')
    const rest = paper.indexOf('if (aloft < 1) drawRestShadow(1 - aloft, isBackTurn(Math.round(rot)))')
    const copy = paper.indexOf('viewCtx!.drawImage(renderer.domElement, 0, 0, view.width, view.height)')
    expect(rest).toBeGreaterThan(-1)
    expect(copy).toBeGreaterThan(rest)
  })
  it('懸停加深的陰影只給滑鼠：觸控點完 :hover 會黏住，換成 WebGL 紙時陰影會縮回去', () => {
    expect(css).toMatch(/@media\(hover:hover\) and \(pointer:fine\)\{\.print-wrap:hover \.print::after\{/)
    expect(css.match(/\.print-wrap:hover \.print::after/g)).toHaveLength(1)
  })
})
