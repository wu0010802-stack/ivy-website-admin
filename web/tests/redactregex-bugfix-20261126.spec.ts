import { describe, expect, it } from 'vitest'
import { buildClientError, redactClientPath, redactClientText } from '../shared/client-error'

// 錯誤回報遮蔽的效能回歸（2026-11-26，redactregex）：網址 query 與 Email 的舊正規式每個起點都先吃到結尾再回溯，
// 一長串 /、//a?…(、連續英數字就是 O(n²)。後端（backend/app/operations/error_reports.py）是公開端點卡住事件迴圈，
// 這裡是同一組規則的瀏覽器版本，一起改成逐段掃一次。守兩件事：耗時跟長度成正比，以及結果和舊正規式一模一樣。

// 2026-11-26 以前的整組規則，原封不動留著當規格。
const OLD_ABSOLUTE_URL_QUERY = /((?:[A-Za-z][A-Za-z0-9+.-]*:)?\/\/[^\s'"<>()?#]+)[?#][^\s'"<>()]*?((?::\d+){0,2})(?=[\s'"<>)\]]|$)/g
const OLD_RELATIVE_URL_QUERY = /(^|[^\w/.:-])(\/[^\s'"<>()?#:]+)[?#][^\s'"<>()]*?((?::\d+){0,2})(?=[\s'"<>)\]]|$)/g
const OLD_USERINFO = /(\/\/)[^\s/@]+@/g
const OLD_EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g
const OLD_TW_ID = /(^|[^A-Za-z0-9])[A-Za-z][12]\d{8}(?!\d)/g
const OLD_LONG_DIGITS = /[0-9](?:[ -]?[0-9]){6,}/g
const OLD_TOKEN = /[A-Za-z0-9_-]{20,}/g

function oldRedact(text: string, options: { tokens?: boolean } = {}): string {
  let result = text
    .replace(OLD_ABSOLUTE_URL_QUERY, (_match, url: string, pos: string) => url + pos)
    .replace(OLD_RELATIVE_URL_QUERY, (_match, before: string, url: string, pos: string) => before + url + pos)
    .replace(OLD_USERINFO, '$1[credentials]@')
    .replace(OLD_EMAIL, '[email]')
    .replace(OLD_TW_ID, (_match, before: string) => `${before}[id]`)
  if (options.tokens !== false) result = result.replace(OLD_TOKEN, (value) => (/[A-Za-z0-9]/.test(value) ? '[token]' : value))
  return result.replace(OLD_LONG_DIGITS, '[n]')
}

/** 三次裡最快的一次：CI 偶爾被別的工作搶 CPU，不能讓單次抖動變成紅燈。 */
function fastestMs(run: () => unknown): number {
  let best = Number.POSITIVE_INFINITY
  for (let i = 0; i < 3; i++) {
    const start = performance.now()
    run()
    best = Math.min(best, performance.now() - start)
  }
  return best
}

/** 固定種子的亂數（mulberry32）：每次跑出同一批樣本，失敗時重現得了。 */
function seeded(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// 舊寫法的最壞情況。V8 的回溯比 Python 快，8000 字還不到 50 ms，所以用 30000 字（舊版要 0.2～0.6 秒）。
const WORST_CASES: Record<string, string> = {
  一長串斜線: '/'.repeat(30000),
  '//a? 重複、結尾接左括號': '//a?'.repeat(7500) + '(',
  '/a? 重複、結尾接左括號': '/a?'.repeat(10000) + '(',
  'scheme:// 重複': 'a://'.repeat(7500),
  '連續字母（Email 本地部分）': 'a'.repeat(30000),
  '英數與減號（Email 本地部分）': 'a1-'.repeat(10000),
}

describe('遮蔽的耗時跟長度成正比', () => {
  it.each(Object.entries(WORST_CASES))('%s：50 ms 內', (_label, text) => {
    expect(fastestMs(() => redactClientText(text))).toBeLessThan(50)
    expect(fastestMs(() => redactClientText(text, { tokens: false }))).toBeLessThan(50)
  })
  it('組報告：整份堆疊先遮蔽再截斷（截斷前的長度不受限），也不會卡住頁面', () => {
    const context = { source: 'web' as const, origin: 'https://site.example', pathname: '/' + 'p/'.repeat(5000) }
    const raw = { kind: 'TypeError', message: '//a?'.repeat(7500) + '(', stack: '/'.repeat(30000) }
    expect(fastestMs(() => buildClientError(raw, context))).toBeLessThan(50)
    expect(fastestMs(() => redactClientPath('/' + 'a'.repeat(30000)))).toBeLessThan(50)
  })
})

describe('結果和舊正規式一模一樣', () => {
  // 每組字元都刻意含網址與堆疊的語法字元（/ : ? # ] 與分隔用的空白、引號、括號），短字串才湊得出各種邊角。
  const alphabets = [
    "/:?#]a1( )'.-_@%+x",
    '/?#:]1a(',
    '/:?#]ab12( ) \n"<>.-+中',
    'a@.-_%+1 b]',
    '/?#:]123 ()',
    'ht:/p?#1]',
    '/?#:]1١\u3000\x1c\ufeff中a(',
  ]
  it('固定種子的短字串逐一比對（含 tokens: false）', () => {
    const random = seeded(20261126)
    let compared = 0
    for (const alphabet of alphabets) {
      for (let i = 0; i < 3000; i++) {
        let sample = ''
        const length = Math.floor(random() * 41)
        for (let j = 0; j < length; j++) sample += alphabet[Math.floor(random() * alphabet.length)]
        expect(redactClientText(sample), JSON.stringify(sample)).toBe(oldRedact(sample))
        expect(redactClientText(sample, { tokens: false }), JSON.stringify(sample)).toBe(oldRedact(sample, { tokens: false }))
        compared++
      }
    }
    expect(compared).toBe(alphabets.length * 3000)
  })
  it('實際會遇到的寫法', () => {
    for (const sample of [
      'at f (https://a.example/e.js?v=3:12:34)',
      'at g (/_nuxt/f.js?email=mom@example.com:5:6)',
      'g@https://cdn.example/x.js?v=1:2:3\nh@/_nuxt/c.js#x:7:8',
      'fetch /api/x?phone=0912345678 failed',
      '[https://a.example/p?q=1] /b?c]',
      'a@b.c.%d@e.f mom@example.com.',
      'see https://a.example/x?q=1&p=0912345678#top now',
      'postgresql://user:pw@db.internal/app',
    ]) {
      expect(redactClientText(sample), sample).toBe(oldRedact(sample))
    }
    expect(redactClientText('[https://a.example/p?q=1] /b?c]')).toBe('[https://a.example/p] /b]')
    expect(redactClientText('a@b.c.%d@e.f mom@example.com.')).toBe('[email][email] [email].')
  })
})
