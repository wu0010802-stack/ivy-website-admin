import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { computed, defineComponent } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter, matchedRouteKey } from 'vue-router'
import ElementPlus, { ElMessage } from 'element-plus'
import LineNotificationsView from '../views/LineNotificationsView.vue'
import { api, ApiError } from '../api/client'
import type { LineSettingsOut } from '../api/types'
import { useAuthStore } from '../stores/auth'
import { canSeeNavItem, navItem } from '../router/nav'
import { testUser } from './fixtures'

const GROUP = `C${'a'.repeat(32)}`
const LEFT = `C${'b'.repeat(32)}`
const ROOM = `R${'c'.repeat(32)}`

function settings(overrides: Partial<LineSettingsOut> = {}): LineSettingsOut {
  return {
    enabled: true,
    webhook_url: 'https://ivy.example/api/website/v1/line/webhook',
    groups: [
      { target_id: GROUP, source_type: 'group', name: '義華校務群', first_seen_at: '2026-09-24T01:00:00Z', last_seen_at: '2026-09-24T01:00:00Z', left_at: null, verified_at: '2026-09-24T01:05:00Z' },
      { target_id: LEFT, source_type: 'group', name: '舊群組', first_seen_at: '2026-09-20T01:00:00Z', last_seen_at: '2026-09-21T01:00:00Z', left_at: '2026-09-22T01:00:00Z', verified_at: null },
      { target_id: ROOM, source_type: 'room', name: null, first_seen_at: '2026-09-24T02:00:00Z', last_seen_at: '2026-09-24T02:00:00Z', left_at: null, verified_at: null },
    ],
    targets: [
      { campus_key: 'yihua', campus_name: '義華校', target_id: GROUP },
      { campus_key: 'minghua', campus_name: '明華校', target_id: null },
    ],
    ...overrides,
  }
}

const wrappers: VueWrapper[] = []
afterEach(() => { wrappers.forEach(wrapper => wrapper.unmount()); wrappers.length = 0; vi.restoreAllMocks() })

async function setup(data: LineSettingsOut = settings()) {
  const pinia = createPinia()
  useAuthStore(pinia).user = testUser('super_admin', { id: 'local-test', email: 'test@example.invalid', campus_keys: [] })
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: defineComponent({ template: '<div />' }) }] })
  await router.push('/line-notifications')
  await router.isReady()
  vi.spyOn(api, 'get').mockResolvedValue(data)
  const wrapper = mount(LineNotificationsView, { global: { plugins: [pinia, router, ElementPlus], provide: { [matchedRouteKey as symbol]: computed(() => router.currentRoute.value.matched[0]) } } })
  wrappers.push(wrapper)
  await flushPromises()
  return wrapper
}

function testButtons(wrapper: VueWrapper) {
  return wrapper.findAll('.target-row button')
}

describe('LINE 通知設定頁', () => {
  it('只有總管理者看得到', () => {
    const item = navItem('line-notifications')!
    expect(canSeeNavItem(item, { role: 'super_admin' })).toBe(true)
    expect(canSeeNavItem(item, { role: 'campus_admin' })).toBe(false)
  })

  it('顯示 webhook 網址、群組狀態，未命名的多人聊天室用 ID 末碼辨認', async () => {
    const wrapper = await setup()
    expect(wrapper.text()).toContain('https://ivy.example/api/website/v1/line/webhook')
    expect(wrapper.text()).toContain('已設定')
    expect(wrapper.text()).toContain('義華校務群（群組）')
    expect(wrapper.text()).toContain(`未命名多人聊天室（…${ROOM.slice(-6)}）`)
    expect(wrapper.text()).toMatch(/已離開/)
  })

  it('沒有指定群組的校區不能送測試訊息', async () => {
    const wrapper = await setup()
    const [yihua, minghua] = testButtons(wrapper)
    expect(yihua.attributes('disabled')).toBeUndefined()
    expect(minghua.attributes('disabled')).toBeDefined()
  })

  it('金鑰未設定時提示部署設定，並停用測試訊息', async () => {
    const wrapper = await setup(settings({ enabled: false }))
    expect(wrapper.text()).toContain('WEBSITE_LINE_MESSAGING_CHANNEL_SECRET')
    expect(testButtons(wrapper).every(button => button.attributes('disabled') !== undefined)).toBe(true)
  })

  it('送測試訊息成功與失敗都給可操作的提示', async () => {
    const post = vi.spyOn(api, 'post')
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new ApiError(502, { code: 'LINE_PUSH_FAILED', message: 'LINE 推播失敗，請確認金鑰與官方帳號仍在群組裡' }))
    const success = vi.spyOn(ElMessage, 'success')
    const error = vi.spyOn(ElMessage, 'error')
    const wrapper = await setup()
    await testButtons(wrapper)[0].trigger('click')
    await flushPromises()
    expect(post).toHaveBeenCalledWith('/admin/line/campus-targets/yihua/test')
    expect(success).toHaveBeenCalledWith('已送出測試訊息，請到義華校的群組確認')
    await testButtons(wrapper)[0].trigger('click')
    await flushPromises()
    expect(error).toHaveBeenCalledWith('LINE 推播失敗，請確認金鑰與官方帳號仍在群組裡')
  })

  it('改群組時送出 PUT，清除時送 null', async () => {
    const updated = settings({ targets: [{ campus_key: 'yihua', campus_name: '義華校', target_id: null }, { campus_key: 'minghua', campus_name: '明華校', target_id: null }] })
    const put = vi.spyOn(api, 'put').mockResolvedValue(updated)
    const wrapper = await setup()
    const select = wrapper.findAllComponents({ name: 'ElSelect' })[0]
    select.vm.$emit('change', '')
    await flushPromises()
    expect(put).toHaveBeenCalledWith('/admin/line/campus-targets/yihua', { target_id: null })
    select.vm.$emit('change', GROUP)
    await flushPromises()
    expect(put).toHaveBeenLastCalledWith('/admin/line/campus-targets/yihua', { target_id: GROUP })
  })
})

describe('LINE 群組驗證（2026-09-29）', () => {
  function options(wrapper: VueWrapper, campusIndex: number) {
    return wrapper.findAllComponents({ name: 'ElSelect' })[campusIndex]!.findAllComponents({ name: 'ElOption' })
  }

  it('群組清單標出已驗證／未驗證；未驗證的群組不能選為新的推播目標', async () => {
    const wrapper = await setup()
    expect(wrapper.text()).toContain('已驗證')
    expect(wrapper.text()).toContain('未驗證')
    // 明華校目前沒綁：未驗證的多人聊天室不能選，已驗證的群組可以。
    const minghua = options(wrapper, 1)
    const room = minghua.find(option => option.props('value') === ROOM)!
    const group = minghua.find(option => option.props('value') === GROUP)!
    expect(room.props('disabled')).toBe(true)
    expect(room.props('label')).toContain('未驗證')
    expect(group.props('disabled')).toBe(false)
  })

  it('這校目前綁定的群組就算還沒驗證也維持可選（修補前綁好的照常推播）', async () => {
    const wrapper = await setup(settings({
      targets: [
        { campus_key: 'yihua', campus_name: '義華校', target_id: ROOM },
        { campus_key: 'minghua', campus_name: '明華校', target_id: null },
      ],
    }))
    expect(options(wrapper, 0).find(option => option.props('value') === ROOM)!.props('disabled')).toBe(false)
    expect(options(wrapper, 1).find(option => option.props('value') === ROOM)!.props('disabled')).toBe(true)
  })

  it('產生驗證碼後顯示碼、到期時間與貼到群組的說明，按重新整理重新讀取群組', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({ code: 'IVY-7K3M9QX2', expires_at: '2026-09-29T02:10:00Z' })
    const wrapper = await setup()
    const get = vi.mocked(api.get)
    get.mockClear()
    await wrapper.get('[data-test="line-generate-code"]').trigger('click')
    await flushPromises()
    expect(post).toHaveBeenCalledWith('/admin/line/verification-codes')
    const shown = wrapper.get('[data-test="line-verification-code"]')
    expect(shown.text()).toContain('IVY-7K3M9QX2')
    expect(shown.text()).toContain('把驗證碼貼到要綁定的 LINE 群組，10 分鐘內有效')
    const refresh = shown.findAll('button').find(button => button.text() === '重新整理')!
    await refresh.trigger('click')
    await flushPromises()
    expect(get).toHaveBeenCalledWith('/admin/line')
  })

  it('金鑰未設定時不能產生驗證碼', async () => {
    const wrapper = await setup(settings({ enabled: false }))
    expect(wrapper.get('[data-test="line-generate-code"]').attributes('disabled')).toBeDefined()
  })

  it('選了未驗證的群組被擋（409）時顯示原因並重新讀取', async () => {
    vi.spyOn(api, 'put').mockRejectedValue(new ApiError(409, { code: 'LINE_GROUP_UNVERIFIED' }))
    const error = vi.spyOn(ElMessage, 'error')
    const wrapper = await setup()
    wrapper.findAllComponents({ name: 'ElSelect' })[1]!.vm.$emit('change', ROOM)
    await flushPromises()
    expect(error).toHaveBeenCalledWith('這個群組還沒驗證：請先產生驗證碼，貼到要綁定的 LINE 群組裡，再選這個群組')
  })
})
