import { describe, it, expect } from 'vitest'
import { resolveBookingAction } from '../app/utils/booking-action'

describe('分校預約入口', () => {
  it('未選校先選校', () => {
    expect(resolveBookingAction(null, null).kind).toBe('choose_campus')
  })

  it('選了校但還沒有設定資料，一樣視為未選校（保守處理）', () => {
    expect(resolveBookingAction('renwu', null).kind).toBe('choose_campus')
  })

  it('inquiry 模式導向站內表單頁，使用正式路徑', () => {
    const action = resolveBookingAction('yihua', { mode: 'inquiry', version: 3 })
    expect(action.kind).toBe('form')
    expect(action.href).toBe('/visit/yihua')
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
