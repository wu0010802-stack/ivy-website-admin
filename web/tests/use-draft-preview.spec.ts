// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import fixture from '../server/data/site-fixture.json'
import { useDraftPreview } from '../app/composables/useDraftPreview'

// 2026-10-06 方向 D：render 可以多帶一份「還沒存的」內容，只蓋掉那一項，其他照舊是各自最新草稿。
const footerPayload = { tagline: '已存的標語', copyright: '©', bottom_note: '', campus_list_label: '五校聯絡' }

function mediaAsset(id: string, width: number) {
  return {
    id, kind: 'image', status: 'ready', content_type: 'image/jpeg', width, height: 600, alt_text: `素材 ${id.slice(0, 4)}`,
    crop_focus_x: null, crop_focus_y: null, variants: []
  }
}

// 後台素材列表分頁回傳（每頁上限 200）：media 是全部素材，依網址的 page 切出那一頁。
function mediaPage(url: string, media: ReturnType<typeof mediaAsset>[]) {
  const params = new URL(url, 'http://test').searchParams
  const page = Number(params.get('page'))
  const size = Number(params.get('page_size'))
  return { items: media.slice((page - 1) * size, page * size), total: media.length, state_total: media.length, page, page_size: size, tags: [] }
}

function stubFetch(authorized = true, media: ReturnType<typeof mediaAsset>[] | null = []) {
  const fetch = vi.fn(async (url: string) => {
    if (url === '/api/website/v1/auth/me') {
      if (!authorized) throw new Error('401')
      return { csrf_token: 't', user: { id: 'u', email: 'a@example.invalid', role: 'super_admin', is_active: true, campus_keys: [] } }
    }
    if (url === '/api/site-fixture') return structuredClone(fixture)
    if (url.startsWith('/api/website/v1/admin/content-items/site_footer')) {
      return { id: 'i', kind: 'site_footer', campus_key: null, latest_version: 1, current_published_revision_id: 'r1', latest_revision: { id: 'r1', version: 1, payload: footerPayload, created_at: '2026-10-06T00:00:00Z' } }
    }
    if (url.startsWith('/api/website/v1/admin/media?')) {
      if (media === null) throw new Error('500')
      return mediaPage(url, media)
    }
    throw new Error('404')
  })
  vi.stubGlobal('$fetch', fetch)
  return fetch
}

afterEach(() => vi.unstubAllGlobals())

// 2026-11-12 QA L8：分校帳號讀不到別校的 campus_profile／campus_news（後台 API 回 404）。原本照樣逐校去要，
// 每開一次編輯器就是 8 個 404 與 console 錯誤，別校還退回內建內容、和官網不同。讀不到的校區不去要，改用官網已發布的。
describe('分校帳號的草稿預覽', () => {
  const minghuaPublished = { name: '明華校（官網已發布）', district: '左營區', address: '高雄市左營區明華一路 1 號', phone: '07-111-2222' }
  const yihuaDraft = { name: '義華校（草稿）', district: '三民區', address: '高雄市三民區義華路 68 號', phone: '07-000-1234' }

  function stubCampusUser() {
    const fetch = vi.fn(async (url: string) => {
      if (url === '/api/website/v1/auth/me') {
        return { csrf_token: 't', user: { id: 'u', email: 'a@example.invalid', role: 'campus_admin', is_active: true, campus_keys: ['yihua'] } }
      }
      if (url === '/api/site-fixture') return structuredClone(fixture)
      if (url === '/api/website/v1/public/site') {
        return { schema_version: '1', release_id: 'r1', content: { campus_profile: { minghua: minghuaPublished, yihua: { ...yihuaDraft, name: '義華校（官網已發布）' } } }, media: {} }
      }
      if (url === '/api/website/v1/admin/content-items/campus_profile?campus_key=yihua') {
        return { id: 'i', kind: 'campus_profile', campus_key: 'yihua', latest_version: 2, current_published_revision_id: 'r1', latest_revision: { id: 'r2', version: 2, payload: yihuaDraft, created_at: '2026-11-12T00:00:00Z' } }
      }
      if (url.startsWith('/api/website/v1/admin/media?')) return mediaPage(url, [])
      throw new Error('404')
    })
    vi.stubGlobal('$fetch', fetch)
    return fetch
  }

  it('別校的分校介紹與消息不向後台要，改用官網已發布的；自己這一校照舊是最新草稿', async () => {
    const fetch = stubCampusUser()
    const result = await useDraftPreview()
    const asked = fetch.mock.calls.map(([url]) => url).filter((url) => /content-items\/campus_(profile|news)\?/.test(url))
    expect(asked.sort()).toEqual([
      '/api/website/v1/admin/content-items/campus_news?campus_key=yihua',
      '/api/website/v1/admin/content-items/campus_profile?campus_key=yihua'
    ])
    const campuses = result.render!('2026-11-12').content.campuses
    expect(campuses.find((c) => c.key === 'yihua')!.name).toBe('義華校（草稿）')
    expect(campuses.find((c) => c.key === 'minghua')!.name).toBe('明華校（官網已發布）')
  })

  it('總管理者照舊五校都向後台要', async () => {
    const fetch = stubFetch()
    await useDraftPreview()
    const asked = fetch.mock.calls.map(([url]) => url).filter((url) => /content-items\/campus_profile\?/.test(url))
    expect(asked).toHaveLength(5)
  })
})

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
      name: yihua.name, district: '三民區', address: '高雄市三民區義華路68號', phone: '07-000-1234',
      facebook: '', line: '', map_url: '', cover: null, card_focus: null, hero_focus: null, line_art: null, line_art_colour: null, instagram: '', youtube: ''
    }
    const campuses = result.render!('2026-10-06', { kind: 'campus_profile', campusKey: 'yihua', payload: profile }).content.campuses
    expect(campuses.find((c) => c.key === 'yihua')!.phone).toBe('07-000-1234')
    const minghua = fixture.campuses.find((c) => c.key === 'minghua') as { phone?: string }
    expect(campuses.find((c) => c.key === 'minghua')!.phone).toBe(minghua.phone)
  })

  it('素材逐頁讀完：第 2 頁的素材選進即時內容也有尺寸', async () => {
    const media = Array.from({ length: 201 }, (_, i) => mediaAsset(`${String(i).padStart(8, '0')}-0000-4000-8000-000000000000`, 1000 + i))
    const fetch = stubFetch(true, media)
    const result = await useDraftPreview()
    const mediaUrls = fetch.mock.calls.map(([url]) => url).filter((url) => url.startsWith('/api/website/v1/admin/media'))
    expect(mediaUrls).toEqual([
      '/api/website/v1/admin/media?exclude_failed=true&page=1&page_size=200',
      '/api/website/v1/admin/media?exclude_failed=true&page=2&page_size=200'
    ])
    const last = media[200]!
    const about = { title: '關於', since_label: '', body_text: '', caption: '', photo: { media_id: last.id, focus_x: null, focus_y: null } }
    const photo = result.render!('2026-10-06', { kind: 'home_about', campusKey: null, payload: about }).content.home.about.photos[0]!
    expect(photo.media?.width).toBe(1200)
    expect(photo.media?.alt).toBe(last.alt_text)
  })

  it('素材讀不到：照樣出得來，素材沒有尺寸', async () => {
    stubFetch(true, null)
    const result = await useDraftPreview()
    const about = { title: '關於', since_label: '', body_text: '', caption: '', photo: { media_id: '00000000-0000-4000-8000-000000000000', focus_x: null, focus_y: null } }
    const photo = result.render!('2026-10-06', { kind: 'home_about', campusKey: null, payload: about }).content.home.about.photos[0]!
    expect(photo.media?.width).toBeUndefined()
  })

  it('沒登入：不授權、沒有 render、沒有校區清單', async () => {
    stubFetch(false)
    expect(await useDraftPreview()).toEqual({ authorized: false, campusKeys: [], render: null })
  })
})
