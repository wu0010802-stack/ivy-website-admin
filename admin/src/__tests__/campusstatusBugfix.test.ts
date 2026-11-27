import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { computed, defineComponent } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter, matchedRouteKey, type Router } from 'vue-router'
import ElementPlus, { ElMessage, ElMessageBox } from 'element-plus'
import BookingSettingsView from '../views/BookingSettingsView.vue'
import CampusSelect from '../components/CampusSelect.vue'
import CampusStatusCard from '../components/CampusStatusCard.vue'
import { api } from '../api/client'
import { campusLabel } from '../api/labels'
import { useAuthStore } from '../stores/auth'
import { testUser } from './fixtures'

// 2026-11-26 修正：停用／重新啟用分校的流程進行中切換校區，PATCH 送到換過去的那一校，
// 確認框問的卻是原本那一校；送出途中換校時，舊校的結果還會蓋到新校的卡片上。

const wrappers: VueWrapper[] = []
afterEach(() => { wrappers.forEach(wrapper => wrapper.unmount()); wrappers.length = 0; vi.restoreAllMocks() })

async function mountAt(component: unknown, path: string, props: Record<string, unknown> = {}): Promise<{ wrapper: VueWrapper; router: Router }> {
  const pinia = createPinia()
  useAuthStore(pinia).user = testUser('super_admin', { id: 'me', email: 'me@example.invalid', campus_keys: [] })
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: defineComponent({ template: '<div />' }) }] })
  await router.push(path)
  await router.isReady()
  const wrapper = mount(component as ReturnType<typeof defineComponent>, {
    props,
    global: { plugins: [pinia, router, ElementPlus], provide: { [matchedRouteKey as symbol]: computed(() => router.currentRoute.value.matched[0]) } },
  } as never)
  wrappers.push(wrapper)
  await flushPromises()
  return { wrapper, router }
}

// 自己決定何時回應的請求（模擬手機網路一兩秒才回來）。
function deferred<T = unknown>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

const status = (key: string, active: boolean, extra: Record<string, unknown> = {}) => ({ key, name: campusLabel(key), active, deactivated_at: null, deactivated_reason: null, ...extra })
const impact = { open_requests: 2, upcoming_confirmed: 2, past_confirmed: 0, bookable_slots: 3, weekly_rules: 0 }
const button = (wrapper: VueWrapper, text: string) => wrapper.findAll('button').find(item => item.text() === text)!

describe('分校狀態卡：流程進行中換校', () => {
  it('讀進行中件數途中換校：不跳確認框，也不停用換過去的那一校', async () => {
    const readiness = deferred()
    vi.spyOn(api, 'get').mockImplementation(async path => {
      if (String(path).endsWith('/readiness')) return readiness.promise as never
      return status(String(path).split('/').at(-1)!, true) as never
    })
    const prompt = vi.spyOn(ElMessageBox, 'prompt').mockResolvedValue({ value: '' } as never)
    const patch = vi.spyOn(api, 'patch').mockImplementation(async path => status(String(path).split('/')[3]!, false, { open_requests: 0 }) as never)
    vi.spyOn(ElMessage, 'success')
    const { wrapper } = await mountAt(CampusStatusCard, '/booking', { campusKey: 'yihua' })

    await button(wrapper, '停用分校').trigger('click')
    await flushPromises()
    await wrapper.setProps({ campusKey: 'minghua' })
    await flushPromises()
    readiness.resolve({ blockers: {}, impact })
    await flushPromises()

    expect(patch).not.toHaveBeenCalled()
    expect(prompt).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('分校啟用中')
  })

  it('確認框開著時換校（例如按上一頁）：不送出，並說明原本那一校沒有停用', async () => {
    vi.spyOn(api, 'get').mockImplementation(async path => {
      if (String(path).endsWith('/readiness')) return { blockers: {}, impact } as never
      return status(String(path).split('/').at(-1)!, true) as never
    })
    const answer = deferred<{ value: string }>()
    const prompt = vi.spyOn(ElMessageBox, 'prompt').mockReturnValue(answer.promise as never)
    const patch = vi.spyOn(api, 'patch').mockImplementation(async path => status(String(path).split('/')[3]!, false, { open_requests: 0 }) as never)
    const warning = vi.spyOn(ElMessage, 'warning')
    vi.spyOn(ElMessage, 'success')
    const { wrapper } = await mountAt(CampusStatusCard, '/booking', { campusKey: 'yihua' })

    await button(wrapper, '停用分校').trigger('click')
    await flushPromises()
    expect(String(prompt.mock.calls[0]![1])).toBe('停用義華校？')
    await wrapper.setProps({ campusKey: 'minghua' })
    await flushPromises()
    answer.resolve({ value: '整修中' })
    await flushPromises()

    expect(patch).not.toHaveBeenCalled()
    expect(warning).toHaveBeenCalledOnce()
    expect(String((warning.mock.calls[0]![0] as { message: string }).message)).toContain('義華校沒有停用')
    expect(wrapper.text()).toContain('分校啟用中')
  })

  it('停用送出途中換校：結果不寫進新校的卡片、不回報給頁面，提示講的是原本那一校', async () => {
    vi.spyOn(api, 'get').mockImplementation(async path => {
      if (String(path).endsWith('/readiness')) return { blockers: {}, impact } as never
      return status(String(path).split('/').at(-1)!, true) as never
    })
    vi.spyOn(ElMessageBox, 'prompt').mockResolvedValue({ value: '' } as never)
    const response = deferred()
    const patch = vi.spyOn(api, 'patch').mockReturnValue(response.promise as never)
    const success = vi.spyOn(ElMessage, 'success')
    const { wrapper } = await mountAt(CampusStatusCard, '/booking', { campusKey: 'yihua' })

    await button(wrapper, '停用分校').trigger('click')
    await flushPromises()
    expect(patch).toHaveBeenCalledWith('/admin/campuses/yihua/status', { active: false, reason: null })
    await wrapper.setProps({ campusKey: 'minghua' })
    await flushPromises()
    response.resolve(status('yihua', false, { open_requests: 0 }))
    await flushPromises()

    expect(patch).toHaveBeenCalledOnce()
    expect(wrapper.text()).toContain('分校啟用中')
    expect(wrapper.text()).not.toContain('分校已停用')
    expect(wrapper.emitted('changed')).toBeUndefined()
    expect(wrapper.emitted('status')!.at(-1)).toEqual([true])
    expect(wrapper.emitted('status')!.some(args => args[0] === false)).toBe(false)
    expect(String((success.mock.calls[0]![0] as string | { message: string }))).toContain('義華校已從官網下架')
  })

  it('重新啟用送出途中換校：送出的是原本那一校，結果不蓋到新校的卡片', async () => {
    vi.spyOn(api, 'get').mockImplementation(async path => status(String(path).split('/').at(-1)!, false) as never)
    const response = deferred()
    const patch = vi.spyOn(api, 'patch').mockReturnValue(response.promise as never)
    vi.spyOn(ElMessage, 'success')
    const { wrapper } = await mountAt(CampusStatusCard, '/booking', { campusKey: 'yihua' })

    await button(wrapper, '重新啟用').trigger('click')
    await flushPromises()
    await wrapper.setProps({ campusKey: 'minghua' })
    await flushPromises()
    response.resolve(status('yihua', true))
    await flushPromises()

    expect(patch).toHaveBeenCalledOnce()
    expect(patch).toHaveBeenCalledWith('/admin/campuses/yihua/status', { active: true, reason: null })
    expect(wrapper.text()).toContain('分校已停用')
    expect(wrapper.emitted('changed')).toBeUndefined()
    expect(wrapper.emitted('status')!.some(args => args[0] === true)).toBe(false)
  })
})

describe('預約方式頁：停用分校進行中鎖住校區', () => {
  it('讀件數期間選單鎖住、網址換校也寫回原校；停用的是確認框上的那一校，完成後選單恢復', async () => {
    const active: Record<string, boolean> = { yihua: true, minghua: true }
    let readiness: ReturnType<typeof deferred> | null = null
    vi.spyOn(api, 'get').mockImplementation(async path => {
      const url = String(path)
      if (url.startsWith('/admin/campuses/')) {
        const key = url.split('/').at(-1)!
        return status(key, active[key] ?? true) as never
      }
      if (url.endsWith('/readiness')) return (readiness ? readiness.promise : null) as never
      const key = url.split('/').at(-1)!
      return { campus_key: key, version: 1, mode: 'paused', line_url: null, phone: null, external_url: null, message: null, parent_change_deadline_hours: 24 } as never
    })
    const prompt = vi.spyOn(ElMessageBox, 'prompt').mockResolvedValue({ value: '' } as never)
    const patch = vi.spyOn(api, 'patch').mockImplementation(async path => {
      const key = String(path).split('/')[3]!
      active[key] = false
      return status(key, false, { open_requests: 0 }) as never
    })
    vi.spyOn(ElMessage, 'success')
    const { wrapper, router } = await mountAt(BookingSettingsView, '/booking')
    const select = () => wrapper.getComponent(CampusSelect)
    expect(select().props('modelValue')).toBe('yihua')
    expect(select().props('disabled')).toBe(false)

    readiness = deferred()
    await button(wrapper, '停用分校').trigger('click')
    await flushPromises()
    expect(select().props('disabled')).toBe(true)

    // 選單（理論上點不到）與網址（上一頁）都不能在流程中換校。
    select().vm.$emit('update:modelValue', 'minghua')
    await flushPromises()
    await router.push('/booking?campus=minghua')
    await flushPromises()
    expect(select().props('modelValue')).toBe('yihua')
    expect(router.currentRoute.value.query.campus).toBe('yihua')

    readiness.resolve({ blockers: {}, impact })
    readiness = null
    await flushPromises()
    expect(String(prompt.mock.calls[0]![1])).toBe('停用義華校？')
    expect(patch).toHaveBeenCalledOnce()
    expect(patch).toHaveBeenCalledWith('/admin/campuses/yihua/status', { active: false, reason: null })

    // 停用後卡片換到頁首（舊卡片卸載）：選單要解鎖，不能一直鎖著。
    expect(wrapper.text()).toContain('分校已停用')
    expect(select().props('disabled')).toBe(false)
    select().vm.$emit('update:modelValue', 'minghua')
    await flushPromises()
    expect(select().props('modelValue')).toBe('minghua')
    expect(wrapper.text()).toContain('分校啟用中')
  })

  it('重新啟用送出期間選單鎖住；完成後卡片換到頁尾，選單恢復', async () => {
    const active: Record<string, boolean> = { yihua: false, minghua: true }
    vi.spyOn(api, 'get').mockImplementation(async path => {
      const url = String(path)
      if (url.startsWith('/admin/campuses/')) {
        const key = url.split('/').at(-1)!
        return status(key, active[key] ?? true) as never
      }
      if (url.endsWith('/readiness')) return null as never
      const key = url.split('/').at(-1)!
      return { campus_key: key, version: 1, mode: 'paused', line_url: null, phone: null, external_url: null, message: null, parent_change_deadline_hours: 24 } as never
    })
    const response = deferred()
    const patch = vi.spyOn(api, 'patch').mockReturnValue(response.promise as never)
    vi.spyOn(ElMessage, 'success')
    const { wrapper } = await mountAt(BookingSettingsView, '/booking')
    const select = () => wrapper.getComponent(CampusSelect)
    expect(wrapper.find('.campus-zone').exists()).toBe(false)

    await button(wrapper, '重新啟用').trigger('click')
    await flushPromises()
    expect(select().props('disabled')).toBe(true)
    expect(patch).toHaveBeenCalledWith('/admin/campuses/yihua/status', { active: true, reason: null })

    active.yihua = true
    response.resolve(status('yihua', true))
    await flushPromises()
    expect(wrapper.find('.campus-zone').text()).toContain('分校啟用中')
    expect(select().props('disabled')).toBe(false)
  })
})
