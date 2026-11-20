// 成效統計資料核對（2026-11-20）：統計起算日（前後端一致）、期間文字、Google 搜尋期間截斷、
// 搜尋路徑解碼、「登入過後台」的瀏覽器記號。
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readablePath, searchPeriod } from '../api/googleInsights'
import { STATS_START, periodText } from '../components/analytics/filters'
import { STAFF_COOKIE, markStaffBrowser, staffCookie, staffCookieDomain } from '../utils/staffBrowser'

const repo = (path: string) => readFileSync(resolve(__dirname, '../../..', path), 'utf8')

describe('成效統計起算日', () => {
  it('和後端 analytics_stats_start 的預設值一致', () => {
    const match = /analytics_stats_start: date \| None = date\((\d{4}), (\d{1,2}), (\d{1,2})\)/.exec(repo('backend/app/config.py'))
    expect(match).not.toBeNull()
    const [, year, month, day] = match!
    expect(STATS_START).toBe(`${year}-${month!.padStart(2, '0')}-${day!.padStart(2, '0')}`)
  })

  it('期間剛好從起算日開始時補一句，其他期間照舊', () => {
    expect(periodText('2026-11-13', '2026-11-20')).toBe('2026/11/13–2026/11/20（官網 11/13 起才列入統計）')
    expect(periodText('2026-11-14', '2026-11-20')).toBe('2026/11/14–2026/11/20')
  })

  it('Google 搜尋的期間碰到起算日就從起算日開始；起算日還沒到不截', () => {
    expect(searchPeriod(28, '2026-11-20')).toEqual({ start: '2026-11-13', end: '2026-11-20' })
    expect(searchPeriod(7, '2026-11-20')).toEqual({ start: '2026-11-14', end: '2026-11-20' })
    expect(searchPeriod(90, '2027-03-01')).toEqual({ start: '2026-12-02', end: '2027-03-01' })
    expect(searchPeriod(28, '2026-11-12')).toEqual({ start: '2026-10-16', end: '2026-11-12' })
  })

  it('搜尋頁面的路徑顯示解碼後的中文，解不開照原樣', () => {
    expect(readablePath('/%E4%BB%81%E6%AD%A6%E6%A0%A1%E4%BB%8B%E7%B4%B9')).toBe('/仁武校介紹')
    expect(readablePath('/about')).toBe('/about')
    expect(readablePath('/%E4%BB')).toBe('/%E4%BB')
  })
})

describe('登入過後台的瀏覽器記號（utils/staffBrowser.ts）', () => {
  it('名稱和官網讀的那個一致', () => {
    expect(repo('web/shared/staff-browser.ts')).toContain(`export const STAFF_COOKIE = '${STAFF_COOKIE}'`)
  })

  it('admin 子網域寫在上層網域，其他主機只寫在目前主機；https 才加 Secure', () => {
    expect(staffCookieDomain('admin.ivykidschool.com')).toBe('ivykidschool.com')
    expect(staffCookieDomain('www.ivykidschool.com')).toBeNull()
    expect(staffCookieDomain('localhost')).toBeNull()
    expect(staffCookieDomain('admin.localhost')).toBeNull()
    expect(staffCookie({ hostname: 'admin.ivykidschool.com', protocol: 'https:' }))
      .toBe('ivy_staff=1; Path=/; Max-Age=34560000; SameSite=Lax; Domain=ivykidschool.com; Secure')
    expect(staffCookie({ hostname: 'localhost', protocol: 'http:' })).toBe('ivy_staff=1; Path=/; Max-Age=34560000; SameSite=Lax')
  })

  it('寫入失敗不影響登入', () => {
    const target = { location: { hostname: 'admin.ivykidschool.com', protocol: 'https:' }, document: {} as Pick<Document, 'cookie'> }
    Object.defineProperty(target.document, 'cookie', { set: () => { throw new Error('blocked') } })
    expect(() => markStaffBrowser(target)).not.toThrow()
    const written = { location: { hostname: 'localhost', protocol: 'http:' }, document: { cookie: '' } }
    markStaffBrowser(written)
    expect(written.document.cookie).toContain('ivy_staff=1')
  })

  it('登入與恢復登入成功都會寫記號', () => {
    const auth = repo('admin/src/stores/auth.ts')
    expect(auth.match(/markStaffBrowser\(\)/g)).toHaveLength(2)
  })
})
