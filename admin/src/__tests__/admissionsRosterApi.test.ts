import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '../api/client'
import * as roster from '../api/roster'

afterEach(() => { vi.restoreAllMocks() })

describe('編班與缺額 API 路徑', () => {
  it('讀整張編班表：統計日期沒給就不帶 as_of', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue({} as never)
    await roster.getRoster('yihua', 115)
    await roster.getRoster('yihua', 115, '2026-09-15')
    expect(get.mock.calls.map((call) => call[0])).toEqual([
      '/admin/admissions/roster?campus_key=yihua&school_year=115',
      '/admin/admissions/roster?campus_key=yihua&school_year=115&as_of=2026-09-15',
    ])
  })

  it('班級：建立帶 campus_key，修改與刪除帶版本', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({} as never)
    const patch = vi.spyOn(api, 'patch').mockResolvedValue({} as never)
    const remove = vi.spyOn(api, 'delete').mockResolvedValue(undefined as never)
    const body = { school_year: 115, grade: '大班', name: '大一班', class_code: '大1' } as never
    await roster.createClass('renwu', body)
    expect(post).toHaveBeenCalledWith('/admin/admissions/roster/classes?campus_key=renwu', body)
    await roster.updateClass('c-1', { target_seats: 22, expected_version: 1 })
    expect(patch).toHaveBeenCalledWith('/admin/admissions/roster/classes/c-1', { target_seats: 22, expected_version: 1 })
    await roster.deleteClass('c-1', 3)
    expect(remove).toHaveBeenCalledWith('/admin/admissions/roster/classes/c-1?expected_version=3')
  })

  it('幼生：新增、編輯、移動', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({} as never)
    const patch = vi.spyOn(api, 'patch').mockResolvedValue({} as never)
    await roster.createStudents('yihua', { school_year: 115, names: ['測試甲'], class_id: 'c-1' })
    expect(post).toHaveBeenLastCalledWith('/admin/admissions/roster/students?campus_key=yihua', { school_year: 115, names: ['測試甲'], class_id: 'c-1' })
    await roster.updateStudent('s-1', { note: '12或2', expected_version: 2 })
    expect(patch).toHaveBeenCalledWith('/admin/admissions/roster/students/s-1', { note: '12或2', expected_version: 2 })
    await roster.moveStudent('s-1', { class_id: null, position: 0, expected_version: 2 })
    expect(post).toHaveBeenLastCalledWith('/admin/admissions/roster/students/s-1/move', { class_id: null, position: 0, expected_version: 2 })
  })

  it('狀態動作：已入園、離園、退預繳、恢復', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({} as never)
    await roster.enterStudent('s-1', 2, '2026-10-05')
    expect(post).toHaveBeenLastCalledWith('/admin/admissions/roster/students/s-1/enter', { expected_version: 2, enrollment_date: '2026-10-05' })
    await roster.leaveStudent('s-1', 2)
    expect(post).toHaveBeenLastCalledWith('/admin/admissions/roster/students/s-1/leave', { expected_version: 2, left_date: null })
    await roster.refundStudent('s-1', 2)
    expect(post).toHaveBeenLastCalledWith('/admin/admissions/roster/students/s-1/refund', { expected_version: 2, refunded_date: null })
    await roster.restoreStudent('s-1', 2, 'c-1')
    expect(post).toHaveBeenLastCalledWith('/admin/admissions/roster/students/s-1/restore', { expected_version: 2, class_id: 'c-1' })
  })

  it('三段目標、結算紀錄', async () => {
    const put = vi.spyOn(api, 'put').mockResolvedValue({} as never)
    const post = vi.spyOn(api, 'post').mockResolvedValue({} as never)
    await roster.saveTierTargets('yihua', { school_year: 115, semester: 2, base: 220, boost: null, top: null })
    expect(put).toHaveBeenCalledWith('/admin/admissions/roster/tier-targets?campus_key=yihua', { school_year: 115, semester: 2, base: 220, boost: null, top: null })
    await roster.createSnapshot('yihua', { school_year: 115, as_of: '2026-09-15' })
    expect(post).toHaveBeenLastCalledWith('/admin/admissions/roster/snapshots?campus_key=yihua', { school_year: 115, as_of: '2026-09-15', overwrite: false })
    await roster.createSnapshot('yihua', { school_year: 115, as_of: '2026-09-15', overwrite: true })
    expect(post).toHaveBeenLastCalledWith('/admin/admissions/roster/snapshots?campus_key=yihua', { school_year: 115, as_of: '2026-09-15', overwrite: true })
  })

  it('下學年年級目標沿用計畫名額 API，固定寫下學年上學期', async () => {
    const put = vi.spyOn(api, 'put').mockResolvedValue({} as never)
    await roster.saveNextYearTargets('yihua', 115, { 大班: 60, 小班: null })
    expect(put).toHaveBeenCalledWith('/admin/admissions/intake-targets?campus_key=yihua', { school_year: 116, semester: 1, targets: { 大班: 60, 小班: null } })
  })
})
