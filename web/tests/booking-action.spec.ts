import { describe, it, expect } from 'vitest'
import { campusVisitCta, resolveBookingAction } from '../app/utils/booking-action'

describe('分校預約入口', () => {
  it('未選校先選校', () => {
    expect(resolveBookingAction(null, null).kind).toBe('choose_campus')
  })

  it('選了校但還沒有設定資料，一樣視為未選校（保守處理）', () => {
    expect(resolveBookingAction('renwu', null).kind).toBe('choose_campus')
  })

  it('設定載入失敗不可當成園所暫停，也不可沿用舊設定開放送單', () => {
    for (const config of [null, { mode: 'slots' as const, version: 1 }]) {
      const action = resolveBookingAction('yihua', config, true)
      expect(action.kind).toBe('unavailable')
      expect(action.href).toBeNull()
    }
  })

  it('只有自選場次會帶到站內表單', () => {
    expect(resolveBookingAction('yihua', { mode: 'slots', version: 1 }).kind).toBe('form')
    expect(resolveBookingAction('yihua', { mode: 'paused', version: 1, message: '暫停' }).kind).toBe('paused')
  })

  it('暫停不產生可送出表單連結', () => {
    const action = resolveBookingAction('renwu', {
      mode: 'paused',
      version: 2,
      message: '暫停參觀預約'
    })
    expect(action.kind).toBe('paused')
    expect(action.href).toBeNull()
    expect(action.message).toBe('暫停參觀預約')
  })

  it('paused 沒有 message 時給預設文字', () => {
    const action = resolveBookingAction('renwu', { mode: 'paused', version: 1 })
    expect(action.message).toBeTruthy()
  })

  it('園方啟用 slots 後可選擇日期與場次', () => {
    const action = resolveBookingAction('yihua', { mode: 'slots', version: 1 })
    expect(action.kind).toBe('form')
    expect(action.href).toBe('/visit/yihua')
  })

  it('line 模式用傳入的 line_url，不內建任何預設連結', () => {
    const action = resolveBookingAction('yihua', {
      mode: 'line',
      version: 1,
      line_url: 'https://lin.ee/example'
    })
    expect(action.kind).toBe('line')
    expect(action.href).toBe('https://lin.ee/example')
  })

  it('line 模式缺 line_url 時 href 為 null，不假造連結', () => {
    const action = resolveBookingAction('yihua', { mode: 'line', version: 1 })
    expect(action.href).toBeNull()
  })

  it('phone 模式組成 tel: 連結', () => {
    const action = resolveBookingAction('yihua', {
      mode: 'phone',
      version: 1,
      phone: '07-392-8366'
    })
    expect(action.kind).toBe('phone')
    expect(action.href).toBe('tel:07-392-8366')
  })

  it('external 模式用傳入的網址', () => {
    const action = resolveBookingAction('yihua', {
      mode: 'external',
      version: 1,
      external_url: 'https://booking.example.com'
    })
    expect(action.kind).toBe('external')
    expect(action.href).toBe('https://booking.example.com')
  })

  it('不同校區給不同設定時，各自獨立不互相污染', () => {
    const yihua = resolveBookingAction('yihua', {
      mode: 'line',
      version: 1,
      line_url: 'https://lin.ee/yihua'
    })
    const minghua = resolveBookingAction('minghua', { mode: 'paused', version: 1 })
    expect(yihua.href).toBe('https://lin.ee/yihua')
    expect(minghua.kind).toBe('paused')
  })
})

describe('campusVisitCta（首頁五校卡的參觀入口）', () => {
  const minghua = { key: 'minghua', name: '明華校', phone: '07-556-6796' }

  it('還沒讀到設定或讀取失敗：維持「預約參觀Ｘ校」連到預約頁', () => {
    expect(campusVisitCta(minghua, undefined)).toEqual({ kind: 'visit', href: '/visit/minghua', label: '預約參觀明華校', note: null })
    expect(campusVisitCta(minghua, resolveBookingAction('minghua', null, true)).kind).toBe('visit')
  })

  it('開放線上選場次：連到預約頁', () => {
    const cta = campusVisitCta(minghua, resolveBookingAction('minghua', { mode: 'slots', version: 1 }))
    expect(cta.kind).toBe('visit')
    expect(cta.href).toBe('/visit/minghua')
  })

  it('暫停線上預約：改成致電，附上園方的說明，不再寫「預約參觀」連到約不了的預約頁', () => {
    const cta = campusVisitCta(minghua, resolveBookingAction('minghua', { mode: 'paused', version: 3, message: '線上預約即將開放，歡迎來電洽詢。' }))
    expect(cta).toEqual({ kind: 'phone', href: 'tel:07-556-6796', label: '致電明華校預約參觀', note: '線上預約即將開放，歡迎來電洽詢。' })
  })

  it('來電模式：預約設定有號碼時用設定的號碼', () => {
    const cta = campusVisitCta(minghua, resolveBookingAction('minghua', { mode: 'phone', version: 1, phone: '07-000-0000' }))
    expect(cta.href).toBe('tel:07-000-0000')
  })

  it('LINE／外部網站：照設定的連結；設定缺連結時退回致電', () => {
    expect(campusVisitCta(minghua, resolveBookingAction('minghua', { mode: 'line', version: 1, line_url: 'https://lin.ee/x' }))).toMatchObject({ kind: 'line', href: 'https://lin.ee/x', label: 'LINE 洽詢明華校' })
    expect(campusVisitCta(minghua, resolveBookingAction('minghua', { mode: 'external', version: 1, external_url: 'https://booking.example.com' }))).toMatchObject({ kind: 'external', label: '前往明華校預約網站' })
    expect(campusVisitCta(minghua, resolveBookingAction('minghua', { mode: 'line', version: 1 })).kind).toBe('phone')
  })

  it('暫停而且沒有任何電話：退回預約頁（那裡會顯示暫停說明）', () => {
    const cta = campusVisitCta({ key: 'renwu', name: '仁武校', phone: '' }, resolveBookingAction('renwu', { mode: 'paused', version: 1 }))
    expect(cta.kind).toBe('visit')
  })
})
