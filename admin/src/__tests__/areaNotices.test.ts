import { describe, expect, it } from 'vitest'
import { areaNoticeLink, areaNoticeMeta, areaNoticeTitle, isAreaNotice } from '../admissions/areaNotices'
import { NOTIFICATION_KIND_LABELS, notificationKindLabel } from '../api/labels'

const change = (extra: Record<string, unknown> = {}) => ({
  radius_km: 3, provider: 'kindergarten', source_id: 'k1', name: '高雄市私立甲幼兒園', change: 'opened', kind: 'private',
  old_kind: null, new_kind: null, distance_m: 1234, date: '2026-10-02', date_basis: 'registered', ...extra,
})
const penalty = (extra: Record<string, unknown> = {}) => ({
  radius_km: 3, source_id: 'k1', name: '高雄市私立甲幼兒園', occurred_on: '2026-10-02', doc_no: '高市教幼字第1號',
  laws: ['幼兒教育及照顧法第58條'], distance_m: 1500, ...extra,
})

describe('附近園所異動與裁罰通知的文字（2026-11-16 規格 §7.4）', () => {
  it('種類判斷與後端標題一致', () => {
    expect(isAreaNotice('area_provider_change')).toBe(true)
    expect(isAreaNotice('area_penalty')).toBe(true)
    expect(isAreaNotice('visit_request_created')).toBe(false)
    expect(NOTIFICATION_KIND_LABELS.area_provider_change).toBe('附近園所異動')
    expect(notificationKindLabel('area_penalty')).toBe('附近幼兒園裁罰')
  })

  it('標題：新設、停辦、類型變動、裁罰', () => {
    expect(areaNoticeTitle('area_provider_change', change())).toBe('3 公里內新設：甲幼兒園')
    expect(areaNoticeTitle('area_provider_change', change({ change: 'closed' }))).toBe('3 公里內停辦：甲幼兒園')
    expect(areaNoticeTitle('area_provider_change', change({ change: 'kind_changed', old_kind: 'private', new_kind: 'quasi_public' })))
      .toBe('3 公里內類型變動：甲幼兒園 私立 → 準公共')
    expect(areaNoticeTitle('area_penalty', penalty())).toBe('3 公里內裁罰：甲幼兒園')
  })

  it('標題：托嬰用托嬰短名', () => {
    expect(areaNoticeTitle('area_provider_change', change({ provider: 'babycare', change: 'closed', name: '高雄市三民區某某托嬰中心', kind: 'center' })))
      .toBe('3 公里內停辦：三民區某某托嬰中心')
  })

  it('內文：距離・類型・民國日期；裁罰寫法條', () => {
    expect(areaNoticeMeta('area_provider_change', change())).toBe('1.2 km・私立・115-10-02')
    expect(areaNoticeMeta('area_provider_change', change({ distance_m: 800, change: 'closed' }))).toBe('800 m・私立・115-10-02')
    expect(areaNoticeMeta('area_penalty', penalty())).toBe('1.5 km・115-10-02・幼兒教育及照顧法第58條')
    expect(areaNoticeMeta('area_penalty', penalty({ laws: ['甲法第1條', '乙法第2條', '丙法第3條'] }))).toBe('1.5 km・115-10-02・甲法第1條等 3 條')
    expect(areaNoticeMeta('area_penalty', penalty({ laws: [] }))).toBe('1.5 km・115-10-02')
  })

  it('payload 缺欄位或型別不對：退回種類標題、內文空白', () => {
    expect(areaNoticeTitle('area_provider_change', {})).toBe('附近園所異動')
    expect(areaNoticeTitle('area_penalty', { name: 42 })).toBe('附近幼兒園裁罰')
    expect(areaNoticeTitle('area_provider_change', change({ change: 'weird' }))).toBe('附近園所異動')
    expect(areaNoticeMeta('area_provider_change', {})).toBe('')
    expect(areaNoticeMeta('area_penalty', { distance_m: 'x' })).toBe('')
  })

  it('連結：該校區域分析的同業模式', () => {
    expect(areaNoticeLink('yihua')).toBe('/admissions-stats?campus=yihua&sub=area&map=peers')
  })
})
