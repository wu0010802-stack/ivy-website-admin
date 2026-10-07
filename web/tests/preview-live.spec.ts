import { describe, expect, it, vi } from 'vitest'
import fixture from '../server/data/site-fixture.json'
import type { SiteContent } from '../app/types/site-content'
import { previewOverlay } from '../app/utils/draft-preview'
import {
  applyLiveDraft,
  createLiveReceiver,
  isTrustedPreviewEvent,
  MAX_DRAFT_CHARS,
  parseDraftMessage,
  PREVIEW_MESSAGE
} from '../app/utils/preview-live'

// 2026-10-06 方向 D：後台內容編輯頁把還沒存的表單用 postMessage 傳進 /preview?embed=1&live=1。
const site = fixture as unknown as SiteContent
const CAMPUSES = site.campuses.map((c) => c.key)
const footer = { tagline: '還沒存的標語', copyright: '©', bottom_note: '', campus_list_label: '五校聯絡' }

function draft(overrides: Record<string, unknown> = {}) {
  return {
    type: 'ivy-preview:draft', v: 1, seq: 1, kind: 'site_footer', campusKey: null, payload: footer, page: 'home',
    focus: { block: 'site-footer', campusKey: null, probe: '還沒存的標語', mark: true },
    ...overrides
  }
}

describe('parseDraftMessage：格式不對就不套用', () => {
  it('收共用內容與分校內容', () => {
    expect(parseDraftMessage(draft(), CAMPUSES)).toEqual({
      seq: 1, kind: 'site_footer', campusKey: null, payload: footer, page: 'home',
      focus: { block: 'site-footer', campusKey: null, probe: '還沒存的標語', mark: true }
    })
    const campus = parseDraftMessage(draft({ kind: 'campus_profile', campusKey: 'yihua', focus: { block: 'home-campuses', campusKey: 'yihua', probe: null, mark: true } }), CAMPUSES)
    expect(campus?.campusKey).toBe('yihua')
  })

  it.each([
    ['type 不對', { type: 'something-else' }],
    ['版本不對', { v: 2 }],
    ['seq 不是正整數', { seq: 0 }],
    ['seq 是小數', { seq: 1.5 }],
    ['seq 是字串', { seq: '1' }],
    ['不認得的內容種類', { kind: 'users' }],
    ['內容種類是原型上的鍵', { kind: 'toString' }],
    ['共用內容帶了校區', { campusKey: 'yihua' }],
    ['分校內容沒帶校區', { kind: 'campus_profile', campusKey: null }],
    ['不認得的校區', { kind: 'campus_profile', campusKey: 'evil' }],
    ['校區是原型上的鍵', { kind: 'campus_profile', campusKey: '__proto__' }],
    ['payload 是陣列', { payload: [] }],
    ['payload 是 null', { payload: null }],
    ['payload 是 Map（不是一般物件）', { payload: new Map([['tagline', 'x']]) }],
    ['payload 太大', { payload: { tagline: 'x'.repeat(MAX_DRAFT_CHARS) } }],
    ['不認得的頁面', { page: 'admin' }],
    ['頁面是原型上的鍵', { page: 'constructor' }],
    ['區塊是原型上的鍵', { focus: { block: 'toString', campusKey: null, probe: null, mark: true } }],
    ['區塊是 constructor', { focus: { block: 'constructor', campusKey: null, probe: null, mark: true } }],
    ['區塊是 __proto__', { focus: { block: '__proto__', campusKey: null, probe: null, mark: true } }],
    ['focus 的校區不認得', { focus: { block: 'home-campuses', campusKey: 'evil', probe: null, mark: true } }],
    ['focus 不是一般物件', { focus: [] }]
  ])('%s', (_name, overrides) => {
    expect(parseDraftMessage(draft(overrides), CAMPUSES)).toBeNull()
  })

  it('payload 循環參照（JSON 轉不出來）不收，也不丟錯', () => {
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(parseDraftMessage(draft({ payload: cyclic }), CAMPUSES)).toBeNull()
  })

  it('payload 超深巢狀（JSON 轉不出來、會爆呼叫堆疊）不收，也不丟錯', () => {
    let deep: Record<string, unknown> = {}
    for (let i = 0; i < 200_000; i += 1) deep = { next: deep }
    expect(() => parseDraftMessage(draft({ payload: deep }), CAMPUSES)).not.toThrow()
    expect(parseDraftMessage(draft({ payload: deep }), CAMPUSES)).toBeNull()
  })

  it('不是物件也不收', () => {
    for (const data of [null, undefined, 'ivy-preview:draft', 1, []]) expect(parseDraftMessage(data, CAMPUSES)).toBeNull()
  })

  it('payload 剛好等於上限（JSON 字元數）收，多一個字就不收', () => {
    const overhead = JSON.stringify({ tagline: '' }).length
    const exact = { tagline: 'x'.repeat(MAX_DRAFT_CHARS - overhead) }
    expect(JSON.stringify(exact)).toHaveLength(MAX_DRAFT_CHARS)
    expect(parseDraftMessage(draft({ payload: exact }), CAMPUSES)?.payload).toEqual(exact)
    expect(parseDraftMessage(draft({ payload: { tagline: `${exact.tagline}x` } }), CAMPUSES)).toBeNull()
  })

  it('收下的 payload 是新的純 JSON 物件：巢狀的 Map、Date、ArrayBuffer、Blob 不會混進來，上限也量得準', () => {
    const when = new Date('2026-10-06T00:00:00Z')
    const input = {
      tagline: '標語',
      when,
      nested: { map: new Map([['a', 1]]), list: [new Uint8Array([1, 2]).buffer, new Blob(['x']), undefined, Number.NaN] },
      keep: { n: 1, ok: true, none: null }
    }
    const parsed = parseDraftMessage(draft({ payload: input }), CAMPUSES)!
    expect(parsed.payload).toEqual({
      tagline: '標語',
      when: '2026-10-06T00:00:00.000Z',
      nested: { map: {}, list: [{}, {}, null, null] },
      keep: { n: 1, ok: true, none: null }
    })
    // 收到的是 JSON 轉出來的新物件，不是 event.data 裡的同一份（也不必再複製一次）。
    expect(parsed.payload).not.toBe(input)
    expect(parsed.payload.keep).not.toBe(input.keep)
    expect(parsed.payload.when).not.toBeInstanceOf(Date)
  })

  it('probe 截到 80 字、空字串當沒有；mark 沒寫當 true', () => {
    const long = parseDraftMessage(draft({ focus: { block: 'site-footer', campusKey: null, probe: '字'.repeat(120) } }), CAMPUSES)
    expect(long?.focus.probe).toHaveLength(80)
    expect(long?.focus.mark).toBe(true)
    expect(parseDraftMessage(draft({ focus: { block: 'site-footer', campusKey: null, probe: '   ', mark: false } }), CAMPUSES)?.focus).toEqual({ block: 'site-footer', campusKey: null, probe: null, mark: false })
  })

  it('probe 截斷不會把代理對（emoji 等）切成兩半', () => {
    const emoji = parseDraftMessage(draft({ focus: { block: 'site-footer', campusKey: null, probe: '😀'.repeat(100) } }), CAMPUSES)?.focus.probe
    expect(emoji).toBe('😀'.repeat(80))
    expect(Array.from(emoji!)).toHaveLength(80)
    // 前面混了一個單位長度 1 的字，第 80 個字（代理對）仍整個留下，後面多的整個丟掉，不留半個。
    const mixed = parseDraftMessage(draft({ focus: { block: 'site-footer', campusKey: null, probe: `字${'😀'.repeat(79)}😀😀` } }), CAMPUSES)?.focus.probe
    expect(Array.from(mixed!)).toHaveLength(80)
    expect(mixed).toBe(`字${'😀'.repeat(79)}`)
    for (const probe of [emoji!, mixed!]) expect(probe).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/)
  })
})

describe('isTrustedPreviewEvent：只收同源、外層後台頁送來的', () => {
  const parent = { name: 'admin' }
  const self = { location: { origin: 'https://ivy.example' }, parent }

  it('同源而且是 parent', () => {
    expect(isTrustedPreviewEvent({ origin: 'https://ivy.example', source: parent }, self)).toBe(true)
  })

  it('別的 origin、不是 parent（同源其他分頁、自己）、頂層頁面：都不收', () => {
    expect(isTrustedPreviewEvent({ origin: 'https://evil.example', source: parent }, self)).toBe(false)
    expect(isTrustedPreviewEvent({ origin: 'https://ivy.example', source: { name: 'opener' } }, self)).toBe(false)
    expect(isTrustedPreviewEvent({ origin: 'https://ivy.example', source: self }, self)).toBe(false)
    const top: { location: { origin: string }; parent: unknown } = { location: { origin: 'https://ivy.example' }, parent: null }
    top.parent = top
    expect(isTrustedPreviewEvent({ origin: 'https://ivy.example', source: top }, top)).toBe(false)
  })

  it('沒有 parent（null）而且 source 也是 null：不算外層頁', () => {
    const detached = { location: { origin: 'https://ivy.example' }, parent: null }
    expect(isTrustedPreviewEvent({ origin: 'https://ivy.example', source: null }, detached)).toBe(false)
  })
})

describe('applyLiveDraft：只蓋掉這一項內容', () => {
  it('共用內容整份換掉；分校內容只換那一校，不改原本的 overlay', () => {
    const overlay = { site_footer: { ...footer, tagline: '已存' }, campus_profile: { minghua: { name: '明華校' } } } as never
    const shared = applyLiveDraft(overlay, { kind: 'site_footer', campusKey: null, payload: footer })
    expect((shared as Record<string, unknown>).site_footer).toBe(footer)
    const campus = applyLiveDraft(overlay, { kind: 'campus_profile', campusKey: 'yihua', payload: { name: '義華校' } })
    expect((campus as Record<string, Record<string, unknown>>).campus_profile).toEqual({ minghua: { name: '明華校' }, yihua: { name: '義華校' } })
    expect((overlay as Record<string, Record<string, unknown>>).campus_profile).toEqual({ minghua: { name: '明華校' } })
  })

  it('分校內容沒帶校區：不動 overlay（不會把五校整張換成這一份）', () => {
    const overlay = { campus_profile: { minghua: { name: '明華校' }, yihua: { name: '義華校' } }, site_footer: footer } as never
    for (const kind of ['campus_profile', 'campus_tour', 'campus_news'] as const) {
      const next = applyLiveDraft(overlay, { kind, campusKey: null, payload: { name: '不該蓋上去' } })
      expect(next).toEqual(overlay)
      expect((next as Record<string, unknown>)[kind]).toBe((overlay as Record<string, unknown>)[kind])
    }
  })

  it('其他內容種類原封不動，原本的 overlay 不被改', () => {
    const overlay = { home_hero: { title: '已存的首屏' }, site_footer: { ...footer, tagline: '已存' } } as never
    const next = applyLiveDraft(overlay, { kind: 'site_footer', campusKey: null, payload: footer }) as Record<string, unknown>
    expect(next.home_hero).toBe((overlay as Record<string, unknown>).home_hero)
    expect((overlay as Record<string, Record<string, unknown>>).site_footer.tagline).toBe('已存')
  })

  it('和預覽同一條路：頁尾標語換掉、消息照樣依日期上下架', () => {
    const live = applyLiveDraft({}, { kind: 'site_footer', campusKey: null, payload: footer })
    expect(previewOverlay(site, live, '2026-10-06').content.footer.tagline).toBe('還沒存的標語')
    const news = applyLiveDraft({}, {
      kind: 'home_news', campusKey: null,
      payload: { sample_note: '', articles: [{ id: 'later', date: '2026-10-20', campus: '全校', category: '日常', title: '下週才上架', description: '', image: 'news-1', alt: '', show_from: '2026-10-20' }], events: [] }
    })
    expect(previewOverlay(site, news, '2026-10-06').hiddenNews.map((n) => n.title)).toEqual(['下週才上架'])
  })
})

describe('createLiveReceiver', () => {
  function setup() {
    const parent = { postMessage: vi.fn() }
    const self = { location: { origin: 'https://ivy.example' }, parent }
    const onDraft = vi.fn()
    const receiver = createLiveReceiver({ self, campusKeys: CAMPUSES, onDraft })
    return { parent, self, onDraft, receiver }
  }

  it('ready／denied／applied 都只送給 parent，targetOrigin 是自己的 origin', () => {
    const { parent, receiver } = setup()
    receiver.ready()
    receiver.denied()
    receiver.applied(3, 'text')
    expect(parent.postMessage.mock.calls).toEqual([
      [{ v: 1, type: PREVIEW_MESSAGE.ready }, 'https://ivy.example'],
      [{ v: 1, type: PREVIEW_MESSAGE.denied }, 'https://ivy.example'],
      [{ v: 1, type: PREVIEW_MESSAGE.applied, seq: 3, hit: 'text' }, 'https://ivy.example']
    ])
    expect(parent.postMessage.mock.calls.every(([, target]) => target !== '*')).toBe(true)
  })

  it('origin 不是能指定的來源（opaque origin 的 "null"、空字串）就不送，絕不退成 "*"', () => {
    for (const origin of ['null', '']) {
      const parent = { postMessage: vi.fn() }
      const receiver = createLiveReceiver({ self: { location: { origin }, parent }, campusKeys: CAMPUSES, onDraft: vi.fn() })
      receiver.ready()
      receiver.denied()
      receiver.applied(1, 'none')
      expect(parent.postMessage).not.toHaveBeenCalled()
    }
  })

  it('只交出可信、格式對、seq 比上一則大的草稿', () => {
    const { parent, onDraft, receiver } = setup()
    receiver.handle({ origin: 'https://evil.example', source: parent, data: draft() })
    receiver.handle({ origin: 'https://ivy.example', source: parent, data: draft({ seq: 2 }) })
    receiver.handle({ origin: 'https://ivy.example', source: parent, data: draft({ seq: 1 }) })
    receiver.handle({ origin: 'https://ivy.example', source: parent, data: draft({ seq: 2 }) })
    receiver.handle({ origin: 'https://ivy.example', source: parent, data: draft({ seq: 3, v: 9 }) })
    expect(onDraft.mock.calls.map(([d]) => d.seq)).toEqual([2])
  })

  it('格式不對的訊息不會推進 seq：後面正常的草稿仍然收得到', () => {
    const { parent, onDraft, receiver } = setup()
    receiver.handle({ origin: 'https://ivy.example', source: parent, data: draft({ seq: 99, kind: 'users' }) })
    receiver.handle({ origin: 'https://ivy.example', source: parent, data: draft({ seq: 2 }) })
    expect(onDraft.mock.calls.map(([d]) => d.seq)).toEqual([2])
  })

  it('不是 parent 送的（同源其他視窗）不收，也不推進 seq', () => {
    const { parent, onDraft, receiver } = setup()
    receiver.handle({ origin: 'https://ivy.example', source: { postMessage: vi.fn() }, data: draft({ seq: 50 }) })
    receiver.handle({ origin: 'https://ivy.example', source: parent, data: draft({ seq: 2 }) })
    expect(onDraft.mock.calls.map(([d]) => d.seq)).toEqual([2])
  })

  it('頂層頁面（parent 就是自己）什麼都不送、自己對自己送的草稿也不收', () => {
    const self: { location: { origin: string }; parent: unknown; postMessage: ReturnType<typeof vi.fn> } = { location: { origin: 'https://ivy.example' }, parent: null, postMessage: vi.fn() }
    self.parent = self
    const onDraft = vi.fn()
    const receiver = createLiveReceiver({ self, campusKeys: CAMPUSES, onDraft })
    receiver.ready()
    receiver.denied()
    receiver.applied(1, 'none')
    receiver.handle({ origin: 'https://ivy.example', source: self, data: draft() })
    expect(self.postMessage).not.toHaveBeenCalled()
    expect(onDraft).not.toHaveBeenCalled()
  })
})
