// 各校 Facebook 貼文收件匣（docs/specs/2026-10-28-facebook-news-sync-design.md）。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, type VueWrapper } from '@vue/test-utils'
import FacebookPostsView from '../views/FacebookPostsView.vue'
import viewSource from '../views/FacebookPostsView.vue?raw'
import type { FacebookImportOut, FacebookPostListOut, FacebookPostOut } from '../api/types'
import { notifyWarning } from '../composables/notify'
import { canListNavItem, navItem } from '../router/nav'
import { campusAdmin, cleanup, mockGet, mockPost, mountWith } from './admissionsTestKit'
import { testUser } from './fixtures'

vi.mock('../composables/notify', () => ({ notifyError: vi.fn(), notifyWarning: vi.fn() }))

afterEach(() => {
  cleanup()
  vi.mocked(notifyWarning).mockClear()
})

function post(overrides: Partial<FacebookPostOut> = {}): FacebookPostOut {
  return {
    id: 'p1',
    campus_key: 'yihua',
    source: 'facebook',
    message: '萬聖節變裝遊行\n\n孩子們穿上自己做的服裝。',
    posted_at: '2026-10-27T02:30:00Z',
    permalink_url: 'https://www.facebook.com/1_1',
    has_picture: true,
    has_video: false,
    status: 'new',
    article_id: null,
    handled_at: null,
    ...overrides,
  }
}

function list(overrides: Partial<FacebookPostListOut> = {}): FacebookPostListOut {
  return {
    configured: true,
    instagram_enabled: false,
    sync_seconds: 3600,
    sync: { last_attempt_at: '2026-10-28T01:00:00Z', last_success_at: '2026-10-28T01:00:00Z', last_error: null, last_count: 1, instagram: null },
    counts: { new: 1, imported: 0, dismissed: 0 },
    posts: [post()],
    ...overrides,
  }
}

function imported(overrides: Partial<FacebookImportOut> = {}): FacebookImportOut {
  return {
    post: post({ status: 'imported' }),
    article_id: 'fb-1-1',
    article_title: '萬聖節變裝派對',
    content_version: 2,
    video_included: false,
    video_skipped_reason: null,
    ...overrides,
  }
}

const button = (wrapper: VueWrapper, label: string) => wrapper.findAll('button').find((b) => b.text() === label)

describe('Facebook 貼文', () => {
  it('列出貼文：照片走 API 代理、顯示同步時間與各狀態數量', async () => {
    const get = mockGet({ '/admin/facebook-posts': list() })
    const { wrapper, router } = await mountWith(FacebookPostsView, { path: '/content/facebook-posts' })
    expect(get).toHaveBeenCalledWith('/admin/facebook-posts?campus_key=yihua&status=new')
    expect(wrapper.get('.fb-post img').attributes('src')).toBe('/api/website/v1/admin/facebook-posts/p1/picture')
    expect(wrapper.text()).toContain('每 1 小時自動同步')
    expect(wrapper.text()).toContain('未處理 1')
    expect(router.currentRoute.value.query.campus).toBe('yihua')
  })

  it('還沒設定粉專：說明怎麼接上，不顯示同步鈕', async () => {
    mockGet({ '/admin/facebook-posts': list({ configured: false, sync: null, posts: [] }) })
    const { wrapper } = await mountWith(FacebookPostsView, { path: '/content/facebook-posts' })
    expect(wrapper.text()).toContain('還沒接上 Facebook 粉專')
    expect(button(wrapper, '立即同步')).toBeUndefined()
  })

  // 2026-11-11 QA：沒接粉專的分校沒有「立即同步」鈕，頁首動作區只剩下拉，
  // 沒有固定寬度時縮成 44px、看不到校名。寬度比照參觀場次頁的校區下拉。
  it('校區下拉有固定寬度，不靠旁邊的同步鈕撐開', async () => {
    mockGet({ '/admin/facebook-posts': list({ configured: false, sync: null, posts: [] }) })
    const { wrapper } = await mountWith(FacebookPostsView, { path: '/content/facebook-posts' })
    expect(wrapper.get('.page-header__actions .el-select').classes()).toContain('fb-campus')
    expect(viewSource).toMatch(/\.fb-campus\.el-select \{ width: 160px; \}/)
    const mobile = viewSource.slice(viewSource.lastIndexOf('@media (max-width: 720px)'))
    expect(mobile).toMatch(/\.fb-campus\.el-select \{ width: 100%; \}/)
  })

  it('同步說明的逗號後面沒有多一個空白', async () => {
    mockGet({ '/admin/facebook-posts': list() })
    const { wrapper } = await mountWith(FacebookPostsView, { path: '/content/facebook-posts' })
    expect(wrapper.get('.fb-sync').text()).toMatch(/^上次同步 [^，]+，之後每 1 小時自動同步一次。$/)
  })

  it('轉成消息草稿後提示去發布並重新載入', async () => {
    const get = mockGet({ '/admin/facebook-posts': list() })
    const posted = mockPost({ '/admin/facebook-posts/p1/import': imported() })
    const { wrapper } = await mountWith(FacebookPostsView, { path: '/content/facebook-posts' })
    expect(wrapper.find('.fb-post__video').exists()).toBe(false)
    await button(wrapper, '轉成消息草稿')!.trigger('click')
    await flushPromises()
    expect(posted).toHaveBeenCalledWith('/admin/facebook-posts/p1/import')
    expect(get).toHaveBeenCalledTimes(2)
    expect(wrapper.get('.fb-imported').text()).toContain('「萬聖節變裝派對」已加到')  // 用實際存進去的標題，不是原文第一行
    expect(wrapper.get('.fb-imported').text()).not.toContain('影片')
    expect(wrapper.get('.fb-imported a').attributes('href')).toContain('/content/campus-news?campus=yihua')
  })

  it('影片貼文標出「影片」；轉成草稿後說明影片也放進內文、要等轉檔', async () => {
    mockGet({ '/admin/facebook-posts': list({ posts: [post({ has_video: true })] }) })
    mockPost({ '/admin/facebook-posts/p1/import': imported({ video_included: true }) })
    const { wrapper } = await mountWith(FacebookPostsView, { path: '/content/facebook-posts' })
    expect(wrapper.get('.fb-post__video').text()).toBe('影片')
    await button(wrapper, '轉成消息草稿')!.trigger('click')
    await flushPromises()
    expect(wrapper.get('.fb-imported').text()).toContain('影片也放進內文了。轉檔要幾分鐘，轉好之後才能發布。')
  })

  it('影片沒帶進來（太大、太長）時照樣轉成草稿，並把原因講出來', async () => {
    mockGet({ '/admin/facebook-posts': list({ posts: [post({ has_video: true })] }) })
    mockPost({ '/admin/facebook-posts/p1/import': imported({ video_skipped_reason: '影片超過 150 MB' }) })
    const { wrapper } = await mountWith(FacebookPostsView, { path: '/content/facebook-posts' })
    await button(wrapper, '轉成消息草稿')!.trigger('click')
    await flushPromises()
    const alert = wrapper.get('.fb-imported').text()
    expect(alert).toContain('「萬聖節變裝派對」已加到')
    expect(alert).toContain('影片沒有帶進來（影片超過 150 MB）')
  })

  it('沒有照片的貼文不能轉成消息', async () => {
    mockGet({ '/admin/facebook-posts': list({ posts: [post({ has_picture: false })] }) })
    const { wrapper } = await mountWith(FacebookPostsView, { path: '/content/facebook-posts' })
    expect(button(wrapper, '轉成消息草稿')!.attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('沒有照片的貼文不能轉成消息')
  })

  it('同步失敗把原因顯示出來', async () => {
    mockGet({ '/admin/facebook-posts': list({ sync: { last_attempt_at: '2026-10-28T01:00:00Z', last_success_at: null, last_error: '讀取貼文（HTTP 400、code 190）', last_count: null, instagram: null } }) })
    const { wrapper } = await mountWith(FacebookPostsView, { path: '/content/facebook-posts' })
    expect(wrapper.text()).toContain('讀取貼文（HTTP 400、code 190）')
    expect(wrapper.text()).toContain('還沒同步過')
  })

  it('唯讀帳號只看不能動；分校管理者看得到這一頁', async () => {
    mockGet({ '/admin/facebook-posts': list() })
    const viewer = testUser('readonly', { id: 'ro', email: 'ro@example.invalid', campus_keys: ['yihua'] })
    const { wrapper } = await mountWith(FacebookPostsView, { path: '/content/facebook-posts', user: viewer })
    expect(button(wrapper, '轉成消息草稿')).toBeUndefined()
    expect(button(wrapper, '略過')).toBeUndefined()
    expect(canListNavItem(navItem('facebook-posts')!, campusAdmin(), {})).toBe(true)
  })
})

// ---- Instagram 貼文進同一個收件匣（docs/specs/2026-11-12-external-integrations-design.md §2）----

type InstagramStatus = NonNullable<NonNullable<FacebookPostListOut['sync']>['instagram']>
const IG_OK: InstagramStatus = { last_attempt_at: '2026-10-28T01:00:00Z', last_success_at: '2026-10-28T01:00:00Z', last_error: null, last_count: 3 }
const NO_ACCOUNT = '粉專沒有連結 Instagram 專業帳號'
const NO_PERMISSION = '權杖沒有 Instagram 權限'

function withInstagram(overrides: Partial<FacebookPostListOut> = {}, instagram: Partial<InstagramStatus> = {}): FacebookPostListOut {
  const base = list()
  return list({
    instagram_enabled: true,
    sync: { ...base.sync!, instagram: { ...IG_OK, ...instagram } },
    counts: { new: 2, imported: 0, dismissed: 0 },
    posts: [post(), post({ id: 'p2', source: 'instagram', permalink_url: 'https://www.instagram.com/p/2/', message: 'Instagram 貼文' })],
    ...overrides,
  })
}

const radioLabels = (wrapper: VueWrapper, label: string) =>
  wrapper.get(`[aria-label="${label}"]`).findAll('.el-radio-button').map((el) => el.text())

describe('Instagram 貼文', () => {
  it('沒開 Instagram 時頁面跟以前一樣：沒有來源標示、來源篩選與 Instagram 同步行', async () => {
    mockGet({ '/admin/facebook-posts': list() })
    const { wrapper } = await mountWith(FacebookPostsView, { path: '/content/facebook-posts' })
    expect(wrapper.find('.fb-post__source').exists()).toBe(false)
    expect(wrapper.find('[aria-label="貼文來源"]').exists()).toBe(false)
    expect(wrapper.find('.fb-sync-ig').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Instagram')
    expect(wrapper.get('.fb-post__meta a').text()).toBe('在 Facebook 看 ↗')
  })

  it('每則貼文標出來源，原文連結寫對平台', async () => {
    mockGet({ '/admin/facebook-posts': withInstagram() })
    const { wrapper } = await mountWith(FacebookPostsView, { path: '/content/facebook-posts' })
    const posts = wrapper.findAll('.fb-post')
    expect(posts.map((el) => el.get('.fb-post__source').text())).toEqual(['Facebook', 'Instagram'])
    expect(posts[0]!.get('.fb-post__meta a').text()).toBe('在 Facebook 看 ↗')
    expect(posts[1]!.get('.fb-post__meta a').text()).toBe('在 Instagram 看 ↗')
    expect(posts[1]!.get('.fb-post__meta a').attributes('href')).toBe('https://www.instagram.com/p/2/')
  })

  it('已經存在的 Instagram 貼文，就算之後關掉開關也照樣標出來源', async () => {
    mockGet({ '/admin/facebook-posts': withInstagram({ instagram_enabled: false }) })
    const { wrapper } = await mountWith(FacebookPostsView, { path: '/content/facebook-posts' })
    expect(wrapper.findAll('.fb-post__source').map((el) => el.text())).toEqual(['Facebook', 'Instagram'])
    expect(wrapper.find('[aria-label="貼文來源"]').exists()).toBe(false)
  })

  it('可依來源篩選：選了才帶 source，選回「全部」就不帶', async () => {
    const get = mockGet({ '/admin/facebook-posts': withInstagram() })
    const { wrapper } = await mountWith(FacebookPostsView, { path: '/content/facebook-posts' })
    expect(radioLabels(wrapper, '貼文來源')).toEqual(['全部', 'Facebook', 'Instagram'])
    expect(get).toHaveBeenLastCalledWith('/admin/facebook-posts?campus_key=yihua&status=new')

    const inputs = wrapper.get('[aria-label="貼文來源"]').findAll('input')
    await inputs[2]!.setValue(true)
    await flushPromises()
    expect(get).toHaveBeenLastCalledWith('/admin/facebook-posts?campus_key=yihua&status=new&source=instagram')
    await inputs[0]!.setValue(true)
    await flushPromises()
    expect(get).toHaveBeenLastCalledWith('/admin/facebook-posts?campus_key=yihua&status=new')
  })

  it('同步狀態多一行 Instagram：上次同步時間與讀到幾則', async () => {
    mockGet({ '/admin/facebook-posts': withInstagram() })
    const { wrapper } = await mountWith(FacebookPostsView, { path: '/content/facebook-posts' })
    expect(wrapper.get('.fb-sync-ig').text()).toMatch(/^Instagram：上次同步 [^，]+，讀到 3 則貼文。$/)
    // Facebook 那一行不變。
    expect(wrapper.get('.fb-sync').text()).toMatch(/^上次同步 [^，]+，之後每 1 小時自動同步一次。$/)
    expect(wrapper.find('.el-alert--warning').exists()).toBe(false)
  })

  it('Instagram 還沒同步過', async () => {
    mockGet({ '/admin/facebook-posts': withInstagram({}, { last_attempt_at: null, last_success_at: null, last_count: null }) })
    const { wrapper } = await mountWith(FacebookPostsView, { path: '/content/facebook-posts' })
    expect(wrapper.get('.fb-sync-ig').text()).toBe('Instagram：還沒同步過。')
  })

  it('還沒有任何同步紀錄時，Instagram 也寫「還沒同步過」', async () => {
    mockGet({ '/admin/facebook-posts': withInstagram({ sync: null, posts: [], counts: { new: 0, imported: 0, dismissed: 0 } }) })
    const { wrapper } = await mountWith(FacebookPostsView, { path: '/content/facebook-posts' })
    expect(wrapper.get('.fb-sync-ig').text()).toBe('Instagram：還沒同步過。')
    expect(wrapper.find('.fb-ig-error').exists()).toBe(false)
  })

  it.each([
    [NO_ACCOUNT, '轉成專業帳號並連結'],
    [NO_PERMISSION, 'instagram_basic'],
    ['讀取 Instagram 貼文（HTTP 400、code 190）', '檢查 Meta 的設定'],
  ])('Instagram 同步失敗「%s」：說明原因與怎麼辦，而且講明 Facebook 不受影響', async (error, hint) => {
    mockGet({ '/admin/facebook-posts': withInstagram({}, { last_error: error, last_success_at: null, last_count: null }) })
    const { wrapper } = await mountWith(FacebookPostsView, { path: '/content/facebook-posts' })
    const alert = wrapper.get('.fb-ig-error')
    expect(alert.text()).toContain('Instagram 最近一次同步失敗')
    expect(alert.text()).toContain(error)
    expect(alert.text()).toContain(hint)
    expect(alert.text()).toContain('Facebook 貼文不受影響')
  })

  it('Facebook 失敗時只顯示 Facebook 的警告，不把 Instagram 的狀態混進去', async () => {
    const data = withInstagram()
    data.sync = { ...data.sync!, last_error: '讀取貼文（HTTP 400、code 190）', last_success_at: null }
    mockGet({ '/admin/facebook-posts': data })
    const { wrapper } = await mountWith(FacebookPostsView, { path: '/content/facebook-posts' })
    expect(wrapper.text()).toContain('讀取貼文（HTTP 400、code 190）')
    expect(wrapper.find('.fb-ig-error').exists()).toBe(false)
  })

  it('立即同步：Instagram 失敗時提醒，Facebook 的結果照樣更新', async () => {
    mockGet({ '/admin/facebook-posts': withInstagram() })
    const failed = withInstagram({}, { last_error: NO_PERMISSION, last_count: null })
    const posted = mockPost({ '/admin/facebook-posts/sync': failed })
    const { wrapper } = await mountWith(FacebookPostsView, { path: '/content/facebook-posts' })
    await button(wrapper, '立即同步')!.trigger('click')
    await flushPromises()
    expect(posted).toHaveBeenCalledWith('/admin/facebook-posts/sync', { campus_key: 'yihua' })
    expect(notifyWarning).toHaveBeenCalledWith(`Instagram 同步失敗：${NO_PERMISSION}`)
    expect(wrapper.get('.fb-ig-error').text()).toContain(NO_PERMISSION)
  })

  it('立即同步成功後回到「全部」來源（同步的回應是全部來源的未處理貼文）', async () => {
    const get = mockGet({ '/admin/facebook-posts': withInstagram() })
    mockPost({ '/admin/facebook-posts/sync': withInstagram() })
    const { wrapper } = await mountWith(FacebookPostsView, { path: '/content/facebook-posts' })
    await wrapper.get('[aria-label="貼文來源"]').findAll('input')[2]!.setValue(true)
    await flushPromises()
    await button(wrapper, '立即同步')!.trigger('click')
    await flushPromises()
    expect(get).toHaveBeenLastCalledWith('/admin/facebook-posts?campus_key=yihua&status=new')
    expect(wrapper.get('[aria-label="貼文來源"]').find('.el-radio-button.is-active').text()).toBe('全部')
  })

  it('標題與說明提到 Instagram，轉成消息的按鈕不變', async () => {
    mockGet({ '/admin/facebook-posts': withInstagram() })
    const { wrapper } = await mountWith(FacebookPostsView, { path: '/content/facebook-posts' })
    expect(wrapper.get('.page-header').text()).toContain('Instagram')
    expect(wrapper.findAll('.fb-post').every((el) => el.findAll('button').some((b) => b.text() === '轉成消息草稿'))).toBe(true)
  })
})
