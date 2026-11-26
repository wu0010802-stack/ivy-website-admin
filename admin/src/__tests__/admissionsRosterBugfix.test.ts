import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, type VueWrapper } from '@vue/test-utils'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api, ApiError } from '../api/client'
import type { Roster } from '../api/roster'
import RosterTab from '../components/admissions/roster/RosterTab.vue'
import { cleanup, deferred, mockGet, mountWith, reception } from './admissionsTestKit'
import { klass, roster, student } from './rosterTestKit'

// 2026-11-26 修正的兩個編班問題：
// #71 補登預繳等對話框送出中沒有停用，連點兩下會建立兩批；
// #72 三段目標連續編輯時拿舊的伺服器值整列送出、重讀時整個缺額表重掛，正在打的那一格被清空、失焦。
afterEach(cleanup)

const ROOT = '/admin/admissions/roster'
const body = () => document.body
const field = (label: string) =>
  [...body().querySelectorAll('label')].find((l) => l.textContent!.trim().startsWith(label))?.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input, select, textarea') ?? null
const press = (text: string) => {
  const match = (b: HTMLElement) => b.textContent!.trim() === text
  return [...body().querySelectorAll<HTMLButtonElement>('.el-dialog button')].find(match) ?? [...body().querySelectorAll<HTMLButtonElement>('button')].find(match)
}
const overlayOf = (text: string) => [...body().querySelectorAll<HTMLElement>('.el-overlay')].find((o) => o.textContent!.includes(text))
async function set(el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null, value: string) {
  el!.value = value
  el!.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
  await flushPromises()
}
/** 使用者在輸入框打字、還沒離開（只有 input，沒有 change）。 */
function typeInto(el: HTMLInputElement, value: string) {
  el.focus()
  el.value = value
  el.dispatchEvent(new Event('input', { bubbles: true }))
}
const mountTab = () => mountWith(RosterTab, { props: { campusKey: 'yihua', schoolYear: 115 }, user: reception() })

describe('#71 對話框送出中不能再送一次', () => {
  function data() {
    return roster({ classes: [klass({ id: 'cA', students: [student({ id: 'a1', child_name: '甲' })] })] })
  }

  it('補登預繳：請求還沒回來時「補登」停用，連點兩下只建立一批', async () => {
    mockGet({ [ROOT]: () => data() })
    const { wrapper } = await mountTab()
    const reply = deferred<unknown>()
    const post = vi.spyOn(api, 'post').mockImplementation((() => reply.promise) as never)
    await wrapper.findAll('.roster-switch button')[1]!.trigger('click')
    ;[...wrapper.findAll('button')].find((b) => b.text() === '補登預繳')!.trigger('click')
    await flushPromises()
    await set(field('姓名'), '測試甲\n測試乙\n測試丙')
    await set(field('班別'), '小班')
    press('補登')!.click()
    press('補登')!.click()
    await flushPromises()
    press('補登')!.click()
    await flushPromises()
    expect(post).toHaveBeenCalledTimes(1)
    expect(press('補登')!.disabled).toBe(true)
    reply.resolve({ students: [], duplicates: [] })
    await flushPromises()
    expect(overlayOf('補登預繳')?.style.display ?? 'none').toBe('none')
    // 關掉再開：按鈕恢復可以按。
    ;[...wrapper.findAll('button')].find((b) => b.text() === '補登預繳')!.trigger('click')
    await flushPromises()
    expect(press('補登')!.disabled).toBe(false)
  })

  it('補登預繳失敗：按鈕恢復，可以改完再送', async () => {
    mockGet({ [ROOT]: () => data() })
    const { wrapper } = await mountTab()
    vi.spyOn(ElMessage, 'error').mockReturnValue(undefined as never)
    const post = vi.spyOn(api, 'post').mockRejectedValueOnce(new ApiError(422, { code: 'ROSTER_NAME_TOO_LONG', message: '第 2 行的姓名超過 50 個字', line: 2 }))
    await wrapper.findAll('.roster-switch button')[1]!.trigger('click')
    ;[...wrapper.findAll('button')].find((b) => b.text() === '補登預繳')!.trigger('click')
    await flushPromises()
    await set(field('姓名'), '測試甲\n測試乙')
    await set(field('班別'), '小班')
    press('補登')!.click()
    await flushPromises()
    expect(press('補登')!.disabled).toBe(false)
    post.mockResolvedValueOnce({ students: [], duplicates: [] } as never)
    press('補登')!.click()
    await flushPromises()
    expect(post).toHaveBeenCalledTimes(2)
  })

  it('新增班級：請求還沒回來時連點兩下只建立一班', async () => {
    mockGet({ [ROOT]: () => data() })
    const { wrapper } = await mountTab()
    const reply = deferred<unknown>()
    const post = vi.spyOn(api, 'post').mockImplementation((() => reply.promise) as never)
    ;[...wrapper.findAll('button')].find((b) => b.text() === '新增班級')!.trigger('click')
    await flushPromises()
    await set(field('班序'), '大9')
    await set(field('班級名稱'), '大九班')
    press('新增班級')!.click()
    press('新增班級')!.click()
    await flushPromises()
    expect(post).toHaveBeenCalledTimes(1)
    expect(press('新增班級')!.disabled).toBe(true)
    reply.resolve({})
    await flushPromises()
  })

  it('編輯資料：請求還沒回來時連點兩下只送一次（第二次不會變成版本衝突）', async () => {
    mockGet({ [ROOT]: () => data() })
    const { wrapper } = await mountTab()
    const reply = deferred<unknown>()
    const patch = vi.spyOn(api, 'patch').mockImplementation((() => reply.promise) as never)
    await wrapper.get('td.roster-note[data-index="0"]').trigger('click')
    await flushPromises()
    await set(field('備註'), '12或2')
    press('儲存')!.click()
    press('儲存')!.click()
    await flushPromises()
    expect(patch).toHaveBeenCalledTimes(1)
    expect(press('儲存')!.disabled).toBe(true)
    reply.resolve({})
    await flushPromises()
  })

  it('刪除班級：確認框開著時再點一次不會再開第二個、也不會刪兩次', async () => {
    mockGet({ [ROOT]: () => roster({ classes: [klass({ id: 'cE', students: [] })] }) })
    const { wrapper } = await mountTab()
    const answer = deferred<unknown>()
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockImplementation((() => answer.promise) as never)
    const del = vi.spyOn(api, 'delete').mockResolvedValue(undefined as never)
    await wrapper.get('th[data-class-id="cE"]').trigger('click')
    await flushPromises()
    press('刪除班級')!.click()
    press('刪除班級')!.click()
    await flushPromises()
    expect(confirm).toHaveBeenCalledTimes(1)
    answer.resolve('confirm')
    await flushPromises()
    expect(del).toHaveBeenCalledTimes(1)
  })
})

describe('#72 連續編輯缺額表與班級目標', () => {
  type Tiers = { base: number | null; boost: number | null; top: number | null }

  /**
   * 假伺服器：三段目標整列取代（照後端 save_tier_targets）、下學年年級目標逐年級寫入、班級目標寫進班級；
   * GET 回當下的狀態。holdPuts／holdGets 打開時請求先壓著，release 才回。
   */
  function fakeServer() {
    const tier: Record<'current' | 'next', Tiers> = { current: { base: null, boost: null, top: null }, next: { base: null, boost: null, top: null } }
    const nextTargets: Record<string, number | null> = { 大班: null, 中班: null, 小班: null, 幼幼班: null }
    const seats: Record<string, number | null> = { cA: null, cB: null }
    const versions: Record<string, number> = { cA: 1, cB: 1 }
    const snapshot = (): Roster => {
      const r = roster({
        classes: [
          klass({ id: 'cA', grade: '大班', name: '大一班', class_code: '大1', target_seats: seats.cA ?? null, version: versions.cA ?? 1, students: [student({ child_name: '甲' })] }),
          klass({ id: 'cB', grade: '中班', name: '中一班', class_code: '中1', target_seats: seats.cB ?? null, version: versions.cB ?? 1, students: [student({ child_name: '乙' })] }),
        ],
      })
      r.current.tier = { ...r.current.tier, ...tier.current }
      r.next.tier = { ...r.next.tier, ...tier.next }
      r.next.targets = { ...r.next.targets, ...nextTargets }
      return r
    }
    const flags = { holdPuts: false, holdGets: false }
    const heldPuts: Array<() => void> = []
    const heldGets: Array<() => void> = []
    const putBodies: Array<Record<string, unknown>> = []

    mockGet({
      [ROOT]: () => {
        if (!flags.holdGets) return snapshot()
        return new Promise((resolve) => heldGets.push(() => resolve(snapshot())))
      },
    })
    const apply = (path: string, payload: Record<string, unknown>) => {
      if (path.startsWith(`${ROOT}/tier-targets`)) {
        const block = payload.school_year === 115 ? 'current' : 'next'
        tier[block] = { base: payload.base as number | null, boost: payload.boost as number | null, top: payload.top as number | null }
      } else {
        Object.assign(nextTargets, payload.targets)
      }
    }
    vi.spyOn(api, 'put').mockImplementation((async (path: string, payload: Record<string, unknown>) => {
      putBodies.push(payload)
      if (!flags.holdPuts) return apply(path, payload)
      return new Promise((resolve) => heldPuts.push(() => resolve(apply(path, payload))))
    }) as never)
    vi.spyOn(api, 'patch').mockImplementation((async (path: string, payload: Record<string, unknown>) => {
      const id = path.split('/').at(-1)!
      seats[id] = payload.target_seats as number | null
      versions[id] = (versions[id] ?? 1) + 1
      return {}
    }) as never)

    /**
     * 放行壓著的請求，直到都回完（放行一個可能再送出下一個）。latestFirst：同時壓著好幾個 PUT 時先放後送的，
     * 模擬後端 advisory lock 不保證照送出順序處理。
     */
    async function drain({ latestFirst = false } = {}) {
      for (let round = 0; round < 20 && (heldPuts.length || heldGets.length); round += 1) {
        const puts = heldPuts.splice(0)
        ;(latestFirst ? puts.reverse() : puts).forEach((go) => go())
        await flushPromises()
        heldGets.splice(0).forEach((go) => go())
        await flushPromises()
      }
    }
    const releaseGets = async () => {
      heldGets.splice(0).forEach((go) => go())
      await flushPromises()
    }
    return { tier, nextTargets, seats, flags, putBodies, drain, releaseGets }
  }
  const input = (wrapper: VueWrapper, label: string) => wrapper.get(`input[aria-label="${label}"]`).element as HTMLInputElement

  it('前一欄還沒存好就改下一欄：送出的是同一列目前的三個值，前一欄不會被蓋回未設定', async () => {
    const server = fakeServer()
    const { wrapper } = await mountTab()
    server.flags.holdPuts = true
    await wrapper.get('input[aria-label="115下 基礎目標"]').setValue('100')
    await flushPromises()
    await wrapper.get('input[aria-label="115下 激勵目標"]').setValue('120')
    await flushPromises()
    // 同一區塊依序送：前一個 PUT 還沒回來，下一個先不送，後端才不會先寫新的、再被舊的整列蓋回去。
    expect(server.putBodies).toHaveLength(1)
    await server.drain({ latestFirst: true })
    expect(server.putBodies).toHaveLength(2)
    for (const sent of server.putBodies) expect(sent.base).toBe(100)
    expect(server.tier.current).toEqual({ base: 100, boost: 120, top: null })
    expect(input(wrapper, '115下 基礎目標').value).toBe('100')
    expect(input(wrapper, '115下 激勵目標').value).toBe('120')
  })

  it('排隊等前一筆時換了校：排著的那一筆仍寫回原本那校', async () => {
    const server = fakeServer()
    const { wrapper } = await mountTab()
    server.flags.holdPuts = true
    await wrapper.get('input[aria-label="115下 基礎目標"]').setValue('100')
    await flushPromises()
    await wrapper.get('input[aria-label="115下 激勵目標"]').setValue('120')
    await flushPromises()
    await wrapper.setProps({ campusKey: 'minghua' })
    await server.drain()
    const paths = vi.mocked(api.put).mock.calls.map((call) => String(call[0]))
    expect(paths).toHaveLength(2)
    for (const path of paths) expect(path).toContain('campus_key=yihua')
  })

  it('重讀先回來：正在輸入的下一欄留在原地、字還在、焦點沒跑掉，離開時連同前一欄一起送出', async () => {
    const server = fakeServer()
    const { wrapper } = await mountTab()
    server.flags.holdGets = true
    await wrapper.get('input[aria-label="115下 基礎目標"]').setValue('100')
    await flushPromises()
    const boost = input(wrapper, '115下 激勵目標')
    typeInto(boost, '12')
    await server.releaseGets()
    expect(body().contains(boost)).toBe(true)
    expect(input(wrapper, '115下 激勵目標')).toBe(boost)
    expect(boost.value).toBe('12')
    expect(document.activeElement).toBe(boost)
    expect(input(wrapper, '115下 基礎目標').value).toBe('100')
    boost.dispatchEvent(new Event('change', { bubbles: true }))
    await server.drain()
    expect(server.tier.current).toEqual({ base: 100, boost: 12, top: null })
  })

  it('下學年年級目標：存好一格、重讀回來時正在輸入的下一格不會被清空或失焦', async () => {
    const server = fakeServer()
    const { wrapper } = await mountTab()
    server.flags.holdGets = true
    await wrapper.get('input[aria-label="116上 大班目標人數"]').setValue('60')
    await flushPromises()
    const middle = input(wrapper, '116上 中班目標人數')
    typeInto(middle, '5')
    await server.releaseGets()
    expect(input(wrapper, '116上 中班目標人數')).toBe(middle)
    expect(middle.value).toBe('5')
    expect(document.activeElement).toBe(middle)
    expect(input(wrapper, '116上 大班目標人數').value).toBe('60')
  })

  it('班級目標：存好一班、重讀回來時正在輸入的另一班目標不會被清空', async () => {
    const server = fakeServer()
    const { wrapper } = await mountTab()
    server.flags.holdGets = true
    await wrapper.get('input[aria-label="大一班(大1)目標人數"]').setValue('30')
    await flushPromises()
    const other = input(wrapper, '中一班(中1)目標人數')
    typeInto(other, '2')
    await server.releaseGets()
    expect(server.seats.cA).toBe(30)
    expect(input(wrapper, '中一班(中1)目標人數')).toBe(other)
    expect(other.value).toBe('2')
    expect(document.activeElement).toBe(other)
    expect(input(wrapper, '大一班(大1)目標人數').value).toBe('30')
  })

  it('被後端擋下的值不留在輸入框：三段目標、下學年年級目標、班級目標都回到伺服器的值', async () => {
    fakeServer()
    const { wrapper } = await mountTab()
    vi.spyOn(ElMessage, 'error').mockReturnValue(undefined as never)
    vi.spyOn(api, 'put').mockRejectedValue(new ApiError(422, [{ msg: 'Value error, 三段目標要由低到高', loc: [], type: 'value_error' }]))
    vi.spyOn(api, 'patch').mockRejectedValue(new ApiError(422, { code: 'VALIDATION', message: '目標人數不合規定' }))
    await wrapper.get('input[aria-label="115下 基礎目標"]').setValue('300')
    await flushPromises()
    expect(input(wrapper, '115下 基礎目標').value).toBe('')
    await wrapper.get('input[aria-label="116上 小班目標人數"]').setValue('40')
    await flushPromises()
    expect(input(wrapper, '116上 小班目標人數').value).toBe('')
    await wrapper.get('input[aria-label="大一班(大1)目標人數"]').setValue('99')
    await flushPromises()
    expect(input(wrapper, '大一班(大1)目標人數').value).toBe('')
  })
})
