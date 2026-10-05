// 參觀後追蹤（docs/specs/2026-10-04-admissions-follow-up-design.md 第 7 節、第 12 節 F17）。
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import AdmissionsView from '../views/AdmissionsView.vue'
import DashboardView from '../views/DashboardView.vue'
import ContactLogDialog from '../components/admissions/ContactLogDialog.vue'
import EventsDrawer from '../components/admissions/EventsDrawer.vue'
import FollowUpsTab from '../components/admissions/FollowUpsTab.vue'
import FunnelCard from '../components/admissions/FunnelCard.vue'
import { api, ApiError } from '../api/client'
import { CONTACT_CHANNEL_LABELS } from '../api/labels'
import {
  daysLaterAtTen, FOLLOW_UP_SHORTCUTS, followUpText, lastContactText, ownerLabel, resolveNextFollowUp,
} from '../admissions/followUp'
import {
  admissionsViewer, bodyOf, button, card, cleanup, mockGet, mockPatch, mockPost, mountWith, pathsTo, queryOf, visit, VR_ID,
} from './admissionsTestKit'

afterEach(cleanup)

const BACKEND = resolve(__dirname, '../../../backend/app/admissions/constants.py')

describe('followUp 的時間與文字', () => {
  const now = new Date('2026-10-05T02:00:00Z') // 台北 10/05（週一）10:00

  it('下次聯絡：已過寫逾 N 天、今天寫時間、明天、之後寫日期與星期', () => {
    expect(followUpText('2026-10-02T02:00:00Z', now)).toBe('逾 3 天')
    expect(followUpText('2026-10-05T01:00:00Z', now)).toBe('今天 09:00')
    expect(followUpText('2026-10-05T07:00:00Z', now)).toBe('今天 15:00')
    expect(followUpText('2026-10-06T02:00:00Z', now)).toBe('明天 10:00')
    expect(followUpText('2026-10-08T02:00:00Z', now)).toBe('10/08（週四）10:00')
    expect(followUpText(null, now)).toBe('未排定')
  })

  it('快捷時間一律是台北日期的 10:00；下週一在週一按是七天後', () => {
    expect(daysLaterAtTen(1, now)).toBe('2026-10-06T02:00:00.000Z')
    const monday = FOLLOW_UP_SHORTCUTS.find((item) => item.key === 'next_monday')!
    expect(monday.at(now)).toBe('2026-10-12T02:00:00.000Z')
    // 台北週日深夜（UTC 週日下午）按：下週一是隔天。
    expect(monday.at(new Date('2026-10-11T15:00:00Z'))).toBe('2026-10-12T02:00:00.000Z')
  })

  it('選擇換成送 API 的值：沒選 undefined、不用再追 null、自選要有時間', () => {
    expect(resolveNextFollowUp('', null, now)).toBeUndefined()
    expect(resolveNextFollowUp('none', null, now)).toBeNull()
    expect(resolveNextFollowUp('custom', null, now)).toBeUndefined()
    expect(resolveNextFollowUp('custom', '2026-10-09T15:00:00+08:00', now)).toBe('2026-10-09T07:00:00.000Z')
    expect(resolveNextFollowUp('three_days', null, now)).toBe('2026-10-08T02:00:00.000Z')
  })

  it('最近聯絡與負責人的寫法', () => {
    expect(lastContactText(null)).toBe('還沒聯絡過')
    expect(lastContactText('2026-10-05T02:00:00Z', 'phone', false)).toBe('10/05・電話・沒聯絡到')
    const staff = [{ id: 'u1', display_name: '林老師', email: 'lin@example.invalid' }]
    expect(ownerLabel('u1', staff)).toBe('林老師')
    expect(ownerLabel(null, staff)).toBe('未指派')
    expect(ownerLabel('gone', staff, '王老師', false)).toBe('王老師（已停用）')
  })

  it('聯絡方式文案與後端 CONTACT_CHANNELS 逐字相同', () => {
    const source = readFileSync(BACKEND, 'utf8')
    const block = source.slice(source.indexOf('CONTACT_CHANNELS'), source.indexOf('}', source.indexOf('CONTACT_CHANNELS')))
    const backend = Object.fromEntries([...block.matchAll(/"([a-z_]+)": "([^"]+)"/g)].map((m) => [m[1], m[2]]))
    expect(CONTACT_CHANNEL_LABELS).toEqual(backend)
  })
})

const followRow = (changes: Record<string, unknown> = {}) => ({
  visit_id: 'v-1', child_name: '王小安', grade: '小班', stage: 'visited', visit_date: '2026-10-01', contact_name: '王媽媽',
  phone: '0912345678', follow_up_at: '2020-01-01T02:00:00Z', follow_up_owner_id: 'desk', follow_up_owner_name: 'desk@example.invalid',
  follow_up_owner_active: true, last_contacted_at: null, last_contact_channel: null, last_contact_reached: null,
  has_visit_request: true, version: 3, ...changes,
})
const followList = (rows: unknown[] = [followRow()], totals = { due: 1, upcoming: 2, unscheduled: 5 }, extra = {}) => ({
  as_of: '2026-10-05T02:00:00Z', campus_key: 'yihua', scope: 'due', totals, total: rows.length, page: 1, page_size: 50, rows, ...extra,
})
const staffList = [{ id: 'desk', display_name: null, email: 'desk@example.invalid' }]

async function mountTab(props: Record<string, unknown> = {}, user = undefined as never) {
  return mountWith(FollowUpsTab, { props: { campusKey: 'yihua', scope: 'due', owner: '', ...props }, user })
}

describe('待追蹤分頁（7.1）', () => {
  it('列出已到期：逾 N 天、電話連結、最近聯絡、負責人；回報已到期筆數', async () => {
    const get = mockGet({ '/admin/admissions/follow-ups': followList(), '/admin/admissions/staff': staffList })
    const { wrapper } = await mountTab()
    const text = wrapper.find('.follow-ups-table .el-table__body').text()
    for (const part of ['王小安', '已訪視', '王媽媽', '還沒聯絡過', 'desk@example.invalid']) expect(text).toContain(part)
    expect(wrapper.find('.follow-ups__when').text()).toMatch(/^逾 \d+ 天$/)
    expect(wrapper.find('a[href="tel:0912345678"]').exists()).toBe(true)
    expect(wrapper.emitted('count')).toEqual([[1]])
    const query = queryOf(pathsTo(get, '/admin/admissions/follow-ups')[0]!)
    expect(Object.fromEntries(query)).toEqual({ campus_key: 'yihua', scope: 'due', page: '1', page_size: '50' })
    expect(wrapper.text()).not.toContain('待追蹤不分入學學期')
    // 記錄聯絡是淺色鈕（列表一律 plain），操作欄單行不折。
    const record = wrapper.findAll('.follow-ups-table button').find((b) => b.text() === '記錄聯絡')!
    expect(record.classes()).toContain('is-plain')
    expect(wrapper.find('.follow-ups-table').text()).toContain('下次聯絡')
  })

  it('換範圍與負責人重讀；未排定另有說明、空狀態說明原因', async () => {
    const get = mockGet({ '/admin/admissions/follow-ups': followList([]), '/admin/admissions/staff': staffList })
    const { wrapper } = await mountTab()
    expect(wrapper.text()).toContain('沒有到期要聯絡的家長。')
    await wrapper.setProps({ scope: 'unscheduled', owner: 'me' })
    await flushPromises()
    const last = queryOf(pathsTo(get, '/admin/admissions/follow-ups').at(-1)!)
    expect([last.get('scope'), last.get('owner')]).toEqual(['unscheduled', 'me'])
    expect(wrapper.text()).toContain('不是每位都要聯絡，這裡不算待辦')
    // 未排定：每列的下次聯絡都一樣，整欄不列。
    expect(wrapper.find('.follow-ups-table .el-table__header').text()).not.toContain('下次聯絡')
  })

  it('沒有寫入權限只能看，不出現記錄聯絡', async () => {
    mockGet({ '/admin/admissions/follow-ups': followList(), '/admin/admissions/staff': staffList })
    const { wrapper } = await mountTab({}, admissionsViewer() as never)
    expect(button(wrapper, '記錄聯絡')).toBeUndefined()
    expect(button(wrapper, '歷程')).toBeDefined()
  })

  it('招生頁的分頁標籤顯示已到期筆數；網址記住範圍與負責人', async () => {
    mockGet({ '/admin/admissions/follow-ups': followList([followRow()], { due: 4, upcoming: 0, unscheduled: 0 }), '/admin/admissions/staff': staffList })
    const { wrapper, router } = await mountWith(AdmissionsView, { path: '/admissions?tab=followups&fu=unscheduled&owner=me' })
    expect(wrapper.get('.admissions__count--due').text()).toBe('4')
    expect(wrapper.findComponent(FollowUpsTab).props()).toMatchObject({ scope: 'unscheduled', owner: 'me' })
    expect(router.currentRoute.value.query).toMatchObject({ tab: 'followups', fu: 'unscheduled', owner: 'me' })
    await router.push('/admissions?tab=records&fu=unscheduled')
    await flushPromises()
    expect(router.currentRoute.value.query.fu).toBeUndefined()
  })
})

const target: Record<string, unknown> & { id: string; version: number; child_name: string; stage: string } = { id: 'v-1', version: 3, child_name: '王小安', stage: 'visited' }

async function openDialog(changes: Record<string, unknown> = {}) {
  const mounted = await mountWith(ContactLogDialog, { props: { modelValue: false, target: { ...target, ...changes } } })
  await mounted.wrapper.setProps({ modelValue: true })
  await flushPromises()
  return mounted
}

const dialogButton = (text: string) => [...document.body.querySelectorAll('button')].find((b) => b.textContent?.trim() === text) as HTMLButtonElement | undefined
const radio = (text: string) => [...document.body.querySelectorAll('.el-radio-button')].find((el) => el.textContent?.trim() === text) as HTMLElement | undefined

async function clickRadio(text: string) {
  radio(text)!.querySelector('input')!.click()
  await flushPromises()
}

describe('記錄聯絡對話框（7.2）', () => {
  it('選了結果、聯絡到要寫內容、決定下次聯絡才能送出；沒聯絡到預設明天 10:00', async () => {
    await openDialog()
    expect(dialogButton('記下來')!.disabled).toBe(true)
    await clickRadio('沒聯絡到')
    expect(radio('明天 10:00')!.classList.contains('is-active')).toBe(true)
    expect(dialogButton('記下來')!.disabled).toBe(false)
    await clickRadio('聯絡到了')
    // 聯絡到：下次聯絡不預選、內容必填。
    expect(document.body.querySelector('.el-radio-button.is-active')?.textContent).not.toContain('明天')
    expect(dialogButton('記下來')!.disabled).toBe(true)
  })

  it('送出帶齊欄位；寫進電訪回應只在聯絡到時送 true', async () => {
    const post = mockPost({ '/admin/admissions/records/v-1/contact-logs': { log: { id: 'l1' }, visit: visit({ version: 4 }) } })
    const { wrapper } = await openDialog()
    await clickRadio('聯絡到了')
    const textarea = document.body.querySelector('textarea')!
    textarea.value = '想先看學費'
    textarea.dispatchEvent(new Event('input'))
    await clickRadio('不用再追')
    dialogButton('記下來')!.click()
    await flushPromises()
    expect(bodyOf(post, '/admin/admissions/records/v-1/contact-logs')).toEqual({
      expected_version: 3, contacted_at: null, channel: 'phone', reached: true, note: '想先看學費',
      next_follow_up_at: null, update_parent_response: true,
    })
    expect(wrapper.emitted('saved')?.[0]?.[0]).toMatchObject({ version: 4 })
  })

  it('409 版本衝突：對話框不關、內容保留、請父層重讀', async () => {
    vi.spyOn(api, 'post').mockRejectedValue(
      new ApiError(409, { code: 'RECRUITMENT_VISIT_VERSION_CONFLICT', current_version: 4 }),
    )
    const { wrapper } = await openDialog()
    await clickRadio('沒聯絡到')
    dialogButton('記下來')!.click()
    await flushPromises()
    expect(wrapper.emitted('stale')).toHaveLength(1)
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    expect(document.body.textContent).toContain('你的紀錄還沒送出')
  })

  it('抬頭寫幼生、年級、家長與電話連結；沒傳的項目不顯示', async () => {
    await openDialog({ grade: '小班', contact_name: '王媽媽', phone: '0912345678' })
    const who = document.body.querySelector('.contact-log__who')!.textContent
    expect(who).toContain('幼生：王小安（小班）')
    expect(who).toContain('家長：王媽媽')
    expect(document.body.querySelector('a[href="tel:0912345678"]')).not.toBeNull()
    await cleanup()
    await openDialog()
    expect(document.body.querySelector('.contact-log__who')!.textContent).not.toContain('家長：')
    expect(document.body.querySelector('a[href^="tel:"]')).toBeNull()
  })

  it('抬頭下一行寫上次聯絡與內容；讀不到或沒有紀錄就不顯示', async () => {
    mockGet({
      '/admin/admissions/records/v-1/contact-logs': [
        { id: 'l0', contacted_at: '2026-09-20T02:00:00Z', channel: 'line', reached: false, note: '舊的', next_follow_up_at: null },
        { id: 'l1', contacted_at: '2026-09-23T02:00:00Z', channel: 'phone', reached: true, note: '想先看學費', next_follow_up_at: null },
      ],
    })
    await openDialog()
    const last = document.body.querySelector('.contact-log__last')!
    expect(last.textContent).toContain('上次：09/23 電話・聯絡到了')
    expect(last.querySelector('.contact-log__last-note')!.getAttribute('title')).toBe('想先看學費')
    await cleanup()
    mockGet({ '/admin/admissions/records/v-1/contact-logs': [] })
    await openDialog()
    expect(document.body.querySelector('.contact-log__last')).toBeNull()
    await cleanup()
    mockGet({ '/admin/admissions/records/v-1/contact-logs': () => { throw new Error('offline') } })
    await openDialog()
    expect(document.body.querySelector('.contact-log__last')).toBeNull()
  })

  it('記下來停用時，footer 寫還缺什麼', async () => {
    await openDialog()
    const missing = () => document.body.querySelector('.contact-log__missing')!.textContent
    expect(missing()).toBe('還不能記下：還沒選結果、選下次聯絡')
    await clickRadio('聯絡到了')
    expect(missing()).toBe('還不能記下：還沒填內容、選下次聯絡')
    await clickRadio('不用再追')
    expect(missing()).toBe('還不能記下：還沒填內容')
  })

  it('已註冊、已退出只能選不用再追', async () => {
    await openDialog({ stage: 'enrolled' })
    expect(radio('明天 10:00')!.classList.contains('is-disabled')).toBe(true)
    expect(radio('不用再追')!.classList.contains('is-active')).toBe(true)
    expect(document.body.textContent).toContain('已註冊或已退出的訪視不需要排下次聯絡')
  })
})

describe('歷程抽屜合併三種紀錄（7.3）', () => {
  const routes = (extra: Record<string, unknown> = {}) => ({
    '/admin/admissions/records/v-1/events': [
      { id: 'e1', event_type: 'created', from_stage: null, to_stage: 'visited', reason: null, metadata_json: { origin: 'visit_request' }, actor_user_id: null, created_at: '2026-10-01T03:00:00Z' },
    ],
    '/admin/admissions/records/v-1/contact-logs': [
      { id: 'l1', recruitment_visit_id: 'v-1', contacted_at: '2026-10-03T02:00:00Z', channel: 'line', reached: true, note: '想看英文課', next_follow_up_at: '2026-10-08T02:00:00Z', created_by: null, created_by_name: '林老師', created_at: '2026-10-03T02:00:00Z' },
    ],
    '/admin/admissions/records/v-1': visit({ visit_request_id: VR_ID, follow_up_at: '2026-10-08T02:00:00Z', follow_up_owner_id: 'desk' }),
    [`/admin/visit-requests/${VR_ID}/contact-notes`]: [
      { id: 'n1', note: '確認週六會來', created_at: '2026-09-28T02:00:00Z', created_by: null, created_by_email: null, created_by_display_name: '櫃台' },
    ],
    '/admin/admissions/staff': staffList,
    ...extra,
  })

  it('參觀前、建立訪視、參觀後聯絡依時間舊到新', async () => {
    mockGet(routes())
    const { wrapper } = await mountWith(EventsDrawer, { props: { modelValue: false, visitId: 'v-1', childName: '王小安' } })
    await wrapper.setProps({ modelValue: true })
    await flushPromises()
    const items = [...document.body.querySelectorAll('.events__item')].map((el) => el.className.match(/events__item--(\w+)/)?.[1])
    expect(items).toEqual(['before', 'event', 'contact'])
    expect(document.body.textContent).toContain('LINE・聯絡到了')
    expect(document.body.textContent).toContain('確認週六會來')
    expect(document.body.querySelector('.events__summary')?.textContent).toContain('desk@example.invalid')
  })

  it('沒有 booking.read 不讀參觀前紀錄', async () => {
    const get = mockGet(routes())
    const user = { ...admissionsViewer(), effective_capabilities: ['admissions.read'] }
    const { wrapper } = await mountWith(EventsDrawer, { props: { modelValue: false, visitId: 'v-1' }, user: user as never })
    await wrapper.setProps({ modelValue: true })
    await flushPromises()
    expect(pathsTo(get, '/admin/visit-requests/')).toEqual([])
    expect(document.body.querySelectorAll('.events__item--before')).toHaveLength(0)
  })
})

describe('看板卡片的下次聯絡（7.4）', () => {
  const mountCard = (changes: Record<string, unknown>) =>
    mountWith(FunnelCard, { props: { card: card(changes), stage: 'visited', draggable: true, targets: [] } })

  it('已到期寫該聯絡了；已排定寫日期；沒排不標', async () => {
    const due = (await mountCard({ follow_up_at: '2020-01-01T02:00:00Z' })).wrapper
    expect(due.get('.funnel-card__follow').text()).toBe('該聯絡了')
    expect(due.get('.funnel-card__follow').classes()).toContain('is-due')
    const later = (await mountCard({ follow_up_at: '2099-10-08T02:00:00Z' })).wrapper
    expect(later.get('.funnel-card__follow').text()).toBe('下次聯絡 10/08')
    const none = (await mountCard({ follow_up_at: null })).wrapper
    expect(none.find('.funnel-card__follow').exists()).toBe(false)
  })
})

describe('記錄聯絡後同步到看板與明細的版本（PATCH 改期）', () => {
  it('改期只送有變的欄位', async () => {
    const FollowUpDialog = (await import('../components/admissions/FollowUpDialog.vue')).default
    mockGet({ '/admin/admissions/staff': staffList })
    const patch = mockPatch({ '/admin/admissions/records/v-1/follow-up': visit({ follow_up_at: '2026-10-06T02:00:00Z' }) })
    const { wrapper } = await mountWith(FollowUpDialog, {
      props: { modelValue: false, campusKey: 'yihua', target: { ...target, follow_up_at: null, follow_up_owner_id: 'desk' } },
    })
    await wrapper.setProps({ modelValue: true })
    await flushPromises()
    expect(dialogButton('儲存')!.disabled).toBe(true)
    await clickRadio('明天 10:00')
    dialogButton('儲存')!.click()
    await flushPromises()
    const body = bodyOf(patch, '/admin/admissions/records/v-1/follow-up') as Record<string, unknown>
    expect(Object.keys(body).sort()).toEqual(['expected_version', 'follow_up_at'])
  })
})

describe('總覽的招生待追蹤（7.7）', () => {
  const summary = (changes = {}) => ({
    today_visits: 0, pending_follow_up: 0, pending_publish: 0, campuses_without_active_booking: [], failed_notifications: 0,
    new_requests: 0, awaiting_confirmation: 0, next_hold_expires_at: null, ...changes,
  })

  it('有到期才列進待辦，連到第一個有到期的校區；多校時寫各校筆數', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(
      summary({ admissions_follow_up_due: 3, admissions_follow_up_due_by_campus: { minghua: 1, yihua: 2 } }) as never,
    )
    const { wrapper } = await mountWith(DashboardView, { path: '/' })
    const task = wrapper.findAll('a.task').find((link) => link.text().includes('參觀後該聯絡的家長'))!
    expect(task.get('.task__number').text()).toBe('3')
    expect(task.attributes('href')).toBe('/admissions?tab=followups&campus=minghua')
    expect(task.text()).toContain('明華 1、義華 2')
  })

  it('沒有這兩個鍵（招生未啟用或沒有權限）就不顯示', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(summary() as never)
    const { wrapper } = await mountWith(DashboardView, { path: '/' })
    expect(wrapper.text()).not.toContain('參觀後該聯絡的家長')
  })
})
