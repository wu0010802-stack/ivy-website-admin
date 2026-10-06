// 2026-10-06 操作紀錄多顯示 IP 與裝置：後端回 user_agent（大家都有）與
// ip_address（只有總部拿得到，其他人是 null），後台把 User-Agent 解析成
// 「iPhone・LINE」這類短字，完整字串放在 title。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { computed, defineComponent } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter, matchedRouteKey } from 'vue-router'
import ElementPlus from 'element-plus'
import AuditView from '../views/AuditView.vue'
import { api } from '../api/client'
import { useAuthStore } from '../stores/auth'
import { describeUserAgent } from '../utils/userAgent'
import { testUser } from './fixtures'

const IPHONE_LINE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari Line/15.10.0'

describe('describeUserAgent', () => {
  it.each([
    [IPHONE_LINE, 'iPhone・LINE'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1', 'iPhone・Safari'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.0.0 Mobile/15E148 Safari/604.1', 'iPhone・Chrome'],
    ['Mozilla/5.0 (iPad; CPU OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1', 'iPad・Safari'],
    ['Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36', 'Android・Chrome'],
    ['Mozilla/5.0 (Linux; Android 14; SM-S918B Build/UP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/141.0.0.0 Mobile Safari/537.36 Line/15.10.0/IAB', 'Android・LINE'],
    ['Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0.0.0 Mobile Safari/537.36', 'Android・Samsung Internet'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36', 'Mac・Chrome'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15', 'Mac・Safari'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0', 'Windows・Edge'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:143.0) Gecko/20100101 Firefox/143.0', 'Windows・Firefox'],
    ['Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36', 'Linux・Chrome'],
    // 不是瀏覽器（指令列工具、程式）就寫程式名稱。
    ['curl/8.7.1', 'curl'],
    ['python-httpx/0.28.1', 'python-httpx'],
    ['Mozilla/5.0 (compatible; SomethingNew)', '其他裝置'],
    [null, ''],
    ['', ''],
  ])('%s → %s', (ua, expected) => {
    expect(describeUserAgent(ua)).toBe(expected)
  })
})

const wrappers: VueWrapper[] = []
afterEach(() => { wrappers.forEach(wrapper => wrapper.unmount()); wrappers.length = 0; vi.restoreAllMocks() })

function entry(id: string, extra: Record<string, unknown> = {}) {
  return {
    id, actor_user_id: 'me', actor_email: 'amy@ivy.example', actor_display_name: '王小美',
    action: 'site_settings.update', target_type: 'site', target_id: 'x', target_label: null, target_exists: null,
    campus_key: null, metadata: {}, created_at: '2026-10-06T06:30:00Z', ...extra,
  }
}

async function mountAudit(entries: unknown[]) {
  vi.spyOn(api, 'get').mockResolvedValue(entries as never)
  const pinia = createPinia()
  useAuthStore(pinia).user = testUser('super_admin', { id: 'me' })
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: defineComponent({ template: '<div />' }) }] })
  await router.push('/audit')
  await router.isReady()
  const wrapper = mount(AuditView, { global: { plugins: [pinia, router, ElementPlus], provide: { [matchedRouteKey as symbol]: computed(() => router.currentRoute.value.matched[0]) } } })
  wrappers.push(wrapper)
  await flushPromises()
  return wrapper
}

describe('操作紀錄顯示 IP 與裝置', () => {
  it('操作者下面寫裝置與 IP，完整 User-Agent 放在 title；桌機與手機都有', async () => {
    const wrapper = await mountAudit([entry('a1', { ip_address: '203.0.113.9', user_agent: IPHONE_LINE })])
    const desktop = wrapper.get('[data-test="audit-source"]')
    expect(desktop.text()).toBe('iPhone・LINE・203.0.113.9')
    expect(desktop.attributes('title')).toBe(IPHONE_LINE)
    expect(wrapper.get('[data-test="audit-source-mobile"]').text()).toBe('iPhone・LINE・203.0.113.9')
  })

  it('校區管理員拿不到 IP，只寫裝置', async () => {
    const wrapper = await mountAudit([entry('a1', { ip_address: null, user_agent: IPHONE_LINE })])
    expect(wrapper.get('[data-test="audit-source"]').text()).toBe('iPhone・LINE')
  })

  it('改版前的紀錄與系統動作沒有來源，就不多一行', async () => {
    const wrapper = await mountAudit([entry('a1'), entry('a2', { ip_address: null, user_agent: null })])
    expect(wrapper.find('[data-test="audit-source"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="audit-source-mobile"]').exists()).toBe(false)
  })

  it('可以用 IP 或裝置搜尋', async () => {
    const wrapper = await mountAudit([
      entry('a1', { ip_address: '203.0.113.9', user_agent: IPHONE_LINE }),
      entry('a2', { ip_address: '198.51.100.7', user_agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:143.0) Gecko/20100101 Firefox/143.0' }),
    ])
    await wrapper.get('.filter-search input').setValue('203.0.113')
    expect(wrapper.get('.list-summary').text()).toContain('符合 1 筆')
    await wrapper.get('.filter-search input').setValue('firefox')
    expect(wrapper.get('.list-summary').text()).toContain('符合 1 筆')
    expect(wrapper.get('[data-test="audit-source"]').text()).toBe('Windows・Firefox・198.51.100.7')
  })
})
