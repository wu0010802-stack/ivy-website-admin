import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import ElementPlus from 'element-plus'
import { useAuthStore } from '../stores/auth'
import DashboardView from '../views/DashboardView.vue'
import VisitCalendarView from '../views/VisitCalendarView.vue'
import { api } from '../api/client'
import { testUser } from './fixtures'

// 2026-09-26 端到端 axe 檢查（tests/stack/a11y.spec.ts）抓到的結構問題，這裡在單元測試
// 先擋一次，不用等 Playwright 才發現。

const wrappers: VueWrapper[] = []
afterEach(() => { wrappers.forEach((wrapper) => wrapper.unmount()); wrappers.length = 0; vi.restoreAllMocks() })

async function mountAt(path: string, component: ReturnType<typeof defineComponent>) {
  const pinia = createPinia()
  useAuthStore(pinia).user = testUser('super_admin', { id: 'local-test', email: 'test@example.invalid', campus_keys: [] })
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path, component },
      { path: '/:rest(.*)', component: defineComponent({ template: '<div />' }) },
    ],
  })
  await router.push(path)
  await router.isReady()
  const wrapper = mount({ template: '<router-view />' }, { global: { plugins: [pinia, router, ElementPlus] } })
  wrappers.push(wrapper)
  await flushPromises()
  return wrapper
}

describe('接待月曆的 grid 結構', () => {
  it('星期列與每一週都是 role=row，格子不直接掛在 grid 底下', async () => {
    vi.spyOn(api, 'get').mockResolvedValue([] as never)
    const wrapper = await mountAt('/visit-calendar', VisitCalendarView as never)
    const grid = wrapper.find('[role="grid"]')
    const rows = grid.findAll(':scope > [role="row"]')
    expect(rows).toHaveLength(7)
    expect(rows[0]!.findAll('[role="columnheader"]')).toHaveLength(7)
    for (const row of rows.slice(1)) expect(row.findAll('[role="gridcell"]')).toHaveLength(7)
    expect(grid.findAll(':scope > [role="gridcell"], :scope > [role="columnheader"]')).toHaveLength(0)
  })
})

describe('總覽的營運摘要', () => {
  it('<dl> 每組只有 dt、dd，查看連結包在 dd 裡', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({
      today_visits: 1, pending_follow_up: 0, pending_publish: 0, campuses_without_active_booking: [], failed_notifications: 0,
      new_requests: 2, awaiting_confirmation: 0, next_hold_expires_at: null,
    } as never)
    const wrapper = await mountAt('/', DashboardView as never)
    const groups = wrapper.findAll('.dash__summary > div')
    expect(groups).toHaveLength(4)
    for (const group of groups) {
      expect(group.element.children.length).toBeGreaterThan(0)
      for (const child of Array.from(group.element.children)) expect(['DT', 'DD']).toContain(child.tagName)
      expect(group.find('dd a').exists()).toBe(true)
    }
  })
})

describe('開關都有可及名稱', () => {
  // Element Plus 的 el-switch 不會把 active-text 接成 input 的 label（axe label 規則）。
  function sources(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sources(path)
      return entry.name.endsWith('.vue') ? [path] : []
    })
  }

  it('每個 <el-switch> 都帶 aria-label', () => {
    const root = join(__dirname, '..')
    const missing = sources(root).flatMap((file) => {
      const tags = readFileSync(file, 'utf8').match(/<el-switch\b[^>]*>/g) ?? []
      return tags.filter((tag) => !/\saria-label=|\s:aria-label=/.test(tag)).map(() => file.slice(root.length + 1))
    })
    expect(missing).toEqual([])
  })
})
