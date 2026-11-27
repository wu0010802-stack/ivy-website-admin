// 錯誤回報遮蔽的效能回歸（2026-11-26，redactregex）：後台 utils/errorReport.ts 那份遮蔽規則和官網
// web/shared/client-error.ts 同一組，網址 query 與 Email 的舊正規式一長串 /、//a?…(、連續英數字就是 O(n²)。
// 兩份一起改成逐段掃一次；這裡守後台這份的耗時，以及它和官網那份（web 的測試再拿舊正規式比對）結果一模一樣。
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildReport, redactText } from '../utils/errorReport'

// 官網那份規則：不能靜態 import（映像建置時 admin 先於 web 複製進來），測試執行時動態載入，同 errorReport.test.ts。
interface WebRules {
  redactClientText: (text: string, options?: { tokens?: boolean }) => string
}
const { redactClientText } = (await import(/* @vite-ignore */ resolve(__dirname, '../../../web/shared/client-error.ts'))) as WebRules

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

describe('後台遮蔽的耗時跟長度成正比', () => {
  it.each(Object.entries(WORST_CASES))('%s：50 ms 內', (_label, text) => {
    expect(fastestMs(() => redactText(text))).toBeLessThan(50)
    expect(fastestMs(() => redactText(text, { tokens: false }))).toBeLessThan(50)
  })
  it('組報告拿超長的堆疊、訊息與路徑也很快', () => {
    const raw = { kind: 'TypeError', message: '//a?'.repeat(7500) + '(', stack: '/'.repeat(30000) }
    expect(fastestMs(() => buildReport(raw, 'https://admin.example', '/admin/' + 'a'.repeat(30000)))).toBeLessThan(50)
  })
})

describe('後台與官網兩份遮蔽結果一致', () => {
  const alphabets = ["/:?#]a1( )'.-_@%+x", '/?#:]1a(', '/:?#]ab12( ) \n"<>.-+中', 'a@.-_%+1 b]', 'ht:/p?#1]', '/?#:]1١\u3000\ufeff中a(']
  it('固定種子的短字串逐一比對（含 tokens: false）', () => {
    const random = seeded(20261126)
    for (const alphabet of alphabets) {
      for (let i = 0; i < 2000; i++) {
        let sample = ''
        const length = Math.floor(random() * 41)
        for (let j = 0; j < length; j++) sample += alphabet[Math.floor(random() * alphabet.length)]
        expect(redactText(sample), JSON.stringify(sample)).toBe(redactClientText(sample))
        expect(redactText(sample, { tokens: false }), JSON.stringify(sample)).toBe(redactClientText(sample, { tokens: false }))
      }
    }
  })
})
