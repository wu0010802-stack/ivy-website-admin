// 家庭版面的處理區（docs/specs/2026-10-05-visit-family-page-design.md 5.6；Review Focus 3、5）。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { ElMessage } from 'element-plus'
import FamilyActions from '../components/visit/FamilyActions.vue'
import ContactLogDialog from '../components/admissions/ContactLogDialog.vue'
import FollowUpDialog from '../components/admissions/FollowUpDialog.vue'
import TransitionDialog from '../components/admissions/TransitionDialog.vue'
import { ApiError } from '../api/client'
import { STAGE_LABELS } from '../admissions/constants'
import { admissionsViewer, button, cleanup, hasButton, mockGet, mockPatch, mountWith, reception, visit } from './admissionsTestKit'

// 對話框打開時可能讀上次聯絡或名單：一律走 mock，不打真的 API。
beforeEach(() => { mockGet({}) })
afterEach(cleanup)

const staff = [{ id: 'desk', display_name: '櫃台小美', email: 'desk@example.invalid' }, { id: 'ca', display_name: null, email: 'ca@example.invalid' }]
const latest = {
  id: 'l1', recruitment_visit_id: 'v-1', contacted_at: '2026-10-08T08:20:00Z', channel: 'phone', reached: true, note: '下週回覆',
  next_follow_up_at: null, created_by: 'desk', created_by_name: '櫃台小美', created_at: '2026-10-08T08:21:00Z',
}
const mountActions = (record = visit(), user = undefined as never, last: unknown = latest) =>
  mountWith(FamilyActions, { props: { visit: record, staff, latest: last }, user })

async function menuItems() {
  document.body.querySelector<HTMLButtonElement>('.family-actions__move')!.click()
  await vi.waitFor(() => expect(document.body.querySelector('.family-move-menu .el-dropdown-menu__item')).not.toBeNull())
  return [...document.body.querySelectorAll<HTMLElement>('.family-move-menu .el-dropdown-menu__item')]
}

describe('摘要', () => {
  it('階段、下次聯絡（到期警示）、最近聯絡', async () => {
    const { wrapper } = await mountActions(visit({ follow_up_at: '2020-01-01T02:00:00Z', follow_up_owner_id: 'desk' }))
    const facts = wrapper.get('.family-actions__facts')
    expect(facts.text()).toContain('已訪視')
    expect(facts.get('.is-due').text()).toMatch(/^逾 \d+ 天$/)
    expect(facts.text()).toContain('10/08・電話・聯絡到了')
  })
  it('沒有參觀後聯絡寫「還沒聯絡過」；已註冊的下次聯絡寫破折號', async () => {
    const { wrapper } = await mountActions(visit({ stage: 'enrolled', enrolled: true }), undefined as never, null)
    expect(wrapper.get('.family-actions__facts').text()).toContain('還沒聯絡過')
    expect(wrapper.get('.family-actions__next').text()).toBe('—')
  })
})

describe('按鈕與權限', () => {
  it('能寫入：記錄聯絡帶齊聯絡人電話年級；儲存往上傳', async () => {
    const { wrapper } = await mountActions()
    await button(wrapper, '記錄聯絡')!.trigger('click')
    const dialog = wrapper.getComponent(ContactLogDialog)
    expect(dialog.props('target')).toMatchObject({ id: 'v-1', version: 1, child_name: '王小安', stage: 'visited', grade: '小班', contact_name: '王媽媽', phone: '0912345678' })
    dialog.vm.$emit('saved', visit({ version: 2 }), latest)
    expect(wrapper.emitted('changed')?.[0]?.[0]).toMatchObject({ version: 2 })
  })

  it('排下次聯絡／改期：沒排寫「排下次聯絡」，有排寫「改期／負責人」', async () => {
    const { wrapper } = await mountActions()
    await button(wrapper, '排下次聯絡')!.trigger('click')
    expect(wrapper.getComponent(FollowUpDialog).props()).toMatchObject({ modelValue: true, campusKey: 'yihua' })
    cleanup()
    const scheduled = await mountActions(visit({ follow_up_at: '2099-01-01T02:00:00Z' }))
    expect(hasButton(scheduled.wrapper, '改期／負責人')).toBe(true)
  })

  it('移到…：選項照轉換規則與權限；選了開確認框', async () => {
    const { wrapper } = await mountActions(visit({ stage: 'deposited', has_deposit: true }))
    const items = await menuItems()
    expect(items.map((item) => item.textContent?.trim())).toEqual(['visited', 'enrolled', 'withdrawn'].map((stage) => STAGE_LABELS[stage as 'visited']))
    items.find((item) => item.textContent?.trim() === STAGE_LABELS.enrolled)!.click()
    await flushPromises()
    expect(wrapper.getComponent(TransitionDialog).props('target')).toMatchObject({ from: 'deposited', to: 'enrolled', card: { id: 'v-1' } })
  })

  it('櫃台（沒有 admissions.convert）在已預繳看不到「已註冊」', async () => {
    await mountActions(visit({ stage: 'deposited', has_deposit: true }), reception() as never)
    const items = await menuItems()
    expect(items.map((item) => item.textContent?.trim())).toEqual([STAGE_LABELS.visited, STAGE_LABELS.withdrawn])
  })

  it('只能看招生：沒有任何按鈕，負責人是文字', async () => {
    const { wrapper } = await mountActions(visit({ follow_up_owner_id: 'desk' }), admissionsViewer() as never)
    for (const label of ['記錄聯絡', '排下次聯絡']) expect(hasButton(wrapper, label)).toBe(false)
    expect(wrapper.find('.family-actions__move').exists()).toBe(false)
    expect(wrapper.find('.family-actions__owner .el-select').exists()).toBe(false)
    expect(wrapper.get('.family-actions__owner').text()).toContain('櫃台小美')
  })

  it('已匿名化：唯讀（Review Focus 3）', async () => {
    const { wrapper } = await mountActions(visit({ anonymized_at: '2026-10-01T00:00:00Z', stage: 'deposited' }))
    expect(hasButton(wrapper, '記錄聯絡')).toBe(false)
    expect(wrapper.find('.family-actions__move').exists()).toBe(false)
    expect(wrapper.find('.family-actions__owner .el-select').exists()).toBe(false)
  })

  it('重新預約往上傳', async () => {
    const { wrapper } = await mountActions()
    await button(wrapper, '重新預約（另建新案）')!.trigger('click')
    expect(wrapper.emitted('rebook')).toHaveLength(1)
  })
})

describe('負責人', () => {
  it('改負責人送版本與新負責人，成功往上傳', async () => {
    const patch = mockPatch({ '/admin/admissions/records/v-1/follow-up': visit({ follow_up_owner_id: 'ca', version: 2 }) })
    const { wrapper } = await mountActions(visit({ follow_up_owner_id: 'desk' }))
    wrapper.findComponent({ name: 'ElSelect' }).vm.$emit('change', 'ca')
    await flushPromises()
    expect(patch).toHaveBeenCalledWith('/admin/admissions/records/v-1/follow-up', { expected_version: 1, follow_up_owner_id: 'ca' })
    expect(wrapper.emitted('changed')?.[0]?.[0]).toMatchObject({ follow_up_owner_id: 'ca' })
  })

  it('別人剛改過（409）：提示並要求重讀，不往上傳舊資料（Review Focus 5）', async () => {
    const warning = vi.spyOn(ElMessage, 'warning')
    mockPatch({ '/admin/admissions/records/v-1/follow-up': () => { throw new ApiError(409, { code: 'RECRUITMENT_VISIT_VERSION_CONFLICT' }) } })
    const { wrapper } = await mountActions(visit({ follow_up_owner_id: 'desk' }))
    wrapper.findComponent({ name: 'ElSelect' }).vm.$emit('change', 'ca')
    await flushPromises()
    expect(warning).toHaveBeenCalled()
    expect(wrapper.emitted('stale')).toHaveLength(1)
    expect(wrapper.emitted('changed')).toBeUndefined()
  })

  it('記錄聯絡對話框開著時重讀到新版本：交回新版本（內容保留）', async () => {
    const { wrapper } = await mountActions()
    await button(wrapper, '記錄聯絡')!.trigger('click')
    await wrapper.setProps({ visit: visit({ version: 5, stage: 'deposited' }) })
    expect(wrapper.getComponent(ContactLogDialog).props('target')).toMatchObject({ version: 5, stage: 'deposited' })
  })
})
