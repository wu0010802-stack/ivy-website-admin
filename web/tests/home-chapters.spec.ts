import { describe, expect, it } from 'vitest'
import { chapterForHref } from '../app/utils/homeChapters'
import { canMorphCampusPhoto, isPlainLeftClick } from '../app/utils/campusPhotoMorph'

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

  it('頁尾的 /#life 與站內的 #life 都接手', () => {
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

  it('點連結時帶了不同的 query 不攔（選單五校 /?campus=<校>#campuses 要整頁載入才選得到那一校，2026-10-29）', () => {
    const pinned = [...chapters, { id: 'campuses', after: '.day-reveal-track', pinned: true }]
    expect(chapterForHref('/?campus=minghua#campuses', origin, pinned, '')).toBeNull()
    expect(chapterForHref('/?campus=minghua#campuses', origin, pinned, '?campus=yihua')).toBeNull()
    expect(chapterForHref('/?campus=minghua#campuses', origin, pinned, '?campus=minghua')?.id).toBe('campuses')
    // 沒帶 query 的錨點照舊在原頁捲，不管目前網址有沒有 query。
    expect(chapterForHref('#life', origin, pinned, '?campus=minghua')?.id).toBe('life')
    expect(chapterForHref('/#life', origin, pinned, '?campus=minghua')?.id).toBe('life')
    // 掛載時拿目前網址判斷（不傳 currentSearch）：帶 query 進站照樣接手補捲。
    expect(chapterForHref(`${origin}/?campus=minghua#campuses`, origin, pinned)?.id).toBe('campuses')
  })
})
