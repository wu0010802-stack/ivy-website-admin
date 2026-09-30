import { describe, expect, it } from 'vitest'
import { publicPage, validateTelemetry } from '../shared/telemetry'

describe('匿名效能與入口事件', () => {
  it('只追蹤公開路徑，永不帶 query/hash 或案件 token', () => {
    expect(publicPage('/campuses/renwu?token=secret#x')).toEqual({ page: 'campus', campus: 'renwu' })
    for (const path of ['/admin', '/preview', '/visit/manage/secret', '/campuses/fake', '/news/a/b', '/aboutx']) expect(publicPage(path)).toBeNull()
  })
  it('公開內頁也回報瀏覽與 CWV（2026-09-30），不帶校；消息內文頁歸 news、不帶文章代號', () => {
    for (const page of ['about', 'curriculum', 'environment', 'admission', 'news']) expect(publicPage(`/${page}/`)).toEqual({ page, campus: null })
    expect(publicPage('/news/garden?utm=x#top')).toEqual({ page: 'news', campus: null })
    const vital = { event: 'INP', page: 'environment', campus: null, device: 'mobile', value: 120, id: 'd606df61-445a-4e65-9c5f-7e94a0766572' }
    expect(validateTelemetry(vital)).toEqual(vital)
    expect(validateTelemetry({ ...vital, campus: 'yihua' })).toBeNull()
    expect(validateTelemetry({ event: 'page_view', page: 'visit', campus: 'yihua', device: 'mobile' })).not.toBeNull()
    expect(validateTelemetry({ ...vital, page: 'news/garden' })).toBeNull()
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
