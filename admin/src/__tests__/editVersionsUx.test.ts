// 2026-09-25 缺口 68、69：送出時帶 expected_version、別人先改過（409 *_VERSION_CONFLICT）
// 就提示並重新載入；新錯誤碼（SLOT_CLOSED、MEDIA_NOT_READY…）顯示後端的中文原因，
// 系統錯誤附上錯誤編號。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { computed, defineComponent } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter, matchedRouteKey } from 'vue-router'
import ElementPlus, { ElMessage, ElMessageBox } from 'element-plus'
import VisitSlotsView from '../views/VisitSlotsView.vue'
import VisitSchedulePanel from '../components/VisitSchedulePanel.vue'
import { api, ApiError } from '../api/client'
import { apiErrorCode, apiErrorMessage, isVersionConflict } from '../api/errors'
import { AUDIT_ACTION_LABELS, AUDIT_TARGET_LABELS } from '../api/labels'
import { useAuthStore } from '../stores/auth'
import { testUser } from './fixtures'

const wrappers: VueWrapper[] = []
afterEach(() => { wrappers.forEach(wrapper => wrapper.unmount()); wrappers.length = 0; vi.restoreAllMocks() })

async function mountAt(component: unknown, path: string, props: Record<string, unknown> = {}): Promise<VueWrapper> {
  const pinia = createPinia()
  useAuthStore(pinia).user = testUser('super_admin', { id: 'me', email: 'me@example.invalid', campus_keys: [] })
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: defineComponent({ template: '<div />' }) }] })
  await router.push(path)
  await router.isReady()
  const wrapper = mount(component as ReturnType<typeof defineComponent>, {
    props,
    global: { plugins: [pinia, router, ElementPlus], provide: { [matchedRouteKey as symbol]: computed(() => router.currentRoute.value.matched[0]) } },
  } as never)
  wrappers.push(wrapper)
  await flushPromises()
  return wrapper
}

const conflict = (code: string, message: string) => new ApiError(409, { code, message, current_version: 2, request_id: 'abcdef0123456789' })

describe('API 錯誤解析', () => {
  it('新代碼顯示後端的中文原因，只有 *_VERSION_CONFLICT 算「別人先改過」', () => {
    const closed = new ApiError(409, { code: 'SLOT_CLOSED', message: '這個時段已關閉', request_id: 'r1' })
    expect(apiErrorCode(closed)).toBe('SLOT_CLOSED')
    expect(apiErrorMessage(closed, '失敗')).toBe('這個時段已關閉')
    expect(isVersionConflict(closed)).toBe(false)
    expect(isVersionConflict(new ApiError(409, { code: 'MEDIA_NOT_READY', message: 'x' }))).toBe(false)
    expect(isVersionConflict(conflict('SLOT_VERSION_CONFLICT', 'x'))).toBe(true)
    expect(isVersionConflict(new ApiError(422, { code: 'SLOT_VERSION_CONFLICT' }))).toBe(false)
  })

  it('沒有訊息時用代碼對照；系統錯誤附錯誤編號；422 陣列與字串照舊', () => {
    expect(apiErrorMessage(new ApiError(409, { code: 'MEDIA_NOT_READY' }), '失敗')).toBe('引用的素材還沒處理完成或已被刪除')
    expect(apiErrorMessage(new ApiError(409, { code: 'UNKNOWN_CODE' }), '失敗')).toBe('失敗')
    expect(
      apiErrorMessage(new ApiError(500, { code: 'INTERNAL_ERROR', message: '系統發生未預期的錯誤，請稍後再試', request_id: '0123456789abcdef' }), '失敗'),
    ).toBe('系統發生未預期的錯誤，請稍後再試（錯誤編號 01234567）')
    expect(apiErrorMessage(new ApiError(422, [{ loc: ['body', 'x'], msg: 'Value error, 天數至少 30', type: 'value_error' }]), '失敗')).toBe('天數至少 30')
    expect(apiErrorMessage(new ApiError(404, '找不到這個項目'), '失敗')).toBe('找不到這個項目')
    expect(apiErrorMessage(new TypeError('Failed to fetch'), '失敗')).toBe('失敗')
  })

  it('新的稽核動作、對象與歷程都有中文', () => {
    for (const action of ['visit_request.confirm', 'visit_request.cancel', 'visit_slot.update', 'media.upload', 'media.update', 'media.replace', 'retention_policy.update']) {
      expect(AUDIT_ACTION_LABELS[action], action).toBeTruthy()
    }
    expect(AUDIT_TARGET_LABELS.visit_slot).toBe('參觀時段')
  })
})

describe('時段：帶版本送出，別人先改過就重新讀取', () => {
  const slot = { id: 's1', campus_key: 'yihua', slot_date: '2099-01-06', start_time: '10:00:00', end_time: '11:00:00', capacity: 3, booked_count: 0, closed: false, closed_source: null, version: 4 }

  it('關閉時段帶 expected_version；409 版本衝突時提示並重讀清單', async () => {
    const get = vi.spyOn(api, 'get').mockImplementation(async path => {
      if (String(path).startsWith('/admin/visit-schedule/')) return { campus_key: 'yihua', min_lead_hours: 24, max_advance_days: 60, rules: [], exceptions: [], version: 1 } as never
      return [slot] as never
    })
    const patch = vi.spyOn(api, 'patch').mockRejectedValue(conflict('SLOT_VERSION_CONFLICT', '這個時段剛被其他人修改（或因休假日關閉），請重新載入後再調整'))
    const warning = vi.spyOn(ElMessage, 'warning')
    const wrapper = await mountAt(VisitSlotsView, '/slots')
    const slotCalls = () => get.mock.calls.filter(([path]) => String(path).startsWith('/admin/slots?')).length
    const before = slotCalls()
    await wrapper.find('.slot-row').findAll('button').find(button => button.text() === '關閉')!.trigger('click')
    await flushPromises()
    expect(patch).toHaveBeenCalledWith('/admin/slots/s1', { closed: true, expected_version: 4 })
    expect(warning).toHaveBeenCalledWith('這個時段剛被其他人修改（或因休假日關閉），請重新載入後再調整')
    expect(slotCalls()).toBe(before + 1)
  })
})

describe('每週開放規則：整份替換要帶版本，衝突時不蓋掉別人', () => {
  const schedule = { campus_key: 'yihua', min_lead_hours: 24, max_advance_days: 60, rules: [], exceptions: [], rules_extended_on: null, version: 5 }

  it('儲存帶 expected_version；衝突時詢問是否重新載入', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue(schedule as never)
    const put = vi.spyOn(api, 'put').mockRejectedValue(conflict('VISIT_SCHEDULE_VERSION_CONFLICT', '開放規則剛被其他人修改，請重新載入後再編輯'))
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    const wrapper = await mountAt(VisitSchedulePanel, '/', { campusKey: 'yihua', canManage: true })
    await wrapper.findAll('button').find(button => button.text().includes('新增規則'))!.trigger('click')
    await flushPromises()
    await wrapper.findAll('button').find(button => button.text() === '儲存規則')!.trigger('click')
    await flushPromises()
    expect(put).toHaveBeenCalledWith('/admin/visit-schedule/yihua', expect.objectContaining({ expected_version: 5 }))
    expect(String(confirm.mock.calls[0]![0])).toContain('還沒儲存的修改會捨棄')
    // 確認後重新讀取規則。
    expect(get).toHaveBeenCalledTimes(2)
  })
})
