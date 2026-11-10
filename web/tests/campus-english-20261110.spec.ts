// 2026-11-10 使用者：「分校資訊這邊本來底下有英文，每校下面本來也有英文，可以幫我加回來嗎」。
// 10-30 拿掉重複文字時一起拿掉的兩處英文（Campuses、YIHUA CAMPUS）加回來，其餘 10-30 拿掉的字照舊不出現。
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import fixture from '../server/data/site-fixture.json'
import type { SiteContent } from '../app/types/site-content'
import { publicCopy } from '../app/utils/public-copy'

const here = dirname(fileURLToPath(import.meta.url))
const board = readFileSync(resolve(here, '../app/components/CampusBoard.vue'), 'utf8')
const site = fixture as unknown as SiteContent

describe('首頁分校資訊的英文', () => {
  it('區塊標題的英文照後台內容顯示，原文 Campuses 不再被換成空字串', () => {
    expect(site.home.campusBoard.eyebrow).toBe('Campuses')
    expect(publicCopy(site).home.campusBoard.eyebrow).toBe('Campuses')
    const withEyebrow = (eyebrow: string) => publicCopy({ ...site, home: { ...site.home, campusBoard: { ...site.home.campusBoard, eyebrow } } }).home.campusBoard.eyebrow
    expect(withEyebrow('Our Campuses')).toBe('Our Campuses')
    // 園方在後台清空就不顯示（元件 v-if）
    expect(withEyebrow('')).toBe('')
    expect(board).toContain('<span v-if="board.eyebrow" lang="en">{{ board.eyebrow }}</span><h2 id="campuses-heading">')
  })

  it('每校校名下面有一行英文校名（YIHUA CAMPUS 這種），標 lang="en"', () => {
    expect(board).toMatch(/<h3>\{\{ current\.name \}\}<\/h3>\s*<span lang="en">\{\{ current\.key\.toUpperCase\(\) \}\} CAMPUS<\/span>/)
    // 英文是小字：用區塊自己的拉丁字型與 token 字級，手機再小一級
    expect(board).toContain('.campus-identity [lang=en]{display:block;font-family:var(--font-latin);font-size:var(--fs-xs);letter-spacing:.15em;color:var(--heading-accent)}')
    expect(board).toContain('.campus-identity [lang=en]{font-size:11px;letter-spacing:.13em}')
    // 五個 key 都是英文字母，轉大寫後就是英文校名
    for (const campus of site.campuses) expect(campus.key).toMatch(/^[a-z]+$/)
  })

  it('10-30 拿掉的其他英文小字照舊不顯示', () => {
    const result = publicCopy(site)
    expect(result.home.about.sinceLabel).toBe('')
    expect(result.dayExperience.filmCaption.en).toBe('')
  })
})
