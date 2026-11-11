// 各校 Facebook 貼文收件匣（docs/specs/2026-10-28-facebook-news-sync-design.md）。
import { afterEach, describe, expect, it } from 'vitest'
import { flushPromises, type VueWrapper } from '@vue/test-utils'
import FacebookPostsView from '../views/FacebookPostsView.vue'
import viewSource from '../views/FacebookPostsView.vue?raw'
import type { FacebookImportOut, FacebookPostListOut, FacebookPostOut } from '../api/types'
import { canListNavItem, navItem } from '../router/nav'
import { campusAdmin, cleanup, mockGet, mockPost, mountWith } from './admissionsTestKit'
import { testUser } from './fixtures'

afterEach(() => cleanup())

function post(overrides: Partial<FacebookPostOut> = {}): FacebookPostOut {
  return {
    id: 'p1',
    campus_key: 'yihua',
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
    sync_seconds: 3600,
    sync: { last_attempt_at: '2026-10-28T01:00:00Z', last_success_at: '2026-10-28T01:00:00Z', last_error: null, last_count: 1 },
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
    mockGet({ '/admin/facebook-posts': list({ sync: { last_attempt_at: '2026-10-28T01:00:00Z', last_success_at: null, last_error: '讀取貼文（HTTP 400、code 190）', last_count: null } }) })
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
