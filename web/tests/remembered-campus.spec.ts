import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { REMEMBERED_CAMPUS_COOKIE, REMEMBERED_CAMPUS_MAX_AGE, rememberedCampusWritable, validRememberedCampus } from '../app/utils/remembered-campus'

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const KEYS = ['yihua', 'minghua', 'chongde', 'international', 'renwu']

describe('記住家長看過的校區（ivy_campus）', () => {
  it('cookie 名稱與 180 天', () => {
    expect(REMEMBERED_CAMPUS_COOKIE).toBe('ivy_campus')
    expect(REMEMBERED_CAMPUS_MAX_AGE).toBe(180 * 86400)
  })
  it('只收站內內容裡存在的校區 key，其他一律忽略', () => {
    expect(validRememberedCampus('minghua', KEYS)).toBe('minghua')
    for (const bad of ['', 'nope', 'YIHUA', ' yihua', 3, null, undefined, ['yihua'], { a: 1 }, '__proto__']) {
      expect(validRememberedCampus(bad, KEYS)).toBeNull()
    }
    expect(validRememberedCampus('minghua', [])).toBeNull()
  })
  it('/admin、/preview 底下不寫入', () => {
    for (const path of ['/', '/visit', '/visit/yihua', '/environment']) expect(rememberedCampusWritable(path)).toBe(true)
    for (const path of ['/admin', '/admin/news', '/preview', '/preview/', '/Preview/x']) expect(rememberedCampusWritable(path)).toBe(false)
    expect(rememberedCampusWritable('/previews')).toBe(true)
  })
  it('composable 的 cookie 屬性：Lax、非 dev 加 Secure、不設 httpOnly、Path=/', () => {
    const source = read('../app/composables/useRememberedCampus.ts')
    expect(source).toContain("sameSite: 'lax'")
    expect(source).toContain('secure: !import.meta.dev')
    expect(source).toContain('httpOnly: false')
    expect(source).toContain("path: '/'")
    expect(source).toContain('maxAge: REMEMBERED_CAMPUS_MAX_AGE')
  })
  it('三個寫入點都只在訪客主動選時呼叫；自動輪播不呼叫', () => {
    const header = read('../app/components/SiteHeader.vue')
    expect(header).toContain('@click="chooseMenuCampus(c.key)"')
    expect(header).not.toContain('@pointerenter="onCampusPointerEnter($event, c.key)"\n            @focus="chooseMenuCampus')
    expect(header).toContain('remembered.recall(campusKeys.value)')
    const board = read('../app/components/CampusBoard.vue')
    expect(board).toContain('onAdvance: () => select(index.value + 1, true)')
    expect(board).toContain('remembered.remember(key, rememberedKeys.value)')
    expect(board).toContain('remembered.recall(rememberedKeys.value) ?? props.board.defaultCampus')
    expect(board).not.toMatch(/onAdvance: \(\) => pick/)
    const visit = read('../app/components/VisitForm.vue')
    expect(visit).toContain('@click="rememberCampus(campus.key)"')
    expect(visit).toContain('props.routeCampus || \'\'')
  })
})
