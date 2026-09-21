import { describe, expect, it } from 'vitest'
import { publicPage, validateTelemetry } from '../shared/telemetry'

describe('匿名效能與入口事件', () => {
  it('只追蹤公開路徑，永不帶 query/hash 或案件 token', () => {
    expect(publicPage('/campuses/renwu?token=secret#x')).toEqual({ page: 'campus', campus: 'renwu' })
    for (const path of ['/admin', '/preview', '/visit/manage/secret', '/campuses/fake']) expect(publicPage(path)).toBeNull()
  })
  it('拒絕多餘個資欄位、偽造成效與非法指標', () => {
    const event = { event: 'page_view', page: 'campus', campus: 'renwu', device: 'mobile' }
    expect(validateTelemetry(event)).toEqual(event)
    expect(validateTelemetry({ ...event, phone: '0912345678' })).toBeNull()
    expect(validateTelemetry({ ...event, event: 'visit_confirmed' })).toBeNull()
    expect(validateTelemetry({ ...event, event: 'LCP', value: -1 })).toBeNull()
    expect(validateTelemetry({ ...event, page: { toString: null } })).toBeNull()
  })
  it('指標僅接受有限非負值與隨機 UUID，保留可供 p75 去重的數值', () => {
    const event = { event: 'LCP', page: 'home', campus: null, device: 'desktop', value: 1234.5, id: 'd606df61-445a-4e65-9c5f-7e94a0766572' }
    expect(validateTelemetry(event)).toEqual(event)
    expect(validateTelemetry({ ...event, value: Infinity })).toBeNull()
    expect(validateTelemetry({ ...event, id: 'parent-phone' })).toBeNull()
  })
})
