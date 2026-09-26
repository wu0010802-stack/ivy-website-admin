import { describe, expect, it } from 'vitest'
import { ancestorIds, chapterAt, chapterForHref } from '../app/utils/homeChapters'
import { canMorphCampusPhoto, isPlainLeftClick } from '../app/utils/campusPhotoMorph'

const CHAPTERS = ['about', 'life', 'latest-news', 'campuses']

describe('chapterAt', () => {
  it('取最近的章節祖先（章節元件是巢狀的）', () => {
    expect(chapterAt(['print-3', 'life', 'about'], CHAPTERS)).toBe(1)
    expect(chapterAt(['campuses', 'latest-news', 'life', 'about'], CHAPTERS)).toBe(3)
  })

  it('首屏或頁尾不屬於任何章節', () => {
    expect(chapterAt(['home-title', 'main'], CHAPTERS)).toBe(-1)
    expect(chapterAt([], CHAPTERS)).toBe(-1)
  })
})

describe('ancestorIds', () => {
  it('由內往外收集有 id 的祖先', () => {
    const node = (id: string, parentElement: unknown) => ({ id, parentElement }) as unknown as Element
    const leaf = node('', node('life', node('', node('about', null))))
    expect(ancestorIds(leaf)).toEqual(['life', 'about'])
    expect(ancestorIds(null)).toEqual([])
  })
})

describe('campusPhotoMorph', () => {
  const doc = (supported: boolean) => ({ startViewTransition: supported ? () => ({}) : undefined }) as unknown as Document
  const win = (queries: string[]) => ({ matchMedia: (q: string) => ({ matches: queries.includes(q) }) }) as unknown as Window

  it('支援 View Transition 且沒有減少動態、強制色彩時才接續照片', () => {
    expect(canMorphCampusPhoto(doc(true), win([]))).toBe(true)
    expect(canMorphCampusPhoto(doc(false), win([]))).toBe(false)
    expect(canMorphCampusPhoto(doc(true), win(['(prefers-reduced-motion: reduce)']))).toBe(false)
    expect(canMorphCampusPhoto(doc(true), win(['(forced-colors: active)']))).toBe(false)
  })

  it('按修飾鍵或中鍵（另開分頁）時照常換頁', () => {
    const click = (init: Partial<MouseEvent>) => ({ button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...init }) as MouseEvent
    expect(isPlainLeftClick(click({}))).toBe(true)
    expect(isPlainLeftClick(click({ metaKey: true }))).toBe(false)
    expect(isPlainLeftClick(click({ ctrlKey: true }))).toBe(false)
    expect(isPlainLeftClick(click({ button: 1 }))).toBe(false)
  })
})

describe('chapterForHref', () => {
  const origin = 'https://ivy.example'
  const chapters = [{ id: 'about' }, { id: 'life', after: '.belief-reveal-track' }]

  it('頁尾的 /#life 與章節指示的 #life 都接手', () => {
    expect(chapterForHref('/#life', origin, chapters)?.id).toBe('life')
    expect(chapterForHref('#life', origin, chapters)?.id).toBe('life')
    expect(chapterForHref(`${origin}/#life`, origin, chapters)?.id).toBe('life')
  })

  it('沒有 after 的章節、其他頁面、外站、沒有 hash 都照常', () => {
    expect(chapterForHref('/#about', origin, chapters)).toBeNull()
    expect(chapterForHref('/admission#life', origin, chapters)).toBeNull()
    expect(chapterForHref('https://other.example/#life', origin, chapters)).toBeNull()
    expect(chapterForHref('/', origin, chapters)).toBeNull()
  })
})
