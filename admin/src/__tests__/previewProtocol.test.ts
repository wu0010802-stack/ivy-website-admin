// 2026-10-06 方向 D：後台送進預覽 iframe 的訊息格式，和官網 web/app/utils/preview-live.ts 是同一份；
// 另外算出「這次改到哪個欄位、哪段文字」給預覽頁找位置。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'
import { isProxy, reactive } from 'vue'
import {
  buildDraftMessage,
  parsePreviewReply,
  PREVIEW_HITS,
  PREVIEW_MAX_DRAFT_CHARS,
  PREVIEW_MESSAGE,
  PREVIEW_PROTOCOL_VERSION,
  readPreviewReply,
  sendDraftMessage,
} from '../composables/previewProtocol'
import { lastEdit, PROBE_LENGTH, probeText } from '../composables/previewProbe'
import { PREVIEW_TARGETS } from '../composables/previewTargets'

const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')

// ---- 從官網原始碼的語法樹取值（不用字串比對：值只出現在註解裡不算數） ----------------------------------

const parse = (text: string) => ts.createSourceFile('source.ts', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)

function unwrap(node: ts.Expression): ts.Expression {
  let current = node
  while (ts.isAsExpression(current) || ts.isSatisfiesExpression(current) || ts.isParenthesizedExpression(current) || ts.isTypeAssertionExpression(current)) {
    current = current.expression
  }
  return current
}

/** 檔案最上層 `const NAME = …` 的初始值（拆掉 `as const`）；註解、字串裡的同名文字不算。 */
function topLevelConst(file: ts.SourceFile, name: string): ts.Expression {
  for (const statement of file.statements) {
    if (!ts.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.name.text === name && declaration.initializer) return unwrap(declaration.initializer)
    }
  }
  throw new Error(`找不到最上層的 const ${name}`)
}

function literalText(node: ts.Node): string {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
  throw new Error(`不是字串常數：${node.getText()}`)
}

function stringArray(file: ts.SourceFile, name: string): string[] {
  const node = topLevelConst(file, name)
  if (!ts.isArrayLiteralExpression(node)) throw new Error(`${name} 不是陣列常數`)
  return node.elements.map(literalText)
}

function numberConst(file: ts.SourceFile, name: string): number {
  const node = topLevelConst(file, name)
  if (!ts.isNumericLiteral(node)) throw new Error(`${name} 不是數字常數`)
  return Number(node.text)
}

function propertyName(name: ts.PropertyName): string {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name)) return name.text
  throw new Error(`不認得的屬性名：${name.getText()}`)
}

function objectProperties(file: ts.SourceFile, name: string): ts.PropertyAssignment[] {
  const node = topLevelConst(file, name)
  if (!ts.isObjectLiteralExpression(node)) throw new Error(`${name} 不是物件常數`)
  return node.properties.map((property) => {
    if (!ts.isPropertyAssignment(property)) throw new Error(`${name} 有不認得的成員：${property.getText()}`)
    return property
  })
}

function stringRecord(file: ts.SourceFile, name: string): Record<string, string> {
  return Object.fromEntries(objectProperties(file, name).map((property) => [propertyName(property.name), literalText(unwrap(property.initializer))]))
}

function objectKeys(file: ts.SourceFile, name: string): string[] {
  return objectProperties(file, name).map((property) => propertyName(property.name))
}

/** `type NAME = 'a' | 'b'` 的成員。 */
function unionMembers(file: ts.SourceFile, name: string): string[] {
  for (const statement of file.statements) {
    if (!ts.isTypeAliasDeclaration(statement) || statement.name.text !== name) continue
    const members = ts.isUnionTypeNode(statement.type) ? statement.type.types : [statement.type]
    return members.map((member) => {
      if (!ts.isLiteralTypeNode(member) || !ts.isStringLiteral(member.literal)) throw new Error(`${name} 有不是字串常數的成員：${member.getText()}`)
      return member.literal.text
    })
  }
  throw new Error(`找不到 type ${name}`)
}

interface WebProtocol {
  version: number
  messages: Record<string, string>
  hits: string[]
  kinds: string[]
  blocks: string[]
  pages: string[]
  maxProbe: number
  maxDraft: number
}

function readWebProtocol(source: string): WebProtocol {
  const file = parse(source)
  return {
    version: numberConst(file, 'PREVIEW_PROTOCOL_VERSION'),
    messages: stringRecord(file, 'PREVIEW_MESSAGE'),
    hits: stringArray(file, 'PREVIEW_HITS'),
    kinds: [...stringArray(file, 'SHARED_LIVE_KINDS'), ...stringArray(file, 'CAMPUS_LIVE_KINDS')],
    blocks: objectKeys(file, 'PREVIEW_BLOCKS'),
    pages: stringArray(file, 'PAGES'),
    maxProbe: numberConst(file, 'MAX_PROBE_CHARS'),
    maxDraft: numberConst(file, 'MAX_DRAFT_CHARS'),
  }
}

const webSource = read('../../../web/app/utils/preview-live.ts')
const web = readWebProtocol(webSource)
const webDraftPages = unionMembers(parse(read('../../../web/app/utils/draft-preview.ts')), 'PreviewPage')
const adminTargets = parse(read('../composables/previewTargets.ts'))
const sorted = (list: readonly string[]) => [...list].sort()

describe('和官網的訊息格式一致', () => {
  it('訊息名稱、版本、最大草稿', () => {
    expect(web.messages).toEqual(PREVIEW_MESSAGE)
    expect(web.version).toBe(PREVIEW_PROTOCOL_VERSION)
    expect(web.maxDraft).toBe(PREVIEW_MAX_DRAFT_CHARS)
  })

  it('applied 回覆的 hit 四種完全一樣', () => {
    expect(web.hits).toEqual([...PREVIEW_HITS])
  })

  it('後台用到的內容種類、區塊、頁面，官網都認得', () => {
    const targets = Object.entries(PREVIEW_TARGETS).filter(([, list]) => list.length)
    expect(targets.length).toBeGreaterThan(0)
    for (const [kind] of targets) expect(web.kinds).toContain(kind)
    const blocks = new Set(targets.flatMap(([, list]) => list.map((target) => target.block)))
    const pages = new Set(targets.flatMap(([, list]) => list.map((target) => target.page)))
    expect(blocks.size).toBeGreaterThan(0)
    expect(pages.size).toBeGreaterThan(0)
    for (const block of blocks) expect(web.blocks).toContain(block)
    for (const page of pages) expect(web.pages).toContain(page)
  })

  it('後台宣告的區塊、頁面型別和官網收的完全一樣（任何一邊多或少都要同步）', () => {
    expect(sorted(unionMembers(adminTargets, 'PreviewBlock'))).toEqual(sorted(web.blocks))
    expect(sorted(unionMembers(adminTargets, 'PreviewPage'))).toEqual(sorted(web.pages))
    expect(sorted(webDraftPages)).toEqual(sorted(web.pages))
  })

  it('後台的找位置文字長度不超過官網收的上限', () => {
    expect(PROBE_LENGTH).toBeLessThanOrEqual(web.maxProbe)
  })
})

describe('比對只認程式碼，不認註解或字串', () => {
  const real = `
    // PREVIEW_HITS = ['註解裡的']
    /* export const PREVIEW_PROTOCOL_VERSION = 9 */
    const NOTE = "const PREVIEW_HITS = ['字串裡的']"
    export const PREVIEW_PROTOCOL_VERSION = 1
    export const PREVIEW_HITS = ['text', 'block'] as const
    export const PREVIEW_MESSAGE = {
      draft: 'ivy-preview:draft', // 'ivy-preview:ghost'
      /* ready: 'ivy-preview:ghost', */
      applied: 'ivy-preview:applied'
    } as const
    export const PREVIEW_BLOCKS: Readonly<Record<string, number>> = { 'home-hero': 1, /* 'ghost': 2, */ 'page-top': 3 }
    export type PreviewPage = 'home' /* | 'ghost' */ | 'about'
  `
  const file = parse(real)

  it('取到的是真正的常數，不是註解裡的', () => {
    expect(numberConst(file, 'PREVIEW_PROTOCOL_VERSION')).toBe(1)
    expect(stringArray(file, 'PREVIEW_HITS')).toEqual(['text', 'block'])
    expect(stringRecord(file, 'PREVIEW_MESSAGE')).toEqual({ draft: 'ivy-preview:draft', applied: 'ivy-preview:applied' })
    expect(objectKeys(file, 'PREVIEW_BLOCKS')).toEqual(['home-hero', 'page-top'])
    expect(unionMembers(file, 'PreviewPage')).toEqual(['home', 'about'])
  })

  it('常數被改掉、只剩註解有舊值時：拿不到或和後台不同（不會誤判一致）', () => {
    const onlyComment = parse(`// export const PREVIEW_HITS = ['text', 'block', 'none', 'failed'] as const\nexport const OTHER = 1`)
    expect(() => stringArray(onlyComment, 'PREVIEW_HITS')).toThrow()
    const dropped = readWebProtocol(webSource.replace(/(PREVIEW_HITS = \[[^\]]*?),\s*'failed'/, `$1`))
    expect(dropped.hits).toEqual(['text', 'block', 'none'])
    expect(dropped.hits).not.toEqual([...PREVIEW_HITS])
    const commented = readWebProtocol(webSource.replace(/(PREVIEW_HITS = \[[^\]]*?),\s*'failed'/, `$1 /* 'failed' */`))
    expect(commented.hits).not.toEqual([...PREVIEW_HITS])
  })

  it('官網的版本、訊息名稱改掉，比對會抓到', () => {
    expect(readWebProtocol(webSource.replace('PREVIEW_PROTOCOL_VERSION = 1', 'PREVIEW_PROTOCOL_VERSION = 2')).version).not.toBe(PREVIEW_PROTOCOL_VERSION)
    expect(readWebProtocol(webSource.replace("applied: 'ivy-preview:applied'", "applied: 'ivy-preview:done'")).messages).not.toEqual(PREVIEW_MESSAGE)
  })
})

describe('buildDraftMessage', () => {
  const focus = { block: 'site-footer', campusKey: null, probe: '新標語', mark: true } as const

  it('payload 複製成純 JSON（reactive proxy 傳不過 postMessage）', () => {
    const form = reactive({ tagline: '新標語', links: [{ label: '首頁', href: '/' }] })
    const message = buildDraftMessage({ seq: 1, kind: 'site_footer', campusKey: null, payload: form, page: 'home', focus })!
    expect(message.type).toBe('ivy-preview:draft')
    expect(message.v).toBe(1)
    expect(isProxy(message.payload)).toBe(false)
    expect(() => structuredClone(message)).not.toThrow()
    expect(message.payload).toEqual({ tagline: '新標語', links: [{ label: '首頁', href: '/' }] })
  })

  it('只帶訊息格式裡的欄位，輸入物件多的東西不會被送出去', () => {
    const input = { seq: 2, kind: 'site_footer', campusKey: null, payload: { a: 1 }, page: 'home', focus: { ...focus, extra: 'x' }, token: 'secret' }
    const message = buildDraftMessage(input as never)!
    expect(Object.keys(message).sort()).toEqual(['campusKey', 'focus', 'kind', 'page', 'payload', 'seq', 'type', 'v'])
    expect(Object.keys(message.focus).sort()).toEqual(['block', 'campusKey', 'mark', 'probe'])
  })

  it('payload 用 JSON 複製一次：之後改輸入不影響訊息', () => {
    const payload = { links: [{ label: '首頁' }] }
    const message = buildDraftMessage({ seq: 3, kind: 'site_footer', campusKey: null, payload, page: 'home', focus })!
    payload.links[0]!.label = '被改了'
    expect(message.payload).toEqual({ links: [{ label: '首頁' }] })
  })

  it('超過官網收的上限就不建訊息（不把一百萬字以上的草稿送進 iframe）', () => {
    const atLimit = { text: 'x'.repeat(PREVIEW_MAX_DRAFT_CHARS - '{"text":""}'.length) }
    expect(JSON.stringify(atLimit)).toHaveLength(PREVIEW_MAX_DRAFT_CHARS)
    expect(buildDraftMessage({ seq: 1, kind: 'site_footer', campusKey: null, payload: atLimit, page: 'home', focus })).not.toBeNull()
    const over = { text: `${atLimit.text}x` }
    expect(buildDraftMessage({ seq: 2, kind: 'site_footer', campusKey: null, payload: over, page: 'home', focus })).toBeNull()
  })

  it('轉不成 JSON（循環參照、BigInt）也不建訊息，不丟錯', () => {
    const loop: Record<string, unknown> = {}
    loop.self = loop
    const base = { seq: 1, kind: 'site_footer', campusKey: null, page: 'home', focus } as const
    expect(buildDraftMessage({ ...base, payload: loop })).toBeNull()
    expect(buildDraftMessage({ ...base, payload: { n: 1n } })).toBeNull()
  })
})

describe('sendDraftMessage：只送給指定的預覽來源', () => {
  const message = buildDraftMessage({
    seq: 1, kind: 'site_footer', campusKey: null, payload: { tagline: 'a' }, page: 'home',
    focus: { block: 'site-footer', campusKey: null, probe: null, mark: true },
  })!

  it('用預覽來源當 targetOrigin', () => {
    const frame = { postMessage: vi.fn() }
    expect(sendDraftMessage(frame, 'https://ivy.example', message)).toBe(true)
    expect(frame.postMessage).toHaveBeenCalledTimes(1)
    expect(frame.postMessage).toHaveBeenCalledWith(message, 'https://ivy.example')
  })

  it("來源不明（空字串、'*'、'null'、帶路徑、不是網址）或沒有視窗：不送", () => {
    const frame = { postMessage: vi.fn() }
    for (const origin of ['', '*', 'null', 'https://ivy.example/', 'https://ivy.example/admin', 'ivy.example', ' https://ivy.example']) {
      expect(sendDraftMessage(frame, origin, message)).toBe(false)
    }
    expect(sendDraftMessage(null, 'https://ivy.example', message)).toBe(false)
    expect(sendDraftMessage(undefined, 'https://ivy.example', message)).toBe(false)
    expect(frame.postMessage).not.toHaveBeenCalled()
  })
})

describe('readPreviewReply：只收預覽來源、目前這個 iframe 的回覆', () => {
  const origin = 'https://ivy.example'
  const frameWindow = {}
  const ready = { type: 'ivy-preview:ready', v: 1 }

  it('來源與視窗都對才解析', () => {
    expect(readPreviewReply({ origin, source: frameWindow, data: ready }, { origin, frameWindow })).toEqual({ type: 'ivy-preview:ready' })
  })

  it('別的來源、別的視窗（包含上一個 iframe）、來源不明：一律丟掉', () => {
    expect(readPreviewReply({ origin: 'https://evil.example', source: frameWindow, data: ready }, { origin, frameWindow })).toBeNull()
    expect(readPreviewReply({ origin, source: {}, data: ready }, { origin, frameWindow })).toBeNull()
    expect(readPreviewReply({ origin, source: null, data: ready }, { origin, frameWindow })).toBeNull()
    // 目前沒有 iframe（尚未建立或已卸載）：source 是 null／undefined 也不能湊巧相等
    expect(readPreviewReply({ origin, source: null, data: ready }, { origin, frameWindow: null })).toBeNull()
    expect(readPreviewReply({ origin, source: undefined, data: ready }, { origin, frameWindow: undefined })).toBeNull()
    for (const unknown of ['', 'null', '*']) {
      expect(readPreviewReply({ origin: unknown, source: frameWindow, data: ready }, { origin: unknown, frameWindow })).toBeNull()
    }
  })

  it('來源與視窗對、格式不對：丟掉', () => {
    expect(readPreviewReply({ origin, source: frameWindow, data: { type: 'ivy-preview:draft', v: 1 } }, { origin, frameWindow })).toBeNull()
  })
})

describe('parsePreviewReply', () => {
  it('只認三種回覆、版本 1', () => {
    expect(parsePreviewReply({ type: 'ivy-preview:ready', v: 1 })).toEqual({ type: 'ivy-preview:ready' })
    expect(parsePreviewReply({ type: 'ivy-preview:denied', v: 1 })).toEqual({ type: 'ivy-preview:denied' })
    expect(parsePreviewReply({ type: 'ivy-preview:applied', v: 1, seq: 4, hit: 'text' })).toEqual({ type: 'ivy-preview:applied', seq: 4, hit: 'text' })
    expect(parsePreviewReply({ type: 'ivy-preview:applied', v: 1, seq: 5, hit: 'failed' })).toEqual({ type: 'ivy-preview:applied', seq: 5, hit: 'failed' })
    for (const bad of [
      null, 'ready', { type: 'ivy-preview:ready', v: 2 }, { type: 'ivy-preview:draft', v: 1 },
      { type: 'ivy-preview:applied', v: 1, seq: 'x', hit: 'text' }, { type: 'ivy-preview:applied', v: 1, seq: 1, hit: 'all' },
    ]) expect(parsePreviewReply(bad)).toBeNull()
  })

  it('四種 hit 都認得（和官網同一份），其他的不認得', () => {
    for (const hit of PREVIEW_HITS) expect(parsePreviewReply({ type: 'ivy-preview:applied', v: 1, seq: 1, hit })).toEqual({ type: 'ivy-preview:applied', seq: 1, hit })
    for (const hit of ['toString', 'constructor', '__proto__', 'TEXT', '', 'text ', null, 1, ['text']]) {
      expect(parsePreviewReply({ type: 'ivy-preview:applied', v: 1, seq: 1, hit })).toBeNull()
    }
  })

  it('seq 要是安全的正整數', () => {
    for (const seq of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '1', null, undefined, [1], { valueOf: () => 1 }]) {
      expect(parsePreviewReply({ type: 'ivy-preview:applied', v: 1, seq, hit: 'text' })).toBeNull()
    }
  })

  it('不是一般物件（陣列、Map、函式）不收', () => {
    expect(parsePreviewReply([{ type: 'ivy-preview:ready', v: 1 }])).toBeNull()
    expect(parsePreviewReply(new Map([['type', 'ivy-preview:ready']]))).toBeNull()
    expect(parsePreviewReply(() => ({ type: 'ivy-preview:ready', v: 1 }))).toBeNull()
  })

  it('欄位要是物件自己的：原型鏈上借來的不算', () => {
    const inheritedReady = Object.create({ type: 'ivy-preview:ready', v: 1 })
    expect(parsePreviewReply(inheritedReady)).toBeNull()
    const inheritedHit = Object.assign(Object.create({ hit: 'text' }), { type: 'ivy-preview:applied', v: 1, seq: 1 })
    expect(parsePreviewReply(inheritedHit)).toBeNull()
    const inheritedSeq = Object.assign(Object.create({ seq: 1 }), { type: 'ivy-preview:applied', v: 1, hit: 'text' })
    expect(parsePreviewReply(inheritedSeq)).toBeNull()
  })

  it('多出來的欄位不影響、也不會被帶出去', () => {
    expect(parsePreviewReply({ type: 'ivy-preview:ready', v: 1, extra: '<script>' })).toEqual({ type: 'ivy-preview:ready' })
    expect(parsePreviewReply({ type: 'ivy-preview:applied', v: 1, seq: 2, hit: 'none', extra: 1 })).toEqual({ type: 'ivy-preview:applied', seq: 2, hit: 'none' })
  })
})

describe('lastEdit／probeText', () => {
  it('第一次（沒有上一份）不算改', () => {
    expect(lastEdit(null, { tagline: 'a' })).toBeNull()
    expect(lastEdit({ tagline: 'a' }, { tagline: 'a' })).toBeNull()
  })

  it('最外層字串：回那個欄位與新的字', () => {
    expect(lastEdit({ tagline: '舊', phone: '1' }, { tagline: '新標語', phone: '1' })).toEqual({ key: 'tagline', text: '新標語' })
  })

  it('清單或物件裡的字：回最外層欄位與裡面改到的那段字', () => {
    const before = { articles: [{ title: '親子日', body: [{ text: 'a' }] }, { title: '開學', body: [] }] }
    const after = { articles: [{ title: '親子日', body: [{ text: 'a' }] }, { title: '開學典禮', body: [] }] }
    expect(lastEdit(before, after)).toEqual({ key: 'articles', text: '開學典禮' })
  })

  it('改的不是字（圖片、焦點、數字）：text 是 null', () => {
    expect(lastEdit({ card_focus: { x: 50, y: 50 } }, { card_focus: { x: 50, y: 12 } })).toEqual({ key: 'card_focus', text: null })
    expect(lastEdit({ home_display_count: 3 }, { home_display_count: 4 })).toEqual({ key: 'home_display_count', text: null })
  })

  it('拿掉的欄位也算改', () => {
    expect(lastEdit({ a: '1', b: '2' }, { a: '1' })).toEqual({ key: 'b', text: null })
  })

  it('probeText：第一個至少兩個字的行、壓空白、最多 40 字', () => {
    expect(probeText('\n  第一行  有空白 \n第二行')).toBe('第一行 有空白')
    expect(probeText('字'.repeat(60))).toHaveLength(PROBE_LENGTH)
    expect(probeText('a')).toBeNull()
    expect(probeText('')).toBeNull()
  })

  it('probeText 以字（碼點）截斷，不把 emoji 切成半個', () => {
    const cut = probeText(`${'字'.repeat(PROBE_LENGTH - 1)}😀😀`)!
    expect(Array.from(cut)).toHaveLength(PROBE_LENGTH)
    expect(cut.endsWith('😀')).toBe(true)
    expect(cut).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/)
  })
})
