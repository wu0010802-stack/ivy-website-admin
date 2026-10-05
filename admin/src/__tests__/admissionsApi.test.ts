import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError } from '../api/client'
import * as admissions from '../api/admissions'
import { apiErrorMessage, isVersionConflict } from '../api/errors'

afterEach(() => { vi.restoreAllMocks() })

describe('招生 API 路徑（總覽 API 表）', () => {
  it('列表只帶有值的篩選，分頁固定帶 page 與 page_size', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue([] as never)
    await admissions.listRecords({ campus_key: 'yihua', month: '115.09', grade: null, has_deposit: false, q: '', page: 2, page_size: 50 })
    const path = String(get.mock.calls[0]![0])
    expect(path.startsWith('/admin/admissions/records?')).toBe(true)
    expect(Object.fromEntries(new URLSearchParams(path.split('?')[1]))).toEqual({
      campus_key: 'yihua', month: '115.09', has_deposit: 'false', page: '2', page_size: '50',
    })
  })

  it('建立訪視的 campus_key 放 query（同 POST /admin/slots）；刪除帶 expected_version', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({} as never)
    const remove = vi.spyOn(api, 'delete').mockResolvedValue(undefined as never)
    await admissions.createRecord('renwu', { child_name: '小明', visit_date: '2026-09-08' } as never)
    expect(post).toHaveBeenCalledWith('/admin/admissions/records?campus_key=renwu', { child_name: '小明', visit_date: '2026-09-08' })
    await admissions.deleteRecord('v-1', 3)
    expect(remove).toHaveBeenCalledWith('/admin/admissions/records/v-1?expected_version=3')
  })

  it('看板不選學期時不帶 semester；選項帶校區', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue({} as never)
    await admissions.getBoard('yihua', 115, null)
    await admissions.getOptions('yihua')
    await admissions.getRecord('v-1')
    await admissions.listEvents('v-1')
    expect(get.mock.calls.map((call) => call[0])).toEqual([
      '/admin/admissions/board?campus_key=yihua&school_year=115',
      '/admin/admissions/options?campus_key=yihua',
      '/admin/admissions/records/v-1',
      '/admin/admissions/records/v-1/events',
    ])
  })

  it('狀態轉換送齊所有欄位（沒用到的是 null）；座位、補建、編輯的路徑', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({} as never)
    const patch = vi.spyOn(api, 'patch').mockResolvedValue({} as never)
    await admissions.transition('v-1', admissions.transitionRequest('deposited', 2, { deposit_collector: '林老師' }))
    expect(post).toHaveBeenLastCalledWith('/admin/admissions/records/v-1/transition', {
      to_stage: 'deposited', expected_version: 2, reason: null, deposit_collector: '林老師',
      enrolled_on: null, grade: null, target_school_year: null, target_semester: null,
    })
    await admissions.setSeat('v-1', { grade: '小班', target_school_year: 115, target_semester: 1, expected_version: 2 } as never)
    expect(post).toHaveBeenLastCalledWith('/admin/admissions/records/v-1/seat', expect.objectContaining({ grade: '小班' }))
    await admissions.createFromVisitRequest('vr-9')
    expect(post).toHaveBeenLastCalledWith('/admin/admissions/from-visit-request/vr-9')
    await admissions.updateRecord('v-1', { notes: '再聯絡', expected_version: 2 } as never)
    expect(patch).toHaveBeenCalledWith('/admin/admissions/records/v-1', { notes: '再聯絡', expected_version: 2 })
  })
})

describe('招生錯誤碼', () => {
  it('版本衝突認得出來；後端沒帶 message 時有中文備援', () => {
    const conflict = new ApiError(409, { code: 'RECRUITMENT_VISIT_VERSION_CONFLICT', current_version: 4 })
    expect(isVersionConflict(conflict)).toBe(true)
    expect(apiErrorMessage(conflict, '失敗')).toBe('這筆招生訪視剛被其他人修改，請重新載入後再操作')
    expect(apiErrorMessage(new ApiError(422, { code: 'TRANSITION_NOT_ALLOWED' }), '失敗')).toBe('這個階段不能直接移過去')
  })
})
