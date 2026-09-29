import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import ElementPlus from 'element-plus'
import CampusProfileView from '../views/CampusProfileView.vue'
import { api } from '../api/client'
import { useAuthStore } from '../stores/auth'
import { testUser } from './fixtures'

const wrappers: VueWrapper[] = []
afterEach(() => { wrappers.forEach(wrapper => wrapper.unmount()); wrappers.length = 0; vi.restoreAllMocks() })

async function mountProfile() {
  const pinia = createPinia()
  useAuthStore(pinia).user = testUser('campus_admin', { id: 'me', email: 'me@example.invalid', campus_keys: ['yihua'] })
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: defineComponent({ template: '<div />' }) }] })
  await router.push('/'); await router.isReady()
  const wrapper = mount(CampusProfileView, { global: { plugins: [pinia, router, ElementPlus] } })
  wrappers.push(wrapper); await flushPromises()
  return wrapper
}

// 2026-09-25 以前存的版本：沒有 instagram／youtube 兩欄
const legacyPayload = {
  name: '義華校', district: '三民區', address: '高雄市三民區義華路68號', phone: '07-392-8366',
  intro: '簡介', description: '介紹', facebook: 'https://www.facebook.com/ivy.kids.fb/', fb_note: '義華校粉絲專頁', line: 'https://lin.ee/gwl8fnA',
}
const item = (payload: object, version = 1) => ({
  id: 'item', kind: 'campus_profile', campus_key: 'yihua', latest_version: version, current_published_revision_id: 'rev-1',
  latest_revision: { id: `rev-${version}`, version, created_at: '2026-09-25T01:00:00Z', payload, review_status: 'draft', review_note: null },
})

describe('五校介紹：IG／YouTube 欄位', () => {
  it('舊版本沒有這兩欄時表單補空白，填了會跟著存草稿送出', async () => {
    vi.spyOn(api, 'get').mockImplementation(async path => (String(path).includes('/content-items/campus_profile') ? item(legacyPayload) : []) as never)
    const post = vi.spyOn(api, 'post').mockImplementation(async (_path, body) => item((body as { payload: object }).payload, 2) as never)
    const wrapper = await mountProfile()

    const ig = wrapper.find<HTMLInputElement>('input[placeholder="https://www.instagram.com/…"]')
    const yt = wrapper.find<HTMLInputElement>('input[placeholder="https://www.youtube.com/@…"]')
    expect(ig.element.value).toBe('')
    expect(yt.element.value).toBe('')
    await ig.setValue('https://www.instagram.com/ivy.kids.school.ig/')
    await yt.setValue('https://www.youtube.com/@IvyKidsVideos')
    expect(wrapper.text()).toContain('改了 2 個欄位')

    await wrapper.findAll('button').find(b => b.text() === '儲存草稿')!.trigger('click')
    await flushPromises()
    expect(post).toHaveBeenCalledWith('/admin/content-items/campus_profile/revisions?campus_key=yihua', {
      expected_version: 1,
      // 其他欄位（地圖、封面…）照表單預設值送出；這裡只看舊欄位原樣保留、兩個新欄位有帶上
      payload: expect.objectContaining({ ...legacyPayload, instagram: 'https://www.instagram.com/ivy.kids.school.ig/', youtube: 'https://www.youtube.com/@IvyKidsVideos' }),
    })
  })
})
