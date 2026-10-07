import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import VisitDetailView from '../views/VisitDetailView.vue'
import { flushPromises } from '@vue/test-utils'
import { button, cleanup, mockGet, mockPost, visit as admissionsVisit } from './admissionsTestKit'
import { caseRoutes, mountRoutes, pastSlot, visitCase, VISIT_ID } from './visitCaseKit'
import { testUser } from './fixtures'

afterEach(() => { cleanup(); window.sessionStorage.clear() })

async function mountDetail(data: Record<string, unknown>, routes: Record<string, unknown> = {}, user?: never) {
  mockGet({ ...caseRoutes(data), ...routes })
  return (await mountRoutes(`/visit-requests/${VISIT_ID}`, { detail: VisitDetailView }, { user })).wrapper
}
const labels = (wrapper: Awaited<ReturnType<typeof mountDetail>>) => wrapper.findAll('.case-facts dt').map((dt) => dt.text())

describe('家長資料表（方向 C）', () => {
  it('官網送單：電話、孩子（姓名，生日）、Email、得知管道；電話與 Email 可點', async () => {
    const wrapper = await mountDetail(visitCase())
    expect(labels(wrapper)).toEqual(['電話', '孩子', 'Email', '得知管道'])
    expect(wrapper.get('.case-facts').text()).toContain('小安，2022/05/01')
    expect(wrapper.find('.case-facts a.detail__link[href="tel:0912000001"]').exists()).toBe(true)
    expect(wrapper.find('.case-facts a[href="mailto:p1@example.com"]').exists()).toBe(true)
    expect(wrapper.get('.case-facts .panel__head').text()).toContain('家長填寫的資料')
  })

  it('孩子一行：只有生日也列出來；姓名與生日都沒有才寫未填寫', async () => {
    const child = (wrapper: Awaited<ReturnType<typeof mountDetail>>) => wrapper.findAll('.case-facts dt').find((dt) => dt.text() === '孩子')!.element.nextElementSibling!.textContent!.trim()
    const onlyBirthdate = await mountDetail(visitCase({ child_name: null, child_birthdate: '2022-05-01' }))
    expect(child(onlyBirthdate)).toBe('2022/05/01')
    cleanup()
    const onlyName = await mountDetail(visitCase({ child_birthdate: null }))
    expect(child(onlyName)).toBe('小安')
    cleanup()
    const neither = await mountDetail(visitCase({ child_name: null, child_birthdate: null }))
    expect(child(neither)).toBe('未填寫')
  })

  it('舊資料才有的欄位有值才列', async () => {
    const wrapper = await mountDetail(visitCase({ party_size: 4, questions: '娃娃車到不到鼎金', preferred_time: 'weekday_morning' }))
    expect(labels(wrapper)).toEqual(expect.arrayContaining(['參觀人數', '方便接電話時段', '想了解的事']))
  })
})

describe('設定列（方向 C）', () => {
  it('依序是場次、家長管理連結、最底的取消預約', async () => {
    const wrapper = await mountDetail(visitCase())
    const settings = wrapper.get('.case-settings')
    expect(settings.get('.detail__actions > .reschedule--collapsed').text()).toBe('改到其他場次…')
    expect(settings.text()).toContain('家長管理連結')
    const children = settings.element.children
    expect(children[children.length - 1]!.classList.contains('detail__danger')).toBe(true)
    expect(button(settings, '取消預約')).toBeDefined()
  })

  it('收合時的說明接在連結後面（連結那一格只有連結）', async () => {
    const wrapper = await mountDetail(visitCase())
    const collapsed = wrapper.get('.case-settings .reschedule--collapsed').element
    expect(collapsed.nextElementSibling?.textContent).toBe('改好後原場次的名額會空出來。')
  })

  it('產生連結後的「複製連結」是淺色鈕：設定列裡沒有實心主色鈕', async () => {
    const wrapper = await mountDetail(visitCase())
    mockPost({ '/admin/visit-requests/case-a/access-link': { manage_url: 'https://www.ivy.example/visit/manage#token=abc', manage_url_fragment: '/visit/manage#token=abc', expires_at: '2026-10-09T00:00:00Z', replaced_previous: false } })
    await button(wrapper.get('.case-settings'), '產生連結')!.trigger('click')
    await flushPromises()
    const copy = button(wrapper.get('.case-settings'), '複製連結')!
    expect(copy.classes()).toContain('is-plain')
    expect(wrapper.findAll('.case-settings .el-button--primary:not(.is-plain):not(.is-link):not(.is-text)')).toHaveLength(0)
  })

  it('只能查看：看得到連結狀態，沒有改期、產生連結、取消', async () => {
    const viewer = testUser('readonly', { campus_keys: ['yihua'], effective_capabilities: ['booking.read'] })
    const wrapper = await mountDetail(visitCase(), {}, viewer as never)
    const settings = wrapper.get('.case-settings')
    expect(settings.text()).toContain('還沒有產生連結')
    expect(settings.find('.reschedule').exists()).toBe(false)
    expect(button(settings, '產生連結')).toBeUndefined()
    expect(settings.find('.detail__danger').exists()).toBe(false)
  })

  it('已取消、已到場沒有設定列', async () => {
    const wrapper = await mountDetail(visitCase({ status: 'cancelled', display_status: 'cancelled', cancelled_at: '2026-10-02T02:00:00Z' }))
    expect(wrapper.find('.case-settings').exists()).toBe(false)
  })
})

describe('明細版面（方向 C）', () => {
  it('兩欄：主欄是時間線，右欄是家長資料與設定列；家庭版面右欄先放處理區、主欄先放招生資料', async () => {
    const plain = await mountDetail(visitCase())
    expect(plain.get('.detail__main').find('.case-timeline').exists()).toBe(true)
    expect(plain.get('.detail__side').find('.case-facts').exists()).toBe(true)
    expect(plain.get('.detail__side').find('.case-settings').exists()).toBe(true)
    cleanup()
    const linked = admissionsVisit({ visit_request_id: VISIT_ID, has_visit_request: true })
    const family = await mountDetail(
      visitCase({ status: 'completed', slot: pastSlot, slot_id: pastSlot.id, display_status: 'past' }),
      { '/admin/admissions/records': [linked], '/admin/admissions/records/v-1': [] },
    )
    expect(family.get('.detail__side').element.firstElementChild!.classList.contains('detail__family-actions')).toBe(true)
    expect(family.get('.detail__main').element.firstElementChild!.classList.contains('family-data')).toBe(true)
    expect(family.get('.case-facts').text()).toContain('展開')
  })

  it('1100px 以下一欄，順序：處理區 → 招生資料 → 時間線 → 家長資料 → 設定列', () => {
    const source = readFileSync(join(__dirname, '..', 'views/VisitDetailView.vue'), 'utf8')
    const narrow = source.slice(source.indexOf('@media (max-width: 1100px)'))
    expect(narrow).toMatch(/\.detail__main,\s*\.detail__side\s*{\s*display: contents;/)
    const order = (cls: string) => Number(new RegExp(`\\.${cls} {\\s*order: (\\d+);`).exec(narrow)?.[1])
    expect([order('detail__family-actions'), order('detail__family-data'), order('detail__notes'), order('case-facts'), order('case-settings')]).toEqual([1, 2, 3, 4, 5])
  })
})
