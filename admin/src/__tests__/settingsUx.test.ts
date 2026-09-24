import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { computed, defineComponent, ref } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter, matchedRouteKey } from 'vue-router'
import ElementPlus, { ElMessageBox } from 'element-plus'
import BookingSettingsView from '../views/BookingSettingsView.vue'
import CampusSelect from '../components/CampusSelect.vue'
import { useContentItem } from '../composables/useContentItem'
import { api, ApiError } from '../api/client'
import { useAuthStore } from '../stores/auth'

const wrappers: VueWrapper[] = []
afterEach(() => { wrappers.forEach(wrapper => wrapper.unmount()); wrappers.length = 0; vi.restoreAllMocks() })

async function setup() {
  const pinia = createPinia()
  useAuthStore(pinia).user = { id: 'local-test', email: 'test@example.invalid', role: 'super_admin', is_active: true, campus_keys: ['yihua', 'renwu'] }
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: defineComponent({ template: '<div />' }) }] })
  await router.push('/booking-settings')
  await router.isReady()
  return { plugins: [pinia, router, ElementPlus], provide: { [matchedRouteKey as symbol]: computed(() => router.currentRoute.value.matched[0]) } }
}
function config(campus_key = 'yihua') {
  return { campus_key, version: 1, mode: 'paused', line_url: null, phone: null, external_url: null, message: `${campus_key} 原本說明` }
}
async function booking() {
  const wrapper = mount(BookingSettingsView, { global: await setup() })
  wrappers.push(wrapper)
  await flushPromises()
  return wrapper
}
function saveButton(wrapper: VueWrapper) {
  return wrapper.findAll('button').find(button => button.text() === '儲存並套用到官網')!
}

describe('設定頁的編輯保護', () => {
  it('可啟用日期場次並以人工確認作為預設', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(config())
    const patch = vi.spyOn(api, 'patch').mockResolvedValue({ ...config(), version: 2, mode: 'slots', slots_auto_confirm: false })
    const wrapper = await booking()
    const radio = wrapper.get('input[type="radio"][value="slots"]')
    expect(radio.attributes('disabled')).toBeUndefined()
    await radio.setValue(true)
    await saveButton(wrapper).trigger('click')
    await flushPromises()
    expect(patch).toHaveBeenCalledWith('/admin/booking-config/yihua', expect.objectContaining({ mode: 'slots', slots_auto_confirm: false }))
  })

  it('拒絕放棄修改時保留校區與輸入，不載入另一校', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue(config())
    const configCalls = () => get.mock.calls.filter(call => String(call[0]).startsWith('/admin/booking-config/'))
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue('cancel')
    const wrapper = await booking()
    await wrapper.get('textarea').setValue('尚未儲存的說明')
    wrapper.getComponent(CampusSelect).vm.$emit('update:modelValue', 'renwu')
    await flushPromises()
    expect(confirm).toHaveBeenCalledOnce()
    expect(configCalls()).toHaveLength(1)
    expect(wrapper.getComponent(CampusSelect).props('modelValue')).toBe('yihua')
    expect(wrapper.get('textarea').element.value).toBe('尚未儲存的說明')
    expect(wrapper.text()).toContain('有未儲存的修改')
  })

  it('等待放棄修改確認，同意後才載入新校區', async () => {
    // 分校狀態卡另外讀 /admin/campuses/{key}；依網址回應，不靠呼叫順序。
    let configLoads = 0
    const get = vi.spyOn(api, 'get').mockImplementation(async path => {
      if (String(path).startsWith('/admin/campuses/')) return { key: 'yihua', name: '義華', active: true } as never
      configLoads += 1
      return (configLoads === 1 ? config() : config('renwu')) as never
    })
    const configCalls = () => get.mock.calls.filter(call => String(call[0]).startsWith('/admin/booking-config/'))
    let agree!: (value: { value: string; action: 'confirm' }) => void
    const confirmation = new Promise<{ value: string; action: 'confirm' }>(resolve => { agree = resolve })
    vi.spyOn(ElMessageBox, 'confirm').mockReturnValue(confirmation as unknown as ReturnType<typeof ElMessageBox.confirm>)
    const wrapper = await booking()
    await wrapper.get('textarea').setValue('尚未儲存的說明')
    wrapper.getComponent(CampusSelect).vm.$emit('update:modelValue', 'renwu')
    await flushPromises()
    expect(configCalls()).toHaveLength(1)
    expect(wrapper.getComponent(CampusSelect).props('modelValue')).toBe('yihua')
    agree({ value: '', action: 'confirm' })
    await flushPromises()
    expect(configCalls().at(-1)?.[0]).toBe('/admin/booking-config/renwu')
    expect(wrapper.getComponent(CampusSelect).props('modelValue')).toBe('renwu')
    expect(wrapper.get('textarea').element.value).toBe('renwu 原本說明')
    expect(wrapper.text()).not.toContain('有未儲存的修改')
  })

  it('版本衝突保留編輯內容，禁止以舊版本再次覆寫', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(config())
    const patch = vi.spyOn(api, 'patch').mockRejectedValue(new ApiError(409, { code: 'BOOKING_CONFIG_VERSION_CONFLICT' }))
    const wrapper = await booking()
    await wrapper.get('textarea').setValue('我編輯的說明')
    await saveButton(wrapper).trigger('click')
    await flushPromises()
    expect(wrapper.get('textarea').element.value).toBe('我編輯的說明')
    expect(wrapper.text()).toContain('設定已被其他人更新')
    expect(wrapper.text()).toContain('有未儲存的修改')
    expect(saveButton(wrapper).attributes('disabled')).toBeDefined()
    await saveButton(wrapper).trigger('click')
    expect(patch).toHaveBeenCalledOnce()
  })

  it('空的 HTTP 錯誤回應顯示可重試錯誤並保留編輯', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(config())
    vi.spyOn(api, 'patch').mockRejectedValue(new ApiError(502, null))
    const errors = vi.fn()
    const global = await setup()
    const wrapper = mount(BookingSettingsView, { global: { ...global, config: { errorHandler: errors } } })
    wrappers.push(wrapper)
    await flushPromises()
    await wrapper.get('textarea').setValue('不能遺失的說明')
    await saveButton(wrapper).trigger('click')
    await flushPromises()
    expect(errors).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('更新失敗')
    expect(wrapper.get('textarea').element.value).toBe('不能遺失的說明')
    expect(saveButton(wrapper).attributes('disabled')).toBeUndefined()
  })

  it('內容載入的過時校區回應不覆蓋新校區與乾淨快照', async () => {
    let resolveOld!: (value: unknown) => void
    const old = new Promise<unknown>(resolve => { resolveOld = resolve })
    const content = (title: string) => ({ id: title, latest_version: 1, current_published_revision_id: null, latest_revision: { id: title, created_at: '2026-09-22T00:00:00Z', payload: { title } } })
    const get = vi.spyOn(api, 'get').mockImplementationOnce(() => old as Promise<never>).mockResolvedValueOnce(content('仁武內容'))
    const campus = ref('yihua')
    let editor!: ReturnType<typeof useContentItem<{ title: string }>>
    const Harness = defineComponent({ setup() { editor = useContentItem('campus-profile', { title: '' }, campus); return () => null } })
    const wrapper = mount(Harness)
    wrappers.push(wrapper)
    const initial = editor.load()
    campus.value = 'renwu'
    await editor.load()
    expect(get).toHaveBeenLastCalledWith('/admin/content-items/campus-profile?campus_key=renwu')
    expect(editor.form.value.title).toBe('仁武內容')
    resolveOld(content('過時義華內容'))
    await initial
    expect(editor.form.value.title).toBe('仁武內容')
    expect(editor.loading.value).toBe(false)
    expect(editor.isDirty.value).toBe(false)
  })
})
