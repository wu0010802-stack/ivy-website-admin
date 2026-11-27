// 2026-11-26 回歸：LINE 通知頁「官方帳號連線」第 1 步的「複製」原本寫成 @click="copyWebhook"（沒有括號），
// ElButton 把點擊事件當第一個參數傳進來，預設的 webhook 網址就不會套用，剪貼簿收到「[object PointerEvent]」，
// 畫面卻照樣跳「已複製 Webhook 網址」。這裡從使用者按下按鈕的角度斷言剪貼簿收到的是網址字串。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { computed, defineComponent } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter, matchedRouteKey } from 'vue-router'
import ElementPlus, { ElMessage } from 'element-plus'
import LineNotificationsView from '../views/LineNotificationsView.vue'
import { api } from '../api/client'
import type { LineSettingsOut } from '../api/types'
import { useAuthStore } from '../stores/auth'
import { testUser } from './fixtures'

const MAIN_WEBHOOK = 'https://admin.ivy.example/api/website/v1/line/webhook'
const YIHUA_WEBHOOK = 'https://admin.ivy.example/api/website/v1/line/webhook/yihua'

function settings(overrides: Partial<LineSettingsOut> = {}): LineSettingsOut {
  return {
    enabled: true,
    webhook_url: MAIN_WEBHOOK,
    groups: [],
    targets: [{ campus_key: 'yihua', campus_name: '義華校', target_id: null }],
    accounts: [
      { key: 'main', webhook_url: MAIN_WEBHOOK, display_name: '常春藤官網', basic_id: '@ivy-main', quota: { limit: 200, used: 12, warning: false }, quota_error_status: null, pnp_available: false },
      { key: 'yihua', webhook_url: YIHUA_WEBHOOK, display_name: '常春藤義華', basic_id: '@ivy-yihua', quota: { limit: 200, used: 20, warning: false }, quota_error_status: null, pnp_available: false },
    ],
    parent_campuses: [],
    ...overrides,
  }
}

const wrappers: VueWrapper[] = []
afterEach(() => {
  wrappers.forEach(wrapper => wrapper.unmount())
  wrappers.length = 0
  vi.restoreAllMocks()
  Reflect.deleteProperty(navigator, 'clipboard')
})

function setClipboard() {
  const writeText = vi.fn(async (_text: unknown) => {})
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  return writeText
}

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

describe('LINE 通知頁複製 Webhook 網址（2026-11-26 回歸）', () => {
  it('第 1 步的「複製」把主帳號的 webhook 網址字串寫進剪貼簿，不是點擊事件', async () => {
    const writeText = setClipboard()
    const success = vi.spyOn(ElMessage, 'success')
    const wrapper = await setup()
    const button = wrapper.get('ol.steps .webhook button')
    expect(button.text()).toBe('複製')
    await button.trigger('click')
    await flushPromises()
    expect(writeText).toHaveBeenCalledTimes(1)
    expect(writeText).toHaveBeenCalledWith(MAIN_WEBHOOK)
    expect(typeof writeText.mock.calls[0]![0]).toBe('string')
    expect(success).toHaveBeenCalledWith('已複製 Webhook 網址')
  })

  it('各校帳號的「複製」照樣寫入自己的 webhook 網址', async () => {
    const writeText = setClipboard()
    const wrapper = await setup()
    const button = wrapper.get('[data-test="line-accounts"] .webhook button')
    await button.trigger('click')
    await flushPromises()
    expect(writeText).toHaveBeenCalledWith(YIHUA_WEBHOOK)
  })

  it('就算按鈕又寫成裸方法名、收到的是點擊事件，也不寫剪貼簿、不跳已複製', async () => {
    // <el-*> 沒有型別宣告（vite.config.ts 的 dts: false），vue-tsc 擋不住 @click="copyWebhook"，靠執行時的字串檢查。
    const writeText = setClipboard()
    const success = vi.spyOn(ElMessage, 'success')
    const wrapper = await setup()
    await (wrapper.vm as unknown as { copyWebhook: (url: unknown) => Promise<void> }).copyWebhook(new MouseEvent('click'))
    await flushPromises()
    expect(writeText).not.toHaveBeenCalled()
    expect(success).not.toHaveBeenCalled()
  })

  it('產生驗證碼後「複製驗證碼」寫入的是驗證碼字串', async () => {
    const writeText = setClipboard()
    const wrapper = await setup()
    vi.spyOn(api, 'post').mockResolvedValue({ code: 'IVY-123456', expires_at: '2026-11-26T02:10:00Z' } as never)
    await wrapper.get('[data-test="line-generate-code"]').trigger('click')
    await flushPromises()
    const copy = wrapper.get('[data-test="line-verification-code"]').findAll('button').find(item => item.text() === '複製驗證碼')!
    await copy.trigger('click')
    await flushPromises()
    expect(writeText).toHaveBeenCalledWith('IVY-123456')
  })
})
