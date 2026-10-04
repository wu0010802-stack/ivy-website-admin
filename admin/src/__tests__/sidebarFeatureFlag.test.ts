import { afterEach, describe, expect, it } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { computed, defineComponent } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter, matchedRouteKey } from 'vue-router'
import ElementPlus from 'element-plus'
import AdminSidebar from '../components/AdminSidebar.vue'
import { useAuthStore } from '../stores/auth'
import { testUser } from './fixtures'

const wrappers: VueWrapper[] = []
afterEach(() => { wrappers.forEach(wrapper => wrapper.unmount()); wrappers.length = 0 })

async function mountSidebar(features?: { admissions: boolean }) {
  const pinia = createPinia()
  const auth = useAuthStore(pinia)
  auth.user = testUser('super_admin', { id: 'local-test', email: 'test@example.invalid', campus_keys: ['renwu'] })
  if (features) auth.features = { password_reset_email: false, ...features }
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: defineComponent({ template: '<div />' }) }] })
  await router.push('/')
  await router.isReady()
  const global = { plugins: [pinia, router, ElementPlus], provide: { [matchedRouteKey as symbol]: computed(() => router.currentRoute.value.matched[0]) } }
  const wrapper = mount(AdminSidebar, { global, attachTo: document.body })
  wrappers.push(wrapper)
  return wrapper
}

const navTexts = (wrapper: VueWrapper) => wrapper.findAll('.sidebar__nav a').map(link => link.text())

describe('側欄依功能開關顯示招生入學', () => {
  it('開關關閉（或讀不到）時，側欄與搜尋都沒有招生入學', async () => {
    for (const features of [{ admissions: false }, undefined]) {
      const wrapper = await mountSidebar(features)
      expect(wrapper.text()).not.toContain('招生入學')
      await wrapper.get('input').setValue('招生')
      await flushPromises()
      expect(navTexts(wrapper)).not.toContain('招生入學')
    }
  })

  it('開關開啟時，側欄與搜尋都有招生入學', async () => {
    const wrapper = await mountSidebar({ admissions: true })
    expect(wrapper.text()).toContain('招生入學')
    await wrapper.get('input').setValue('招生')
    await flushPromises()
    expect(navTexts(wrapper)).toContain('招生入學')
  })
})
