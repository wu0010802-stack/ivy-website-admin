import { afterEach, describe, expect, it, vi } from 'vitest'
import { FLIP_MS } from '../app/utils/printFlip'
import { OPENER_DELAY_MS, OPENER_KEY, markOpenerShown, onScreen, openerShown, seenEnough, startsFaceDown, tapDuringOpen } from '../app/utils/printOpener'

describe('F 第一張翻開進場：什麼時候背面朝上', () => {
  it('只有第一張、這個工作階段還沒示範過、載入當下不在畫面內', () => {
    expect(startsFaceDown(0, false, false)).toBe(true)
    expect(startsFaceDown(1, false, false)).toBe(false)
    expect(startsFaceDown(0, true, false)).toBe(false)
    // 錨點、回上一頁、捲動還原時已經看得到：不要讓正面一閃變背面
    expect(startsFaceDown(0, false, true)).toBe(false)
  })

  it('停留 0.8 秒才翻', () => {
    expect(OPENER_DELAY_MS).toBe(800)
  })
})

describe('自己翻開的途中被點', () => {
  it('翻開那 0.95 秒內的點擊不算（讀者要的就是翻過去，不要原路翻回背面）', () => {
    expect(tapDuringOpen(0)).toBe(true)
    expect(tapDuringOpen(FLIP_MS - 1)).toBe(true)
    expect(tapDuringOpen(FLIP_MS)).toBe(false)
    // 從沒自己翻開過、或計時錯亂
    expect(tapDuringOpen(Number.POSITIVE_INFINITY)).toBe(false)
    expect(tapDuringOpen(-1)).toBe(false)
  })
})

describe('看得夠多才翻', () => {
  const view = 800

  it('可見高度達卡片的 60%', () => {
    expect(seenEnough(100, 600, view)).toBe(true)
    // 500px 高的卡片露出 290px（58%）還不夠，露出 300px（60%）就翻
    expect(seenEnough(510, 1010, view)).toBe(false)
    expect(seenEnough(500, 1000, view)).toBe(true)
    // 從上緣離開也一樣算
    expect(seenEnough(-210, 290, view)).toBe(false)
    expect(seenEnough(-200, 300, view)).toBe(true)
  })

  it('卡片比視窗高時，改看視窗的 60%（手機橫放也翻得到）', () => {
    expect(seenEnough(-100, 1100, view)).toBe(true)
    expect(seenEnough(330, 1530, view)).toBe(false)
    expect(seenEnough(320, 1520, view)).toBe(true)
  })

  it('不在畫面內或沒有尺寸就不算', () => {
    expect(seenEnough(900, 1400, view)).toBe(false)
    expect(seenEnough(-600, -100, view)).toBe(false)
    expect(seenEnough(100, 100, view)).toBe(false)
    expect(seenEnough(100, 600, 0)).toBe(false)
  })

  it('onScreen：有任何一部分在畫面內', () => {
    expect(onScreen(799, 1200, view)).toBe(true)
    expect(onScreen(800, 1200, view)).toBe(false)
    expect(onScreen(-400, 1, view)).toBe(true)
    expect(onScreen(-400, 0, view)).toBe(false)
  })
})

describe('每次工作階段一次（sessionStorage）', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('沿用舊首張偷看的 key，看過就記下', () => {
    const store = new Map<string, string>()
    vi.stubGlobal('sessionStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value)
    })
    expect(OPENER_KEY).toBe('ivy-day-peek')
    expect(openerShown()).toBe(false)
    markOpenerShown()
    expect(store.get('ivy-day-peek')).toBe('1')
    expect(openerShown()).toBe(true)
  })

  it('sessionStorage 無法使用時當作沒看過，記錄也不丟錯', () => {
    vi.stubGlobal('sessionStorage', {
      getItem: () => { throw new Error('blocked') },
      setItem: () => { throw new Error('blocked') }
    })
    expect(openerShown()).toBe(false)
    expect(() => markOpenerShown()).not.toThrow()
  })
})
