// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { computed, createApp, h, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch, type App } from 'vue'
import VisitForm from '../app/components/VisitForm.vue'
import fixture from '../server/data/site-fixture.json'
import type { SiteContent } from '../app/types/site-content'
import { setCurrentVisit, startVisit } from '../app/utils/engagement'

const site = fixture as unknown as SiteContent
let app: App | undefined
afterEach(() => {
  app?.unmount()
  setCurrentVisit(null)
  sessionStorage.removeItem('ivy-visit-draft')
  vi.unstubAllGlobals()
  document.body.replaceChildren()
})

function mountForm(mode: 'slots' | 'line', fetchSlots: ReturnType<typeof vi.fn>, routeCampus = ref('yihua')) {
  for (const [name, value] of Object.entries({ computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch })) {
    vi.stubGlobal(name, value)
  }
  vi.stubGlobal('useRouter', () => ({}))
  vi.stubGlobal('useRememberedCampus', () => ({}))
  vi.stubGlobal('useRuntimeConfig', () => ({ public: {} }))
  vi.stubGlobal('useCampusBooking', () => ({
    data: ref({ mode, version: 1, line_url: 'https://lin.ee/test' }), pending: ref(false), error: ref(null),
  }))
  vi.stubGlobal('useNuxtApp', () => ({}))
  vi.stubGlobal('useState', (_key: string, initial: () => boolean) => ref(initial()))
  vi.stubGlobal('$fetch', fetchSlots)
  const visit = startVisit('/visit/yihua', { id: crypto.randomUUID(), source: 'direct', pages: 1 }, 'mobile')!
  setCurrentVisit(visit)
  app = createApp({ render: () => h(VisitForm, { booking: site.booking, campuses: site.campuses, routeCampus: routeCampus.value }) })
  for (const name of ['NuxtLink', 'PrivacyNoticeDialog', 'ResponsivePicture', 'VisitCalendarActions', 'VisitDatePicker', 'VisitLineNotify', 'VisitRememberedNotice']) {
    app.component(name, () => null)
  }
  app.mount(document.body.appendChild(document.createElement('div')))
  return visit
}

describe('預約頁實際顯示的場次與聯絡方式', () => {
  it('載入中與失敗都不記為無場次；重試後有可選場次才計入', async () => {
    const date = new Date().toISOString().slice(0, 10)
    const fetchSlots = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([
      { id: 'slot-1', slot_date: date, start_time: '09:00', end_time: '10:00', remaining: 1 },
    ])
    const visit = mountForm('slots', fetchSlots)
    expect(visit.takePayload()!.actions).toEqual({ campus_tracking: 1 })
    const retry = () => [...document.querySelectorAll('button')].find((btn) => btn.textContent === '重新載入場次')
    await vi.waitFor(() => expect(retry()).toBeDefined())
    expect(visit.takePayload()).toBeNull()
    retry()!.click()
    await vi.waitFor(() => expect(document.querySelector('.visit-schedule-fields')).not.toBeNull())
    expect(visit.takePayload()!.actions).toEqual({ campus_tracking: 1, form_slots_available: 1 })
  })

  it('沒有剩餘名額才顯示無場次並記錄；重複渲染維持一次', async () => {
    const visit = mountForm('slots', vi.fn().mockResolvedValue([{ remaining: 0 }]))
    await vi.waitFor(() => expect(document.body.textContent).toContain('目前沒有開放的參觀場次'))
    expect(visit.takePayload()!.actions).toEqual({ campus_tracking: 1, form_no_slots: 1 })
  })

  it('LINE 洽詢校區呈現有校區的聯絡鈕，兩個場次欄都不計入', async () => {
    const fetchSlots = vi.fn()
    const visit = mountForm('line', fetchSlots)
    await nextTick()
    const link = document.querySelector<HTMLAnchorElement>('[data-contact-channel="line"]')!
    expect(link.href).toBe('https://lin.ee/test')
    expect(link.closest('[data-campus-key]')?.getAttribute('data-campus-key')).toBe('yihua')
    expect(fetchSlots).not.toHaveBeenCalled()
    expect(visit.takePayload()!.actions).toEqual({ campus_tracking: 1 })
  })
})
