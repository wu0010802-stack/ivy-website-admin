// 2026-10-06 方向 D（Task 12 fix round 1）：真的五校介紹頁（useCampusContent＋ContentEditor＋預覽欄）
// 表單有未存修改時換校，「放棄修改？」確認框開著那段時間，預覽不能把義華的內容標成明華送出。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { ElMessageBox } from 'element-plus'
import CampusProfileView from '../views/CampusProfileView.vue'
import { deferred, mockGet, mountWith, cleanup } from './admissionsTestKit'

// 正式站的建置：VITE_WEBSITE_ASSET_BASE 是空字串（後台與官網同源）。
vi.mock('../config', () => ({ WEBSITE_ASSET_BASE: '', websiteAssetUrl: (key: string) => `/assets/${key}.webp` }))

afterEach(() => {
  cleanup()
  sessionStorage.clear()
  localStorage.clear()
})

function profile(campus: string) {
  const name = `${campus}校`
  return {
    id: `item-${campus}`, kind: 'campus_profile', campus_key: campus, latest_version: 1, current_published_revision_id: null,
    latest_revision: {
      id: `rev-${campus}`, version: 1, created_at: '2026-10-06T02:00:00Z', review_status: 'draft', review_note: null,
      payload: { name, district: '', address: `${campus}路1號`, phone: '07-000-0000', intro: '', description: '', facebook: '', fb_note: '', line: '', map_url: '' },
    },
  }
}

const READY = { type: 'ivy-preview:ready', v: 1 }
function ready(frame: HTMLIFrameElement) {
  const event = new Event('message')
  Object.assign(event, { data: READY, origin: window.location.origin, source: frame.contentWindow })
  window.dispatchEvent(event)
}

async function openProfile() {
  mockGet({
    '/admin/content-items/campus_profile/schedules': [],
    '/admin/content-items/campus_profile/revisions': [],
    '/admin/content-items/campus_profile': (path: string) => profile(new URLSearchParams(path.split('?')[1]).get('campus_key')!),
  })
  const { wrapper } = await mountWith(CampusProfileView, { path: '/content/campus-profile?campus=yihua' })
  expect(wrapper.find('iframe').exists()).toBe(true)
  return wrapper
}

describe('五校介紹：有未存修改時換校，預覽跟著表單而不是選單', () => {
  it('確認框開著：預覽維持義華（不換 iframe、不送明華標籤）；確認並載入完成後才換成明華', async () => {
    const confirm = deferred<unknown>()
    vi.spyOn(ElMessageBox, 'confirm').mockReturnValue(confirm.promise as never)
    const wrapper = await openProfile()
    const first = wrapper.get('iframe').element as HTMLIFrameElement
    const firstPost = vi.spyOn(first.contentWindow!, 'postMessage').mockImplementation(() => {})
    ready(first)
    expect(firstPost).toHaveBeenCalledOnce()
    expect(firstPost.mock.calls[0]![0]).toMatchObject({ kind: 'campus_profile', campusKey: 'yihua', payload: { name: 'yihua校' } })

    // 有未存修改，再換校：確認框（未決）開著，選單已是明華，表單還是義華的修改
    await wrapper.get('input[placeholder="例如：義華校"]').setValue('義華改過的校名')
    const select = wrapper.findComponent({ name: 'CampusSelect' })
    select.vm.$emit('update:modelValue', 'minghua')
    await flushPromises()
    expect(wrapper.get('iframe').element).toBe(first)

    // 新的 iframe 沒有出現，舊 iframe 再握手也只會收到義華
    firstPost.mockClear()
    ready(first)
    expect(firstPost.mock.calls.map(([message]) => (message as { campusKey: string }).campusKey)).toEqual(['yihua'])
    expect(firstPost.mock.calls[0]![0]).toMatchObject({ payload: { name: '義華改過的校名' } })

    // 確認放棄：開始載入明華，骨架取代表單與預覽；載入完才長出新的 iframe，送的是明華的內容
    confirm.resolve('confirm')
    await flushPromises()
    const second = wrapper.get('iframe').element as HTMLIFrameElement
    expect(second).not.toBe(first)
    const secondPost = vi.spyOn(second.contentWindow!, 'postMessage').mockImplementation(() => {})
    ready(second)
    expect(secondPost).toHaveBeenCalledOnce()
    expect(secondPost.mock.calls[0]![0]).toMatchObject({ campusKey: 'minghua', payload: { name: 'minghua校' } })
  })

  it('按取消：選單撥回義華，預覽不重建、仍送義華的內容', async () => {
    const confirm = deferred<unknown>()
    vi.spyOn(ElMessageBox, 'confirm').mockReturnValue(confirm.promise as never)
    const wrapper = await openProfile()
    const first = wrapper.get('iframe').element as HTMLIFrameElement
    const post = vi.spyOn(first.contentWindow!, 'postMessage').mockImplementation(() => {})
    ready(first)
    await wrapper.get('input[placeholder="例如：義華校"]').setValue('義華改過的校名')
    wrapper.findComponent({ name: 'CampusSelect' }).vm.$emit('update:modelValue', 'minghua')
    await flushPromises()
    confirm.reject('cancel')
    await flushPromises()
    expect(wrapper.findComponent({ name: 'CampusSelect' }).props('modelValue')).toBe('yihua')
    expect(wrapper.get('iframe').element).toBe(first)
    post.mockClear()
    ready(first)
    expect(post.mock.calls.map(([message]) => (message as { campusKey: string }).campusKey)).toEqual(['yihua'])
    expect(post.mock.calls[0]![0]).toMatchObject({ payload: { name: '義華改過的校名' } })
  })
})
