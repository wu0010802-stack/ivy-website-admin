// 招生統計未預繳明細的「查看」（2026-11-20）：訪視明細的網址多一個 open（訪視 id），到了直接開那一筆的編輯表單。
// 這裡測 RecordsTab 的 openRecordId、以及招生入學頁網址 open ↔ openRecordId 的同步。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { ElMessage } from 'element-plus'
import AdmissionsView from '../views/AdmissionsView.vue'
import RecordsTab from '../components/admissions/RecordsTab.vue'
import RecordDialog from '../components/admissions/RecordDialog.vue'
import { cleanup, mockGet, mountWith, pathsTo, visit, VR_ID } from './admissionsTestKit'

afterEach(cleanup)

const OPEN_ID = 'v-open'
const tabProps = (changes: Record<string, unknown> = {}) => ({ campusKey: 'yihua', schoolYear: 115, semester: null, month: '', visitRequestId: '', ...changes })
const NOT_FOUND = '找不到這筆訪視，可能已經刪除或不在這個校區。'

describe('RecordsTab：openRecordId', () => {
  it('同校：讀那一筆、開編輯表單，然後回報 update:openRecordId 空字串（網址拿掉 open）', async () => {
    const get = mockGet({
      '/admin/admissions/records?': [],
      [`/admin/admissions/records/${OPEN_ID}`]: visit({ id: OPEN_ID, child_name: '林小安' }),
    })
    const { wrapper } = await mountWith(RecordsTab, { props: tabProps({ openRecordId: OPEN_ID }) })

    expect(pathsTo(get, `/admin/admissions/records/${OPEN_ID}`)).toHaveLength(1)
    const dialog = wrapper.getComponent(RecordDialog)
    expect(dialog.props()).toMatchObject({ modelValue: true, mode: 'edit', campusKey: 'yihua' })
    expect(dialog.props('record')).toMatchObject({ id: OPEN_ID, child_name: '林小安' })
    expect(wrapper.emitted('update:openRecordId')).toEqual([['']])
  })

  it('那一筆屬於別的校區：不開表單，提示找不到，仍然清掉 open', async () => {
    mockGet({
      '/admin/admissions/records?': [],
      [`/admin/admissions/records/${OPEN_ID}`]: visit({ id: OPEN_ID, campus_key: 'minghua' }),
    })
    const error = vi.spyOn(ElMessage, 'error')
    const { wrapper } = await mountWith(RecordsTab, { props: tabProps({ openRecordId: OPEN_ID }) })

    expect(wrapper.getComponent(RecordDialog).props('modelValue')).toBe(false)
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ message: NOT_FOUND }))
    expect(wrapper.emitted('update:openRecordId')).toEqual([['']])
  })

  it('讀取失敗（已刪除、沒有權限）：不開表單，提示找不到，仍然清掉 open', async () => {
    mockGet({
      '/admin/admissions/records?': [],
      [`/admin/admissions/records/${OPEN_ID}`]: () => { throw new Error('404') },
    })
    const error = vi.spyOn(ElMessage, 'error')
    const { wrapper } = await mountWith(RecordsTab, { props: tabProps({ openRecordId: OPEN_ID }) })

    expect(wrapper.getComponent(RecordDialog).props('modelValue')).toBe(false)
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ message: NOT_FOUND }))
    expect(wrapper.emitted('update:openRecordId')).toEqual([['']])
  })

  it('沒給 openRecordId：不讀單筆、不開表單、不回報', async () => {
    const get = mockGet({ '/admin/admissions/records?': [visit()] })
    const { wrapper } = await mountWith(RecordsTab, { props: tabProps() })

    expect(pathsTo(get, '/admin/admissions/records/')).toEqual([])
    expect(wrapper.getComponent(RecordDialog).props('modelValue')).toBe(false)
    expect(wrapper.emitted('update:openRecordId')).toBeUndefined()
  })
})

describe('招生入學頁：網址 open', () => {
  it('tab=records 的 open 傳給 RecordsTab，表單開了之後從網址拿掉，其他參數留著', async () => {
    mockGet({
      '/admin/admissions/records?': [],
      [`/admin/admissions/records/${VR_ID}`]: visit({ id: VR_ID, child_name: '林小安' }),
    })
    const { wrapper, router } = await mountWith(AdmissionsView, { path: `/admissions?campus=yihua&tab=records&month=115.09&open=${VR_ID}` })
    await flushPromises()

    expect(wrapper.getComponent(RecordDialog).props()).toMatchObject({ modelValue: true, mode: 'edit' })
    expect(router.currentRoute.value.query).toEqual({ campus: 'yihua', tab: 'records', month: '115.09' })
    expect(wrapper.getComponent(RecordsTab).props('openRecordId')).toBe('')
  })

  it('不是 UUID 的 open、或不在訪視明細分頁的 open，一律當沒有，也不寫回網址', async () => {
    const get = mockGet({ '/admin/admissions/records?': [] })
    const bad = await mountWith(AdmissionsView, { path: '/admissions?campus=yihua&tab=records&open=hack' })
    expect(bad.router.currentRoute.value.query).toEqual({ campus: 'yihua', tab: 'records' })
    cleanup()

    mockGet({ '/admin/admissions/records?': [] })
    const wrongTab = await mountWith(AdmissionsView, { path: `/admissions?campus=yihua&open=${VR_ID}` })
    expect(wrongTab.router.currentRoute.value.query).toEqual({ campus: 'yihua' })
    expect(pathsTo(get, '/admin/admissions/records/')).toEqual([])
  })
})
