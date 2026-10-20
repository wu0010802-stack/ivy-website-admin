// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { computed, createApp, h, nextTick, onBeforeUnmount, reactive, ref, useId, watch, type Component } from 'vue'
import type { NewsEvent } from '../app/types/site-content'
import HomeEventCalendar from '../app/components/HomeEventCalendar.vue'
import { newIdempotencyKey } from '../app/utils/idempotency-key'

// Nuxt 自動匯入在單元測試裡沒有，這裡補上。
vi.stubGlobal('computed', computed)
vi.stubGlobal('ref', ref)
vi.stubGlobal('watch', watch)
vi.stubGlobal('useId', useId)
vi.stubGlobal('onBeforeUnmount', onBeforeUnmount)

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

const event = (id: string, date: string, title: string): NewsEvent => ({
  id, date, month: date.slice(0, 7), campus: '義華校', title, description: `${title}說明`
} as NewsEvent)

afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = '' })

describe('加入行事曆：換活動時 .ics 跟著換（稽核 #01）', () => {
  it('同一個元件換成下一則活動，再打開選單下載到的是新活動、舊的 Blob URL 已釋放', async () => {
    const blobs = new Map<string, Blob>()
    let n = 0
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => { const url = `blob:test/${++n}`; blobs.set(url, blob as Blob); return url })
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const state = reactive({ event: event('a', '2026-10-24', '運動會') })
    const root = document.createElement('div')
    document.body.append(root)
    const app = createApp({ render: () => h(HomeEventCalendar as Component, { event: state.event }) })
    app.mount(root)

    const menu = root.querySelector<HTMLElement>('.hn-cal-menu')!
    const open = () => menu.dispatchEvent(Object.assign(new Event('toggle'), { newState: 'open' }))
    const ics = () => root.querySelector<HTMLAnchorElement>('a[download]')!
    open(); await nextTick()
    const first = ics().getAttribute('href')!
    expect(await blobs.get(first)!.text()).toContain('DTSTART;VALUE=DATE:20261024')

    state.event = event('b', '2026-11-02', '親子日')
    await nextTick()
    open(); await nextTick()
    const second = ics().getAttribute('href')!
    expect(second).not.toBe(first)
    expect(ics().getAttribute('download')).toContain('親子日')
    const text = await blobs.get(second)!.text()
    expect(text).toContain('DTSTART;VALUE=DATE:20261102')
    expect(text).toContain('親子日')
    expect(text).not.toContain('運動會')
    expect(revoke).toHaveBeenCalledWith(first)
    app.unmount()
    expect(revoke).toHaveBeenCalledWith(second)
  })

  it('首頁動態與消息對話框換活動時重建元件（順便收掉還開著的選單）', () => {
    expect(read('../app/components/HomeStoryViewer.vue')).toMatch(/<HomeEventCalendar [^>]*:key="story\.id"[^>]*:event="story\.event"/)
    expect(read('../app/components/NewsDialog.vue')).toMatch(/<HomeEventCalendar [^>]*:key="view\.item\.id"[^>]*:event="view\.item"/)
  })
})

describe('idempotency key：沒有 crypto.randomUUID 的瀏覽器也能產生（稽核 #14）', () => {
  it('有 randomUUID 就用它', () => {
    expect(newIdempotencyKey()).toMatch(UUID)
    const spy = vi.spyOn(crypto, 'randomUUID').mockReturnValue('11111111-2222-4333-8444-555555555555')
    expect(newIdempotencyKey()).toBe('11111111-2222-4333-8444-555555555555')
    expect(spy).toHaveBeenCalled()
  })

  it('沒有 randomUUID 時用 getRandomValues 組出 v4 UUID，每次不同', () => {
    const real = globalThis.crypto
    vi.stubGlobal('crypto', { getRandomValues: real.getRandomValues.bind(real) })
    try {
      const keys = Array.from({ length: 50 }, () => newIdempotencyKey())
      keys.forEach((key) => expect(key).toMatch(UUID))
      expect(new Set(keys).size).toBe(50)
    } finally { vi.unstubAllGlobals(); vi.stubGlobal('computed', computed); vi.stubGlobal('ref', ref); vi.stubGlobal('watch', watch); vi.stubGlobal('useId', useId); vi.stubGlobal('onBeforeUnmount', onBeforeUnmount) }
  })

  it('預約表單、CTA 與網頁效能回報都不直接呼叫 crypto.randomUUID', () => {
    for (const path of ['../app/components/VisitForm.vue', '../app/utils/cta-analytics.ts', '../app/plugins/telemetry.client.ts']) {
      const source = read(path)
      expect(source, path).not.toContain('crypto.randomUUID')
      expect(source, path).toContain('newIdempotencyKey')
    }
    expect(read('../app/components/VisitForm.vue').match(/newIdempotencyKey\(\)/g)).toHaveLength(3)
  })
})
