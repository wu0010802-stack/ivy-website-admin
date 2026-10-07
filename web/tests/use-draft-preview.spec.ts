// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import fixture from '../server/data/site-fixture.json'
import { useDraftPreview } from '../app/composables/useDraftPreview'

// 2026-10-06 方向 D：render 可以多帶一份「還沒存的」內容，只蓋掉那一項，其他照舊是各自最新草稿。
const footerPayload = { tagline: '已存的標語', copyright: '©', bottom_note: '', campus_list_label: '五校聯絡' }

function stubFetch(authorized = true) {
  vi.stubGlobal('$fetch', vi.fn(async (url: string) => {
    if (url === '/api/website/v1/auth/me') {
      if (!authorized) throw new Error('401')
      return { csrf_token: 't', user: { id: 'u', email: 'a@example.invalid', role: 'super_admin', is_active: true, campus_keys: [] } }
    }
    if (url === '/api/site-fixture') return structuredClone(fixture)
    if (url.startsWith('/api/website/v1/admin/content-items/site_footer')) {
      return { id: 'i', kind: 'site_footer', campus_key: null, latest_version: 1, current_published_revision_id: 'r1', latest_revision: { id: 'r1', version: 1, payload: footerPayload, created_at: '2026-10-06T00:00:00Z' } }
    }
    if (url === '/api/website/v1/admin/media') return []
    throw new Error('404')
  }))
}

afterEach(() => vi.unstubAllGlobals())

describe('useDraftPreview 的即時內容', () => {
  it('沒帶即時內容時照舊顯示已存草稿；帶了只蓋掉那一項', async () => {
    stubFetch()
    const result = await useDraftPreview()
    expect(result.authorized).toBe(true)
    expect(result.campusKeys).toEqual(['yihua', 'minghua', 'chongde', 'international', 'renwu'])
    expect(result.render!('2026-10-06').content.footer.tagline).toBe('已存的標語')
    const live = result.render!('2026-10-06', { kind: 'site_footer', campusKey: null, payload: { ...footerPayload, tagline: '還沒存的標語' } })
    expect(live.content.footer.tagline).toBe('還沒存的標語')
    // 沒有被記住：下一次不帶就回到已存草稿。
    expect(result.render!('2026-10-06').content.footer.tagline).toBe('已存的標語')
  })

  it('分校內容只換那一校', async () => {
    stubFetch()
    const result = await useDraftPreview()
    const yihua = fixture.campuses.find((c) => c.key === 'yihua')!
    const profile = {
      name: yihua.name, district: '三民區', address: '高雄市三民區義華路68號', phone: '07-000-1234', intro: '', description: '',
      facebook: '', fb_note: '', line: '', map_url: '', cover: null, card_focus: null, hero_focus: null, line_art: null, line_art_colour: null, instagram: '', youtube: ''
    }
    const campuses = result.render!('2026-10-06', { kind: 'campus_profile', campusKey: 'yihua', payload: profile }).content.campuses
    expect(campuses.find((c) => c.key === 'yihua')!.phone).toBe('07-000-1234')
    const minghua = fixture.campuses.find((c) => c.key === 'minghua') as { phone?: string }
    expect(campuses.find((c) => c.key === 'minghua')!.phone).toBe(minghua.phone)
  })

  it('沒登入：不授權、沒有 render、沒有校區清單', async () => {
    stubFetch(false)
    expect(await useDraftPreview()).toEqual({ authorized: false, campusKeys: [], render: null })
  })
})
