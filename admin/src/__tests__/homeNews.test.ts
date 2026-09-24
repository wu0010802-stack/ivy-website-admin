import { describe, expect, it } from 'vitest'
import { missingGlyphs } from '../composables/useTitleFontCoverage'
import { NAV_GROUPS } from '../router/nav'
import { CONTENT_KIND_LABELS, contentPublicPath } from '../api/labels'

describe('最新消息與活動（home_news）', () => {
  it('側欄在首頁組、只給 super_admin，發布後開首頁', () => {
    const home = NAV_GROUPS.find(group => group.key === 'home')!
    const item = home.items.find(i => i.name === 'home-news')!
    expect(item.path).toBe('/content/home-news')
    expect(item.roles).toEqual(['super_admin'])
    expect(CONTENT_KIND_LABELS.home_news).toBe('最新消息與活動')
    expect(contentPublicPath('home_news')).toBe('/')
  })

  it('標題缺字提示：列出字表沒有的字，重複與空白不列', () => {
    const available = new Set('小園丁把好奇心種進生活裡。')
    expect(missingGlyphs('小小園丁 把好奇心種進菜菜園！', available)).toEqual(['菜', '！'])
    expect(missingGlyphs('小園丁', available)).toEqual([])
  })
})
