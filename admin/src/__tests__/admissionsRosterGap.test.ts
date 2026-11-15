import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ApiError } from '../api/client'
import { api } from '../api/client'
import GapTable from '../components/admissions/roster/GapTable.vue'
import RosterTab from '../components/admissions/roster/RosterTab.vue'
import { cleanup, mockGet, mockPut, mountWith, pathsTo, reception } from './admissionsTestKit'
import { block, klass, roster, student } from './rosterTestKit'

afterEach(cleanup)

const ROOT = '/admin/admissions/roster'
const NAN = { 大班: null, 中班: null, 小班: null, 幼幼班: null, total: null }

function data(over: Parameters<typeof roster>[0] = {}) {
  return roster({
    current: block({ enrolled: { 大班: 60, 中班: 59 }, pending_s1: { 幼幼班: 8 }, pending_s2: { 中班: 1 }, estimate: { 大班: 60, 中班: 60, 幼幼班: 8 } }),
    next: block({ promoted: { 大班: 60 }, leaving: { 大班: 2 }, repeating: { 大班: 1 }, pending_next: { 小班: 4 }, estimate_next: { 大班: 59, 小班: 4 } }),
    ...over,
  })
}
const mountGap = (r = data()) => mountWith(GapTable, { props: { roster: r, canWrite: true } })
const rowLabels = (wrapper: { findAll: (s: string) => { text: () => string }[] }) => wrapper.findAll('tbody th[scope="row"]').map((th) => th.text())

describe('缺額統計表', () => {
  it('兩個區塊的列順序與列首符號', async () => {
    const { wrapper } = await mountGap()
    expect(rowLabels(wrapper).map((t) => t.replace(/\s+/g, ''))).toEqual([
      '目前在籍（截至11/15）', '預繳生：12–1月入園', '預繳生：2–7月入園', '115(下)預估人數',
      '目標人數各班目標加總', '達成率（預估÷目標）', '缺額／超額（預估－目標）', '全校三段目標',
      '這些人從哪裡來', '舊生升班（含12–7月入園預繳生）', '舊生下學年不讀', '大班重讀', '預繳生：116/8月入園', '116(上)預估人數',
      '目標人數', '達成率（預估÷目標）', '缺額／超額（預估－目標）', '全校三段目標',
    ])
    const signs = wrapper.findAll('tbody tr').filter((tr) => tr.find('th[scope="row"]').exists()).map((tr) => tr.find('.roster-sg').text())
    expect(signs.slice(0, 4)).toEqual(['', '＋', '＋', '＝'])
    expect(signs.slice(9, 14)).toEqual(['', '－', '＋', '＋', '＝'])
    expect(wrapper.text()).toContain('115(下)這學期的預估人數')
    expect(wrapper.text()).toContain('116(上)下學年開學的預估人數')
  })

  it('不讀那一列的數字前面加負號，合計欄是各年級加總', async () => {
    const { wrapper } = await mountGap()
    const row = wrapper.findAll('tbody tr').find((tr) => tr.text().includes('舊生下學年不讀'))!
    expect(row.findAll('td').slice(1).map((td) => td.text())).toEqual(['−2', '0', '0', '0', '−2'])
  })

  it('Y(下) 目標是文字、(Y+1)(上) 目標是輸入框', async () => {
    const r = data({ current: block({ estimate: { 大班: 60 } }, { targets: { 大班: 66, 中班: null, 小班: null, 幼幼班: null, total: 66 } }) })
    const { wrapper } = await mountGap(r)
    expect(wrapper.findAll('input[aria-label^="115下"]').filter((i) => i.attributes('aria-label')!.includes('目標人數'))).toHaveLength(0)
    expect(wrapper.findAll('input[aria-label^="116上"][aria-label$="目標人數"]')).toHaveLength(4)
    const target = wrapper.findAll('tbody tr').find((tr) => tr.text().startsWith('目標人數各班目標加總'))!
    expect(target.text()).toContain('66')
    expect(target.text()).toContain('未設定')
  })

  it('缺額文字：−6、額滿、＋1、—；合計在有年級沒目標時是 —', async () => {
    const gap = { 大班: -6, 中班: 0, 小班: 1, 幼幼班: null, total: null }
    const r = data({ current: block({ estimate: { 大班: 60 } }, { gap, achievement: { ...NAN, 大班: 91 }, targets: { 大班: 66, 中班: 5, 小班: 5, 幼幼班: null, total: 76 } }) })
    const { wrapper } = await mountGap(r)
    const row = wrapper.findAll('tbody tr').find((tr) => tr.text().startsWith('缺額／超額'))!
    expect(row.findAll('td').slice(1).map((td) => td.text())).toEqual(['−6', '額滿', '＋1', '—', '—'])
    const rate = wrapper.findAll('tbody tr').find((tr) => tr.text().startsWith('達成率'))!
    expect(rate.findAll('td').slice(1).map((td) => td.text())).toEqual(['91%', '—', '—', '—', '—'])
  })

  it('三段目標文字與輸入框；改完送出該區塊的三個數字', async () => {
    const tier = { base: 220, boost: 230, top: 240, reached: 'boost' as const, next: 'top' as const, short: 4 }
    const r = data({ current: block({ estimate: { 大班: 236 } }, { tier }) })
    const { wrapper } = await mountGap(r)
    expect(wrapper.text()).toContain('已達激勵目標，離超越目標還差 4 人')
    const inputs = wrapper.findAll('input[aria-label^="115下"][aria-label$="目標"]')
    expect(inputs.map((i) => (i.element as HTMLInputElement).value)).toEqual(['220', '230', '240'])
    await inputs[2]!.setValue('250')
    expect(wrapper.emitted('save-tier')![0]).toEqual(['current', { base: 220, boost: 230, top: 250 }])
    const next = wrapper.findAll('input[aria-label^="116上"][aria-label$="目標"]').filter((i) => !i.attributes('aria-label')!.includes('目標人數'))
    await next[0]!.setValue('190')
    expect(wrapper.emitted('save-tier')![1]).toEqual(['next', { base: 190, boost: null, top: null }])
  })

  it('下學年年級目標失焦送出；清空就是未設定', async () => {
    const r = data({ next: block({ estimate_next: { 大班: 59 } }, { targets: { ...NAN, 大班: 60 } }) })
    const { wrapper } = await mountGap(r)
    const input = wrapper.get('input[aria-label="116上 大班目標人數"]')
    expect((input.element as HTMLInputElement).value).toBe('60')
    await input.setValue('')
    expect(wrapper.emitted('save-next-target')![0]).toEqual(['大班', null])
  })

  it('改統計日期、今天與結算日按鈕都送出 change-as-of', async () => {
    const { wrapper } = await mountGap()
    const date = wrapper.get('input[type="date"]')
    expect(date.attributes('min')).toBe('2026-08-01')
    expect(date.attributes('max')).toBe('2026-11-15')
    await date.setValue('2026-09-20')
    expect(wrapper.emitted('change-as-of')![0]).toEqual(['2026-09-20'])
    await wrapper.findAll('button').find((b) => b.text() === '9/15 結算日')!.trigger('click')
    expect(wrapper.emitted('change-as-of')![1]).toEqual(['2026-09-15'])
    await wrapper.findAll('button').find((b) => b.text() === '今天')!.trigger('click')
    expect(wrapper.emitted('change-as-of')![2]).toEqual(['2026-11-15'])
  })

  it('9/15 結算日：今天是 2026-09-10 時不顯示、2026-11-15 時顯示；3/15 到了才出現', async () => {
    const early = await mountGap(data({ today: '2026-09-10', as_of: '2026-09-10' }))
    expect(early.wrapper.findAll('button').map((b) => b.text())).not.toContain('9/15 結算日')
    cleanup()
    const mid = await mountGap()
    const labels = mid.wrapper.findAll('button').map((b) => b.text())
    expect(labels).toContain('9/15 結算日')
    expect(labels).not.toContain('3/15 結算日')
    cleanup()
    const late = await mountGap(data({ today: '2027-03-15', as_of: '2027-03-15' }))
    expect(late.wrapper.findAll('button').map((b) => b.text())).toContain('3/15 結算日')
  })

  it('回算時顯示說明句；今天不顯示', async () => {
    const past = await mountGap(data({ as_of: '2026-09-15' }))
    expect(past.wrapper.text()).toContain('這是回算到 9/15 的數字（依入園日、離園日、預繳日期）；上方編班表顯示的是現在的名單。')
    expect(past.wrapper.text()).toContain('在籍（截至 9/15）')
    cleanup()
    const today = await mountGap()
    expect(today.wrapper.text()).not.toContain('這是回算到')
  })

  it('不足齡的說明與人數；missing_birthday 與 incomplete 的提醒句', async () => {
    const r = data({ underage_enrolled: 10, underage_pending: 31, missing_birthday: 3, incomplete: 2 })
    const { wrapper } = await mountGap(r)
    const note = wrapper.get('.roster-gap-note').text()
    expect(note).toContain('不足齡由生日自動判定：116 年 9 月 1 日還沒滿 3 歲（113 年 9 月 2 日以後出生）的幼幼班幼生，下學年不能升小班（在籍 10 人、預繳 31 人）。')
    expect(note).toContain('還有 3 位幼幼班幼生沒填生日，暫時算可以升小班。')
    expect(note).toContain('有 2 位預繳生缺班別或入學學期，還沒算進來。')
    cleanup()
    const clean = await mountGap()
    expect(clean.wrapper.get('.roster-gap-note').text()).not.toContain('沒填生日')
    expect(clean.wrapper.get('.roster-gap-note').text()).not.toContain('缺班別')
  })

  it('沒有寫入權限時目標與三段目標是文字，沒有存結算紀錄', async () => {
    const { wrapper } = await mountWith(GapTable, { props: { roster: data(), canWrite: false } })
    expect(wrapper.findAll('tbody input')).toHaveLength(0)
    expect(wrapper.findAll('button').map((b) => b.text())).not.toContain('存成結算紀錄')
  })
})

describe('分頁整合', () => {
  async function mountTab(initial = data()) {
    let current = initial
    const get = mockGet({ [ROOT]: () => current })
    const mounted = await mountWith(RosterTab, { props: { campusKey: 'yihua', schoolYear: 115 }, user: reception() })
    return { ...mounted, get, setRoster: (next: typeof current) => { current = next } }
  }
  const button = (wrapper: { findAll: (s: string) => { text: () => string; trigger: (e: string) => Promise<void> }[] }, text: string) =>
    wrapper.findAll('button').find((b) => b.text() === text)!

  it('改統計日期：帶 as_of 重新讀取；按今天就不帶', async () => {
    const { wrapper, get } = await mountTab()
    const date = wrapper.get('input[type="date"]')
    await date.setValue('2026-09-15')
    await flushPromises()
    expect(pathsTo(get, ROOT).at(-1)).toContain('as_of=2026-09-15')
    await button(wrapper, '今天').trigger('click')
    await flushPromises()
    expect(pathsTo(get, ROOT).at(-1)).not.toContain('as_of')
  })

  it('統計日期不合規定時提示，畫面維持原狀', async () => {
    const { wrapper, setRoster } = await mountTab()
    vi.spyOn(ElMessage, 'error').mockReturnValue(undefined as never)
    vi.spyOn(api, 'get').mockRejectedValueOnce(new ApiError(422, { code: 'ROSTER_AS_OF_OUT_OF_RANGE', message: '統計日期要在這個學年開學（8/1）到今天之間' }))
    setRoster(data())
    const date = wrapper.get('input[type="date"]')
    await date.setValue('2026-09-15')
    await flushPromises()
    expect(wrapper.find('.roster-gap').exists()).toBe(true)
    expect(wrapper.find('table.roster-table').exists()).toBe(true)
  })

  it('存結算紀錄：成功後重讀；遇 409 確認後帶 overwrite 重送', async () => {
    const { wrapper } = await mountTab()
    const post = vi.spyOn(api, 'post')
      .mockRejectedValueOnce(new ApiError(409, { code: 'ROSTER_SNAPSHOT_EXISTS', message: '這一天已經有結算紀錄' }))
      .mockResolvedValueOnce({} as never)
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    await button(wrapper, '存成結算紀錄').trigger('click')
    await flushPromises()
    expect(post).toHaveBeenNthCalledWith(1, `${ROOT}/snapshots?campus_key=yihua`, { school_year: 115, as_of: '2026-11-15', overwrite: false })
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(post).toHaveBeenNthCalledWith(2, `${ROOT}/snapshots?campus_key=yihua`, { school_year: 115, as_of: '2026-11-15', overwrite: true })
  })

  it('覆蓋時按先不要：不重送', async () => {
    const { wrapper } = await mountTab()
    const post = vi.spyOn(api, 'post').mockRejectedValue(new ApiError(409, { code: 'ROSTER_SNAPSHOT_EXISTS' }))
    vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue('cancel' as never)
    await button(wrapper, '存成結算紀錄').trigger('click')
    await flushPromises()
    expect(post).toHaveBeenCalledTimes(1)
  })

  it('三段目標與下學年年級目標送到對的 API', async () => {
    const { wrapper } = await mountTab()
    const put = mockPut({ [ROOT]: {}, '/admin/admissions/intake-targets': {} })
    const currentTier = wrapper.findAll('input[aria-label^="115下"][aria-label$="目標"]')
    await currentTier[0]!.setValue('220')
    await flushPromises()
    expect(put).toHaveBeenLastCalledWith(`${ROOT}/tier-targets?campus_key=yihua`, { school_year: 115, semester: 2, base: 220, boost: null, top: null })
    const nextTier = wrapper.findAll('input[aria-label^="116上"][aria-label$="目標"]').filter((i) => !i.attributes('aria-label')!.includes('目標人數'))
    await nextTier[1]!.setValue('200')
    await flushPromises()
    expect(put).toHaveBeenLastCalledWith(`${ROOT}/tier-targets?campus_key=yihua`, { school_year: 116, semester: 1, base: null, boost: 200, top: null })
    await wrapper.get('input[aria-label="116上 小班目標人數"]').setValue('40')
    await flushPromises()
    expect(put).toHaveBeenLastCalledWith('/admin/admissions/intake-targets?campus_key=yihua', { school_year: 116, semester: 1, targets: { 小班: 40 } })
  })

  it('結算紀錄列表：結算日、各年級在籍、在籍合計、這學期預估、存檔時間', async () => {
    const r = data({
      classes: [klass({ students: [student()] })],
      snapshots: [{ id: 'n1', as_of: '2026-09-15', enrolled: { 大班: 60, 中班: 59, 小班: 40, 幼幼班: 45 }, total_enrolled: 204, estimate_total: 236, created_at: '2026-11-14T03:30:00Z' }],
    })
    const { wrapper } = await mountTab(r)
    const row = wrapper.get('.roster-snaps tbody tr')
    expect(row.findAll('td').map((td) => td.text())).toEqual(['115.09.15', '60', '59', '40', '45', '204', '236', '115.11.14 11:30'])
    cleanup()
    const empty = await mountTab(data())
    expect(empty.wrapper.get('.roster-snaps').text()).toContain('還沒有結算紀錄')
  })
})
