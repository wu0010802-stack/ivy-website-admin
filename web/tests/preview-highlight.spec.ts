// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  activatePreviewBlock,
  CAROUSEL_PLAYBACK_BUTTON,
  CAROUSEL_PLAYING_LABEL,
  findProbeElement,
  highlightPreview,
  PREVIEW_HIT_CLASS,
  pausePreviewCarousel,
  revealInFrame
} from '../app/utils/preview-highlight'
import type { LiveFocus } from '../app/utils/preview-live'

// 2026-10-06 方向 D：「改哪格亮哪格」用改到的那段文字在區塊裡找位置；happy-dom 量不到版面，
// 「畫得出來」改用 hidden 屬性判斷。
const rendered = (el: Element) => !el.closest('[hidden]')
const focus = (overrides: Partial<LiveFocus> = {}): LiveFocus => ({ block: 'site-footer', campusKey: null, probe: null, mark: true, ...overrides })
const originalIntoView = Element.prototype.scrollIntoView
// 播放鈕的 class（CAROUSEL_PLAYBACK_BUTTON 是「#campuses .campus-playback」）：假播放鈕與守門測試都從常數拆，不另寫一份字串。
const PLAYBACK_CLASS = CAROUSEL_PLAYBACK_BUTTON.split(' ').pop()!.slice(1)
const PAUSED_LABEL = '開始分校自動播放'

afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
  Element.prototype.scrollIntoView = originalIntoView
})

describe('findProbeElement', () => {
  it('找含這段文字、最深的元素；空白差異不算', () => {
    document.body.innerHTML = '<footer class="footer"><div><p>常春藤  教育機構</p><ul><li>義華校 <a>07-392-8366</a></li></ul></div></footer>'
    const root = document.querySelector('footer')!
    expect(findProbeElement(root, '07-392-8366', rendered)?.tagName).toBe('A')
    expect(findProbeElement(root, '常春藤 教育機構', rendered)?.tagName).toBe('P')
    expect(findProbeElement(root, '不存在的字', rendered)).toBeNull()
    expect(findProbeElement(root, '常', rendered)).toBeNull()
  })

  it('隱藏的副本不算，找畫得出來的那份', () => {
    document.body.innerHTML = '<footer class="footer"><p class="mobile" hidden>新標語</p><p class="desktop">新標語</p></footer>'
    expect(findProbeElement(document.querySelector('footer')!, '新標語', rendered)?.className).toBe('desktop')
  })

  it('不往 script、style、noscript 裡找', () => {
    document.body.innerHTML = '<footer class="footer"><noscript>新標語</noscript><p>新標語</p></footer>'
    expect(findProbeElement(document.querySelector('footer')!, '新標語', rendered)?.tagName).toBe('P')
  })
})

describe('activatePreviewBlock', () => {
  it('首頁五校：改的那一校還不是目前那張時點它的分頁', () => {
    document.body.innerHTML = '<section id="campuses"><button id="campus-tab-yihua" aria-selected="true"></button><button id="campus-tab-minghua" aria-selected="false"></button></section>'
    const click = vi.fn()
    document.getElementById('campus-tab-minghua')!.addEventListener('click', click)
    expect(activatePreviewBlock(document, focus({ block: 'home-campuses', campusKey: 'yihua' }))).toBe(false)
    expect(activatePreviewBlock(document, focus({ block: 'home-campuses', campusKey: 'minghua' }))).toBe(true)
    expect(click).toHaveBeenCalledOnce()
    expect(activatePreviewBlock(document, focus({ block: 'site-footer', campusKey: 'minghua' }))).toBe(false)
  })
})

// 2026-10-07 controller 裁定：即時預覽暫停首頁五校輪播，切到被改的那一校後不會自己轉走。
// 這裡用最小的假播放鈕學 CampusBoard：點一下在「暫停分校自動播放」與「開始分校自動播放」之間切換。
describe('即時預覽暫停首頁五校輪播', () => {
  function board(playing: boolean, selected = 'yihua') {
    document.body.innerHTML = `<section id="campuses">
      <button id="campus-tab-yihua" aria-selected="${selected === 'yihua'}"></button>
      <button id="campus-tab-minghua" aria-selected="${selected === 'minghua'}"></button>
      <button class="${PLAYBACK_CLASS}" aria-label="${playing ? CAROUSEL_PLAYING_LABEL : PAUSED_LABEL}"></button>
    </section>`
    const button = document.querySelector<HTMLElement>(CAROUSEL_PLAYBACK_BUTTON)!
    const toggled = vi.fn(() => {
      const isPlaying = button.getAttribute('aria-label') === CAROUSEL_PLAYING_LABEL
      button.setAttribute('aria-label', isPlaying ? PAUSED_LABEL : CAROUSEL_PLAYING_LABEL)
    })
    button.addEventListener('click', toggled)
    return { button, toggled }
  }

  it('正在自動播放就按暫停；重複呼叫不會又按回播放', () => {
    const { button, toggled } = board(true)
    expect(pausePreviewCarousel(document)).toBe(true)
    expect(button.getAttribute('aria-label')).toBe(PAUSED_LABEL)
    expect(pausePreviewCarousel(document)).toBe(false)
    expect(pausePreviewCarousel(document)).toBe(false)
    expect(toggled).toHaveBeenCalledOnce()
  })

  it('本來就暫停（或減少動態還沒開始播）不動；沒有播放鈕也不丟錯', () => {
    const { toggled } = board(false)
    expect(pausePreviewCarousel(document)).toBe(false)
    expect(toggled).not.toHaveBeenCalled()
    document.body.innerHTML = '<section id="campuses"></section>'
    expect(pausePreviewCarousel(document)).toBe(false)
    document.body.innerHTML = ''
    expect(pausePreviewCarousel(document)).toBe(false)
  })

  it('只認首頁五校裡的播放鈕，別處同名的鈕不碰', () => {
    document.body.innerHTML = `<button class="${PLAYBACK_CLASS}" aria-label="${CAROUSEL_PLAYING_LABEL}"></button><section id="campuses"></section>`
    const click = vi.fn()
    document.querySelector(`.${PLAYBACK_CLASS}`)!.addEventListener('click', click)
    expect(pausePreviewCarousel(document)).toBe(false)
    expect(click).not.toHaveBeenCalled()
  })

  it('切到改的那一校時一起暫停；已經是那一校（不用切）也要暫停，免得框選捲進視窗後被輪播換走', () => {
    const { button } = board(true, 'yihua')
    expect(activatePreviewBlock(document, focus({ block: 'home-campuses', campusKey: 'yihua' }))).toBe(false)
    expect(button.getAttribute('aria-label')).toBe(PAUSED_LABEL)
    const second = board(true, 'yihua')
    const tab = vi.fn()
    document.getElementById('campus-tab-minghua')!.addEventListener('click', tab)
    expect(activatePreviewBlock(document, focus({ block: 'home-campuses', campusKey: 'minghua' }))).toBe(true)
    expect(tab).toHaveBeenCalledOnce()
    expect(second.button.getAttribute('aria-label')).toBe(PAUSED_LABEL)
  })

  it('改的是五校區塊本身（沒指定校）也暫停；其他區塊不碰輪播', () => {
    const { button, toggled } = board(true)
    expect(activatePreviewBlock(document, focus({ block: 'home-campuses', campusKey: null }))).toBe(false)
    expect(button.getAttribute('aria-label')).toBe(PAUSED_LABEL)
    const other = board(true)
    expect(activatePreviewBlock(document, focus({ block: 'site-footer', campusKey: 'minghua' }))).toBe(false)
    expect(activatePreviewBlock(document, focus({ block: 'home-news' }))).toBe(false)
    expect(other.toggled).not.toHaveBeenCalled()
    expect(toggled).toHaveBeenCalledOnce()
  })

  it('和官網五校元件的標記對得上（改了 CampusBoard.vue 的播放鈕或分頁，這裡要跟著改）', () => {
    const source = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../app/components/CampusBoard.vue'), 'utf8')
    expect(source).toContain('id="campuses"')
    expect(source).toMatch(new RegExp(`class="${PLAYBACK_CLASS}[ "]`))
    expect(source).toContain(`:aria-label="canAuto ? '${CAROUSEL_PLAYING_LABEL}' : '${PAUSED_LABEL}'"`)
    expect(source).toContain(':id="`campus-tab-${campus.key}`"')
    expect(source).toContain(':aria-selected="i === index"')
  })
})

describe('highlightPreview', () => {
  function stubView(scrollY = 0, innerHeight = 800) {
    const scrollTo = vi.fn()
    vi.spyOn(window, 'scrollTo').mockImplementation(scrollTo as never)
    Object.defineProperty(window, 'innerHeight', { value: innerHeight, configurable: true })
    Object.defineProperty(window, 'scrollY', { value: scrollY, configurable: true })
    return scrollTo
  }

  it('找到文字框那一格；找不到框整塊；只留一個框', () => {
    document.body.innerHTML = '<footer class="footer"><p>舊標語</p><p>新標語</p></footer>'
    stubView()
    expect(highlightPreview(document, focus({ probe: '新標語' }), { isRendered: rendered })).toBe('text')
    expect(document.querySelectorAll(`.${PREVIEW_HIT_CLASS}`)).toHaveLength(1)
    expect(document.querySelector(`.${PREVIEW_HIT_CLASS}`)!.textContent).toBe('新標語')
    expect(highlightPreview(document, focus({ probe: '沒有這段' }), { isRendered: rendered })).toBe('block')
    expect(document.querySelector(`.${PREVIEW_HIT_CLASS}`)!.tagName).toBe('FOOTER')
    expect(document.querySelectorAll(`.${PREVIEW_HIT_CLASS}`)).toHaveLength(1)
  })

  it('mark=false 或整頁區塊找不到文字：不框', () => {
    document.body.innerHTML = '<main id="main"><p>入學流程</p></main><footer class="footer"><p>標語</p></footer>'
    stubView()
    expect(highlightPreview(document, focus({ mark: false, probe: '標語' }), { isRendered: rendered })).toBe('none')
    expect(highlightPreview(document, focus({ block: 'page-top', probe: '沒有這段' }), { isRendered: rendered })).toBe('none')
    expect(highlightPreview(document, focus({ block: 'page-top', probe: '入學流程' }), { isRendered: rendered })).toBe('text')
    expect(highlightPreview(document, focus({ block: 'visit-booking' }), { isRendered: rendered })).toBe('none')
  })

  it('整頁區塊（page-top）：文字只落在 #main 本身（沒有更深的元素）時不框整個 #main、不回報 text', () => {
    // 'ab' 跨兩個子元素，沒有任何一個子元素單獨含有 → 最深只到 #main。
    document.body.innerHTML = '<main id="main"><span>a</span><span>b</span></main>'
    stubView()
    expect(highlightPreview(document, focus({ block: 'page-top', probe: 'ab' }), { isRendered: rendered })).toBe('none')
    expect(document.querySelector(`.${PREVIEW_HIT_CLASS}`)).toBeNull()
    // 一般區塊（outline: true）命中自己時照舊：是 text，框那一塊。
    document.body.innerHTML = '<footer class="footer"><span>a</span><span>b</span></footer>'
    expect(highlightPreview(document, focus({ block: 'site-footer', probe: 'ab' }), { isRendered: rendered })).toBe('text')
    expect(document.querySelector(`.${PREVIEW_HIT_CLASS}`)!.tagName).toBe('FOOTER')
  })

  it('只捲預覽頁自己的視窗（scrollTo），不用 scrollIntoView（會連外層後台頁一起捲）', () => {
    document.body.innerHTML = '<footer class="footer"><p>新標語</p></footer>'
    const scrollTo = stubView(100, 800)
    const intoView = vi.fn()
    Element.prototype.scrollIntoView = intoView
    const p = document.querySelector('p')!
    vi.spyOn(p, 'getBoundingClientRect').mockReturnValue({ top: 1200, bottom: 1230, height: 30, left: 0, right: 0, width: 0, x: 0, y: 1200, toJSON: () => ({}) } as DOMRect)
    revealInFrame(document, p, 'center', true)
    expect(intoView).not.toHaveBeenCalled()
    expect(scrollTo).toHaveBeenCalledWith({ top: 100 + 1200 - 385, behavior: 'auto' })
  })

  it('框選一格時的捲動：減少動態用 auto，否則 smooth', () => {
    document.body.innerHTML = '<footer class="footer"><p>新標語</p></footer>'
    const scrollTo = stubView(0, 800)
    vi.spyOn(document.querySelector('p')!, 'getBoundingClientRect').mockReturnValue({ top: 1500, bottom: 1530, height: 30, left: 0, right: 0, width: 0, x: 0, y: 1500, toJSON: () => ({}) } as DOMRect)
    expect(highlightPreview(document, focus({ probe: '新標語' }), { isRendered: rendered, reduceMotion: true })).toBe('text')
    expect(highlightPreview(document, focus({ probe: '新標語' }), { isRendered: rendered })).toBe('text')
    expect(scrollTo.mock.calls.map(([options]) => options.behavior)).toEqual(['auto', 'smooth'])
  })

  it('沒指定減少動態時看系統設定：開了就 auto、沒開才 smooth；指定的優先', () => {
    document.body.innerHTML = '<footer class="footer"><p>新標語</p></footer>'
    const p = document.querySelector('p')!
    vi.spyOn(p, 'getBoundingClientRect').mockReturnValue({ top: 1500, bottom: 1530, height: 30, left: 0, right: 0, width: 0, x: 0, y: 1500, toJSON: () => ({}) } as DOMRect)
    const scrollTo = stubView(0, 800)
    const matchMedia = vi.spyOn(window, 'matchMedia')
    matchMedia.mockImplementation(((query: string) => ({ matches: query === '(prefers-reduced-motion: reduce)' })) as never)
    revealInFrame(document, p, 'center')
    matchMedia.mockImplementation((() => ({ matches: false })) as never)
    revealInFrame(document, p, 'center')
    revealInFrame(document, p, 'center', true)
    expect(scrollTo.mock.calls.map(([options]) => options.behavior)).toEqual(['auto', 'smooth', 'auto'])
    // 視窗沒有 matchMedia（脫離的文件）也不丟錯。
    const own = { innerHeight: 800, scrollY: 0, scrollTo: vi.fn() }
    expect(() => revealInFrame({ defaultView: own } as unknown as Document, p, 'center')).not.toThrow()
    expect(own.scrollTo).toHaveBeenCalledWith({ top: 1500 - 385, behavior: 'smooth' })
  })

  it('只動這份文件自己的視窗，不碰 window 與外層頁；也不搶焦點', () => {
    document.body.innerHTML = '<footer class="footer"><input id="field"><p>新標語</p></footer>'
    const globalScroll = stubView()
    const own = { innerHeight: 800, scrollY: 0, scrollTo: vi.fn() }
    const frameDoc = { defaultView: own } as unknown as Document
    const p = document.querySelector('p')!
    const focused = vi.spyOn(HTMLElement.prototype, 'focus')
    vi.spyOn(p, 'getBoundingClientRect').mockReturnValue({ top: 1500, bottom: 1530, height: 30, left: 0, right: 0, width: 0, x: 0, y: 1500, toJSON: () => ({}) } as DOMRect)
    revealInFrame(frameDoc, p, 'center', false)
    expect(own.scrollTo).toHaveBeenCalledWith({ top: 1500 - 385, behavior: 'smooth' })
    expect(globalScroll).not.toHaveBeenCalled()
    highlightPreview(document, focus({ probe: '新標語' }), { isRendered: rendered })
    expect(focused).not.toHaveBeenCalled()
    expect(document.activeElement).not.toBe(p)
  })

  it('沒有視窗（文件已脫離）時不丟錯', () => {
    document.body.innerHTML = '<footer class="footer"><p>新標語</p></footer>'
    expect(() => revealInFrame({ defaultView: null } as unknown as Document, document.querySelector('p')!, 'center', false)).not.toThrow()
  })

  it('已經看得到就不捲', () => {
    document.body.innerHTML = '<footer class="footer"><p>新標語</p></footer>'
    const scrollTo = stubView(0, 800)
    const p = document.querySelector('p')!
    vi.spyOn(p, 'getBoundingClientRect').mockReturnValue({ top: 300, bottom: 330, height: 30, left: 0, right: 0, width: 0, x: 0, y: 300, toJSON: () => ({}) } as DOMRect)
    revealInFrame(document, p, 'center', false)
    expect(scrollTo).not.toHaveBeenCalled()
  })
})
