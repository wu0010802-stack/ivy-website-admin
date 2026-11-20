import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ANNI_INTRO_SEEN_COOKIE, ENTRANCE_SEEN_COOKIE, SEEN_COOKIE_MAX_AGE, seenCookieSet, seenCookieString, writeSeenCookie } from '../app/utils/seen-cookie'

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')

describe('開場動畫看過 cookie', () => {
  it('名稱與 30 天', () => {
    expect(ENTRANCE_SEEN_COOKIE).toBe('ivy_seen_entrance')
    expect(ANNI_INTRO_SEEN_COOKIE).toBe('ivy_seen_anni_intro')
    expect(SEEN_COOKIE_MAX_AGE).toBe(30 * 86400)
  })
  it('useCookie 會把 1 解析成數字，字串 1 與數字 1 都算看過，其他不算', () => {
    expect(seenCookieSet(1)).toBe(true)
    expect(seenCookieSet('1')).toBe(true)
    for (const v of [0, '0', '', null, undefined, true, 'yes', 2]) expect(seenCookieSet(v)).toBe(false)
  })
  it('cookie 字串：Path=/、Lax、https 才有 Secure、不是 HttpOnly', () => {
    expect(seenCookieString('ivy_seen_entrance', true)).toBe('ivy_seen_entrance=1; Max-Age=2592000; Path=/; SameSite=Lax; Secure')
    expect(seenCookieString('ivy_seen_entrance', false)).toBe('ivy_seen_entrance=1; Max-Age=2592000; Path=/; SameSite=Lax')
    expect(seenCookieString('x', true)).not.toMatch(/HttpOnly/i)
  })
  it('writeSeenCookie 依協定決定 Secure，cookie 被擋不丟錯', () => {
    const writes: string[] = []
    const doc = { set cookie(v: string) { writes.push(v) } } as { cookie: string }
    writeSeenCookie('n', doc, { protocol: 'https:' })
    writeSeenCookie('n', doc, { protocol: 'http:' })
    expect(writes[0]).toContain('; Secure')
    expect(writes[1]).not.toContain('Secure')
    const blocked = { set cookie(_v: string) { throw new Error('blocked') } } as { cookie: string }
    expect(() => writeSeenCookie('n', blocked, { protocol: 'https:' })).not.toThrow()
  })
  it('SSR：看過就不輸出首頁 bootstrap／布幕樣式', () => {
    const home = read('../app/pages/index.vue')
    expect(home).toContain("useCookie(ENTRANCE_SEEN_COOKIE, { readonly: true })")
    expect(home).toContain('script: () => (entranceDue.value ?')
    expect(home).toContain('style: () => (entranceDue.value ?')
  })
  // /anniversary 的 30 秒開場動畫在 claude/determined-brown-8ob4jc 換成「按了才播」的紀念影片（2026-11-11），
  // 閘門 script 與元件都拿掉了，所以 ivy_seen_anni_intro 目前沒有地方讀寫；常數留著（規格與隱私權政策擬稿列了這個名字）。
  it('/anniversary 沒有自動播的開場，也就沒有要看 cookie 的閘門', () => {
    expect(existsSync(fileURLToPath(new URL('../app/components/AnniversaryIntro.vue', import.meta.url)))).toBe(false)
    expect(read('../app/utils/inline-scripts.ts')).not.toContain('export const ANNI_INTRO_GATE_SCRIPT')
    expect(read('../app/components/AnniversaryFilm.vue')).not.toContain('ANNI_INTRO_SEEN_COOKIE')
  })
})
