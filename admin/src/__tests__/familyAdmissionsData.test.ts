// 家庭版面的招生資料面板（docs/specs/2026-10-05-visit-family-page-design.md 5.3）。
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { VueWrapper } from '@vue/test-utils'
import FamilyAdmissionsData from '../components/visit/FamilyAdmissionsData.vue'
import RecordDialog from '../components/admissions/RecordDialog.vue'
import { button, cleanup, hasButton, mockGet, mountWith, visit } from './admissionsTestKit'

// 編輯表單打開時可能讀選項或名單：一律走 mock（對不上的路徑回空陣列），不打真的 API。
beforeEach(() => { mockGet({}) })
afterEach(cleanup)

const options = {
  months: [], sources: [], referrers: [], grades: [], no_deposit_reasons: [], contact_channels: {},
  source_categories: { referral: '有緣名單（家長介紹／社區招生）' },
}
const paper = { english_name: null, father_occupation: null, mother_occupation: null }
const labels = (wrapper: VueWrapper) => wrapper.findAll('.el-descriptions__label').map((cell) => cell.text())
const valueOf = (wrapper: VueWrapper, label: string) => {
  const cells = wrapper.findAll('.el-descriptions__label')
  const index = cells.findIndex((cell) => cell.text() === label)
  return wrapper.findAll('.el-descriptions__content')[index]?.text()
}

describe('招生資料面板', () => {
  it('地址沿用訪視明細：地址優先、沒有才用行政區；家長回應叫電訪回應', async () => {
    const both = await mountWith(FamilyAdmissionsData, { props: { visit: visit({ ...paper, district: '鳳山區', address: '中山路 1 號', parent_response: '想再看看' }), options, editable: true } })
    expect(valueOf(both.wrapper, '地址')).toBe('中山路 1 號')
    expect(valueOf(both.wrapper, '電訪回應')).toBe('想再看看')
    expect(labels(both.wrapper)).not.toContain('家長回應')
    cleanup()
    const onlyDistrict = await mountWith(FamilyAdmissionsData, { props: { visit: visit({ ...paper, district: '鳳山區', address: null }), options, editable: true } })
    expect(valueOf(onlyDistrict.wrapper, '地址')).toBe('鳳山區')
  })

  it('固定列依序列出；有值才列的只列有值的；來源分類用選項文字、電話可撥', async () => {
    const record = visit({ ...paper, english_name: 'Hana', source_category: 'referral', rides_bus: true, tour_guide_name: 'Amy', father_occupation: '工程師' })
    const { wrapper } = await mountWith(FamilyAdmissionsData, { props: { visit: record, options, editable: true } })
    expect(labels(wrapper)).toEqual([
      '幼生姓名', '英文名字', '生日', '適讀班級', '聯絡人', '電話', '入學學期', '搭娃娃車', '帶參觀老師', '來源分類', '來源備註', '家長介紹', '父親職業',
    ])
    expect(valueOf(wrapper, '來源分類')).toBe('有緣名單（家長介紹／社區招生）')
    expect(valueOf(wrapper, '入學學期')).toBe('115 上學期')
    expect(valueOf(wrapper, '搭娃娃車')).toBe('要搭')
    expect(valueOf(wrapper, '家長介紹')).toBe('—')
    expect(wrapper.get('a[href="tel:0912345678"]').text()).toBe('0912345678')
  })

  it('預繳、未預繳原因、退出原因依階段才列', async () => {
    const deposited = await mountWith(FamilyAdmissionsData, { props: { visit: visit({ ...paper, stage: 'deposited', has_deposit: true, deposit_collector: 'Amy' }), options, editable: true } })
    expect(valueOf(deposited.wrapper, '收預繳人員')).toBe('Amy')
    cleanup()
    const visited = await mountWith(FamilyAdmissionsData, { props: { visit: visit({ ...paper, no_deposit_reason: '時程未到／仍在觀望', no_deposit_reason_detail: '等爸爸決定' }), options, editable: true } })
    expect(valueOf(visited.wrapper, '未預繳原因')).toBe('時程未到／仍在觀望：等爸爸決定')
    cleanup()
    const withdrawn = await mountWith(FamilyAdmissionsData, { props: { visit: visit({ ...paper, stage: 'withdrawn', withdrawn_at: '2026-10-09T00:00:00Z', withdrawn_from: 'deposited', withdraw_reason: '改送他校' }), options, editable: true } })
    expect(valueOf(withdrawn.wrapper, '退出原因')).toBe('改送他校')
  })

  it('沒填姓名寫「待補」', async () => {
    const { wrapper } = await mountWith(FamilyAdmissionsData, { props: { visit: visit({ ...paper, child_name: '（未填姓名）' }), options, editable: true } })
    expect(valueOf(wrapper, '幼生姓名')).toBe('待補')
  })

  it('編輯開招生的編輯表單；存檔往上傳', async () => {
    const record = visit({ ...paper })
    const { wrapper } = await mountWith(FamilyAdmissionsData, { props: { visit: record, options, editable: true } })
    await button(wrapper, '編輯')!.trigger('click')
    const dialog = wrapper.getComponent(RecordDialog)
    expect(dialog.props()).toMatchObject({ modelValue: true, mode: 'edit', campusKey: 'yihua', record })
    dialog.vm.$emit('saved', { ...record, version: 2 })
    expect(wrapper.emitted('saved')?.[0]?.[0]).toMatchObject({ version: 2 })
  })

  it('不能寫入或已匿名化：沒有編輯；匿名化說明、不給撥號', async () => {
    const readonly = await mountWith(FamilyAdmissionsData, { props: { visit: visit({ ...paper }), options, editable: false } })
    expect(hasButton(readonly.wrapper, '編輯')).toBe(false)
    cleanup()
    const anonymized = await mountWith(FamilyAdmissionsData, { props: { visit: visit({ ...paper, anonymized_at: '2026-10-01T00:00:00Z' }), options, editable: true } })
    expect(hasButton(anonymized.wrapper, '編輯')).toBe(false)
    expect(anonymized.wrapper.text()).toContain('這筆招生訪視已依保存政策匿名化')
    expect(anonymized.wrapper.find('a[href^="tel:"]').exists()).toBe(false)
  })
})
