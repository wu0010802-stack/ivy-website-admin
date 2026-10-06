// 2026-09-28 業主裁定：後台帳號加「顯示名稱」（最多 12 字）。凡是畫面上寫「誰」的地方
// 都走 labels.staffLabel：有名稱用名稱，沒有用 Email @ 前面那段，完整 Email 只放在
// title。使用者頁與「我的帳號」可以設定名稱，操作紀錄多一欄「操作者」。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { computed, defineComponent, h } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter, matchedRouteKey } from 'vue-router'
import ElementPlus, { ElMessage } from 'element-plus'
import UsersView from '../views/UsersView.vue'
import AccountView from '../views/AccountView.vue'
import AuditView from '../views/AuditView.vue'
import VisitDetailView from '../views/VisitDetailView.vue'
import PublishHistoryView from '../views/PublishHistoryView.vue'
import AdminSidebar from '../components/AdminSidebar.vue'
import { api, ApiError } from '../api/client'
import {
  auditActionLabel,
  auditMetadataSummary,
  displayNameError,
  displayNameLength,
  staffEmail,
  staffEmailById,
  staffLabel,
  staffLabelById,
  staffOf,
  staffWithEmail,
} from '../api/labels'
import { visitEventActor } from '../api/visitHistory'
import type { UserOut, VisitHistoryOut } from '../api/types'
import { resetVisitStaff, useVisitStaff } from '../composables/useVisitStaff'
import { useAuthStore } from '../stores/auth'
import { testUser } from './fixtures'

const wrappers: VueWrapper[] = []
afterEach(() => {
  wrappers.forEach((wrapper) => wrapper.unmount())
  wrappers.length = 0
  vi.restoreAllMocks()
  resetVisitStaff()
  document.body.innerHTML = ''
})

const TWELVE = '一二三四五六七八九十甲乙'
const THIRTEEN = `${TWELVE}丙`

describe('staffLabel：同事在畫面上的名字', () => {
  it('有顯示名稱用名稱；沒有（或只有空白）用 Email @ 前面那段；兩個都沒有用 fallback', () => {
    expect(staffLabel({ display_name: '王小美', email: 'amy@ivy.example' })).toBe('王小美')
    expect(staffLabel({ display_name: '  王小美 ', email: 'amy@ivy.example' })).toBe('王小美')
    expect(staffLabel({ display_name: '   ', email: 'amy@ivy.example' })).toBe('amy')
    expect(staffLabel({ display_name: null, email: 'amy@ivy.example' })).toBe('amy')
    expect(staffLabel({ email: 'amy@ivy.example' })).toBe('amy')
    expect(staffLabel({ display_name: null, email: null })).toBe('已移除的帳號')
    expect(staffLabel(null, '系統')).toBe('系統')
    expect(staffLabel(undefined)).toBe('已移除的帳號')
  })

  it('完整 Email 只給 title；確認框要寫「名稱（Email）」', () => {
    expect(staffEmail({ display_name: '王小美', email: 'amy@ivy.example' })).toBe('amy@ivy.example')
    expect(staffEmail({ display_name: '王小美' })).toBe('')
    expect(staffEmail(null)).toBe('')
    expect(staffWithEmail({ display_name: '王小美', email: 'amy@ivy.example' })).toBe('王小美（amy@ivy.example）')
    expect(staffWithEmail({ display_name: null, email: 'amy@ivy.example' })).toBe('amy@ivy.example')
    expect(staffWithEmail(null)).toBe('')
  })

  it('API 的 <欄位>_display_name／<欄位>_email 用 staffOf 取；只存 id 的從同事名單找', () => {
    expect(staffLabel(staffOf({ created_by_display_name: '王小美', created_by_email: 'amy@ivy.example' }, 'created_by'))).toBe('王小美')
    // 舊版 API 沒有 *_display_name 欄位時照舊用 Email 前綴。
    expect(staffLabel(staffOf({ actor_email: 'desk@ivy.example' }, 'actor'))).toBe('desk')
    const staff = [
      { id: 'u1', email: 'amy@ivy.example', display_name: '王小美' },
      { id: 'u2', email: 'amy@other.example', display_name: null },
    ]
    expect(staffLabelById('u1', staff)).toBe('王小美')
    expect(staffLabelById('u2', staff)).toBe('amy')
    expect(staffEmailById('u2', staff)).toBe('amy@other.example')
    expect(staffLabelById(null, staff)).toBe('未指派')
    expect(staffEmailById(null, staff)).toBe('')
    expect(staffLabelById('gone', staff)).toBe('已移除的帳號')
    expect(staffEmailById('gone', staff)).toBe('')
  })

  it('案件歷程的園方人員寫名字', () => {
    const event = {
      id: 'e1', event_type: 'contacting', source: 'staff', actor_user_id: 'u1', actor_email: 'desk@ivy.example', actor_display_name: '櫃台阿芬',
      before: null, after: null, reason: null, created_at: '2026-09-28T01:00:00Z',
    } as VisitHistoryOut
    expect(visitEventActor(event)).toBe('櫃台阿芬')
    expect(visitEventActor({ ...event, actor_display_name: null })).toBe('desk')
    expect(visitEventActor({ ...event, actor_display_name: null, actor_email: null })).toBe('已移除的帳號')
  })
})

describe('顯示名稱的檢查和後端 normalize_display_name 相同', () => {
  it('前後空白不算、留空不算錯、最多 12 個字', () => {
    expect(displayNameError('')).toBe('')
    expect(displayNameError('   ')).toBe('')
    expect(displayNameError(TWELVE)).toBe('')
    // 全形空白（U+3000）也算前後空白。
    expect(displayNameError(`  ${TWELVE}\u3000`)).toBe('')
    expect(displayNameError(THIRTEEN)).toBe('顯示名稱最多 12 個字')
    expect(displayNameLength(`  ${TWELVE}  `)).toBe(12)
  })

  it('逐字算（不是 UTF-16 長度）；表情符號組合照後端一樣可以用', () => {
    expect(displayNameLength('😀')).toBe(1)
    expect(displayNameError('😀'.repeat(12))).toBe('')
    expect(displayNameError('😀'.repeat(13))).toBe('顯示名稱最多 12 個字')
    expect(displayNameError('小美👩\u200d👧')).toBe('')
  })

  it('換行、tab、零寬空白、雙向覆寫這類看不見的字元不收', () => {
    for (const bad of ['王\n小美', '王\t小美', '\u200b王小美', '王\u202e小美', '王\u2028小美', '王\ufeff小美']) {
      expect(displayNameError(bad), JSON.stringify(bad)).toBe('顯示名稱不能有換行或看不見的特殊字元')
    }
  })

  it('操作紀錄：改名的紀錄翻成中文，不印 display_name、self 這類鍵名', () => {
    expect(auditActionLabel('user.update_display_name')).toBe('變更顯示名稱')
    expect(auditMetadataSummary({ changed: ['display_name'], self: true }, 'user.update_display_name')).toBe('修改：顯示名稱，本人自己修改')
    expect(auditMetadataSummary({ changed: ['display_name'], self: false }, 'user.update_display_name')).toBe('修改：顯示名稱，由總管理者修改')
  })
})

// ---------------------------------------------------------------- 使用者頁
async function mountUsers(list: UserOut[]) {
  vi.spyOn(api, 'get').mockResolvedValue(list as never)
  const pinia = createPinia()
  useAuthStore(pinia).user = testUser('super_admin', { id: 'local-test', email: 'test@example.invalid' })
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: defineComponent({ template: '<div />' }) }] })
  await router.push('/users')
  await router.isReady()
  const wrapper = mount(UsersView, { global: { plugins: [pinia, router, ElementPlus], provide: { [matchedRouteKey as symbol]: computed(() => router.currentRoute.value.matched[0]) } } })
  wrappers.push(wrapper)
  await flushPromises()
  return wrapper
}
const buttonIn = (wrapper: VueWrapper, text: string) => wrapper.findAll('button').find((b) => b.text() === text)!
const openDialog = (wrapper: VueWrapper) => wrapper.findAllComponents({ name: 'ElDialog' }).find((dialog) => dialog.props('modelValue'))!

const named = testUser('campus_admin', { id: 'u2', email: 'amy@ivy.example', display_name: '王小美', campus_keys: ['yihua'] })
const unnamed = testUser('reception', { id: 'u3', email: 'desk@ivy.example', display_name: null, campus_keys: ['yihua'] })

describe('使用者頁：名稱欄與新增／修改', () => {
  it('名稱在上、Email 小字在下；沒設定的用灰字 Email 前綴，並說明怎麼補', async () => {
    const wrapper = await mountUsers([named, unnamed])
    const rows = wrapper.findAll('.data-table .el-table__body tr')
    const amy = rows.find((row) => row.text().includes('amy@ivy.example'))!
    expect(amy.get('[data-test="user-name"]').text()).toBe('王小美')
    expect(amy.get('.user-email').text()).toBe('amy@ivy.example')
    const desk = rows.find((row) => row.text().includes('desk@ivy.example'))!
    const fallback = desk.get('[data-test="user-name-fallback"]')
    expect(fallback.text()).toBe('desk')
    expect(fallback.classes()).toContain('muted')
    expect(wrapper.get('[data-test="unnamed-hint"]').text()).toContain('有 1 位還沒設定顯示名稱')
    // 手機清單一樣先寫名稱，再列 Email。
    const cards = wrapper.findAll('.mobile-records .mobile-record')
    expect(cards.map((card) => card.get('.record-heading strong').text())).toEqual(expect.arrayContaining(['王小美', 'desk']))
    expect(wrapper.get('.mobile-records').text()).toContain('amy@ivy.example')
  })

  it('搜尋也找得到顯示名稱', async () => {
    const wrapper = await mountUsers([named, unnamed])
    await wrapper.findAll('.filter-bar input')[0]!.setValue('小美')
    expect(wrapper.findAll('.data-table .el-table__body tr')).toHaveLength(1)
  })

  it('新增帳號：名稱前後空白不送、邊打邊算字數；超過 12 字寫原因且不送出', async () => {
    const wrapper = await mountUsers([])
    const post = vi.spyOn(api, 'post').mockResolvedValue(testUser('editor', { id: 'n1', email: 'new@ivy.example', display_name: '王小美', campus_keys: ['yihua'] }) as never)
    await buttonIn(wrapper, '新增使用者').trigger('click')
    await flushPromises()
    const dialog = openDialog(wrapper)
    expect(dialog.text()).toContain('顯示名稱（選填，最多 12 字）')
    await wrapper.get('#new-user-email').setValue('new@ivy.example')
    await buttonIn(wrapper, '產生密碼').trigger('click')
    await wrapper.findAllComponents({ name: 'ElCheckbox' }).find((box) => box.text() === '義華')!.find('input').setValue(true)

    await wrapper.get('#new-user-display-name').setValue(THIRTEEN)
    expect(wrapper.get('[data-test="display-name-count"]').text()).toBe('目前 13／12 字')
    expect(wrapper.get('[data-test="display-name-error"]').text()).toBe('顯示名稱最多 12 個字')
    expect(wrapper.get('#new-user-display-name').attributes('aria-invalid')).toBe('true')
    await buttonIn(wrapper, '建立帳號').trigger('click')
    await flushPromises()
    expect(post).not.toHaveBeenCalled()

    await wrapper.get('#new-user-display-name').setValue('  王小美  ')
    expect(wrapper.get('[data-test="display-name-count"]').text()).toBe('目前 3／12 字')
    expect(wrapper.find('[data-test="display-name-error"]').exists()).toBe(false)
    await buttonIn(wrapper, '建立帳號').trigger('click')
    await flushPromises()
    expect(post).toHaveBeenCalledWith('/admin/users', expect.objectContaining({ email: 'new@ivy.example', display_name: '王小美' }))
    expect(wrapper.get('[data-test="created-password"]').text()).toContain('已建立 王小美（new@ivy.example）')
  })

  it('新增帳號：名稱留空送 null（畫面改用 Email）', async () => {
    const wrapper = await mountUsers([])
    const post = vi.spyOn(api, 'post').mockResolvedValue(testUser('editor', { id: 'n1', email: 'new@ivy.example', campus_keys: ['yihua'] }) as never)
    await buttonIn(wrapper, '新增使用者').trigger('click')
    await flushPromises()
    await wrapper.get('#new-user-email').setValue('new@ivy.example')
    await wrapper.get('#new-user-display-name').setValue('   ')
    await buttonIn(wrapper, '產生密碼').trigger('click')
    await wrapper.findAllComponents({ name: 'ElCheckbox' }).find((box) => box.text() === '義華')!.find('input').setValue(true)
    await buttonIn(wrapper, '建立帳號').trigger('click')
    await flushPromises()
    expect(post).toHaveBeenCalledWith('/admin/users', expect.objectContaining({ display_name: null }))
  })

  it('「角色與校區」可以替同事改名稱：有改才送 PATCH …/display-name，而且先送；只改名稱不送角色', async () => {
    const wrapper = await mountUsers([named])
    // 後端每次都回存好之後的整筆帳號（名稱改過之後，改角色的回應也帶新名稱）。
    let current: UserOut = { ...named }
    const patch = vi.spyOn(api, 'patch').mockImplementation(async (_path, body) => (current = { ...current, ...(body as object) }) as never)
    await buttonIn(wrapper, '角色與校區').trigger('click')
    await flushPromises()
    expect(openDialog(wrapper).props('title')).toBe('王小美（amy@ivy.example） 的名稱、角色與校區')
    const input = wrapper.get('#scope-user-display-name')
    expect((input.element as HTMLInputElement).value).toBe('王小美')

    // 沒改名稱：只送角色，不留改名紀錄。
    await buttonIn(wrapper, '儲存').trigger('click')
    await flushPromises()
    expect(patch.mock.calls.map(([path]) => path)).toEqual(['/admin/users/u2/role'])

    // 只改名稱：不送角色（後端每收到一次角色就記一筆「變更角色與校區」）。
    patch.mockClear()
    const success = vi.spyOn(ElMessage, 'success')
    await buttonIn(wrapper, '角色與校區').trigger('click')
    await flushPromises()
    await wrapper.get('#scope-user-display-name').setValue(' 小美老師 ')
    await buttonIn(wrapper, '儲存').trigger('click')
    await flushPromises()
    expect(patch.mock.calls).toEqual([['/admin/users/u2/display-name', { display_name: '小美老師' }]])
    expect(success).toHaveBeenLastCalledWith('已更新顯示名稱')
    expect(wrapper.get('.data-table [data-test="user-name"]').text()).toBe('小美老師')

    // 名稱和角色一起改：名稱先送，再送角色。
    patch.mockClear()
    await buttonIn(wrapper, '角色與校區').trigger('click')
    await flushPromises()
    await wrapper.get('#scope-user-display-name').setValue('小美')
    await wrapper.findAllComponents({ name: 'ElRadio' }).find((radio) => radio.text() === '櫃台')!.find('input').setValue(true)
    await buttonIn(wrapper, '儲存').trigger('click')
    await flushPromises()
    expect(patch.mock.calls.map(([path]) => path)).toEqual(['/admin/users/u2/display-name', '/admin/users/u2/role'])
    expect(success).toHaveBeenLastCalledWith('已更新顯示名稱、角色、校區與權限')
    expect(wrapper.get('.data-table [data-test="user-name"]').text()).toBe('小美')
  })

  it('清空名稱送 null；超過 12 字不送出', async () => {
    const wrapper = await mountUsers([named])
    // 後端每次都回存好之後的整筆帳號（名稱改過之後，改角色的回應也帶新名稱）。
    let current: UserOut = { ...named }
    const patch = vi.spyOn(api, 'patch').mockImplementation(async (_path, body) => (current = { ...current, ...(body as object) }) as never)
    await buttonIn(wrapper, '角色與校區').trigger('click')
    await flushPromises()
    await wrapper.get('#scope-user-display-name').setValue(THIRTEEN)
    await buttonIn(wrapper, '儲存').trigger('click')
    await flushPromises()
    expect(patch).not.toHaveBeenCalled()
    expect(openDialog(wrapper).get('[data-test="display-name-error"]').text()).toBe('顯示名稱最多 12 個字')

    await wrapper.get('#scope-user-display-name').setValue('')
    await buttonIn(wrapper, '儲存').trigger('click')
    await flushPromises()
    expect(patch.mock.calls[0]).toEqual(['/admin/users/u2/display-name', { display_name: null }])
  })

  it('後端說名稱不行時寫在名稱欄下方，不改角色', async () => {
    const wrapper = await mountUsers([named])
    const patch = vi.spyOn(api, 'patch').mockRejectedValue(new ApiError(422, [{ loc: ['body', 'display_name'], msg: 'Value error, 顯示名稱不能有換行或看不見的特殊字元', type: 'value_error' }]))
    const error = vi.spyOn(ElMessage, 'error')
    await buttonIn(wrapper, '角色與校區').trigger('click')
    await flushPromises()
    await wrapper.get('#scope-user-display-name').setValue('小美老師')
    await buttonIn(wrapper, '儲存').trigger('click')
    await flushPromises()
    expect(patch).toHaveBeenCalledOnce()
    expect(openDialog(wrapper).get('[data-test="display-name-error"]').text()).toBe('顯示名稱不能有換行或看不見的特殊字元')
    expect(error).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------- 我的帳號與側欄
async function mountAccount(signedIn: UserOut) {
  vi.spyOn(api, 'get').mockResolvedValue({ google: false, line: false } as never)
  const pinia = createPinia()
  const auth = useAuthStore(pinia)
  auth.user = signedIn
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:rest(.*)*', component: { render: () => h('div') } }] })
  await router.push('/account')
  await router.isReady()
  const wrapper = mount(AccountView, { global: { plugins: [pinia, router, ElementPlus] } })
  wrappers.push(wrapper)
  await flushPromises()
  return { wrapper, auth }
}

describe('我的帳號：自己設定顯示名稱', () => {
  const me = testUser('reception', { id: 'me', email: 'desk@ivy.example', display_name: null, campus_keys: ['yihua'] })

  it('PATCH /auth/me 送去掉前後空白的名稱，成功後更新登入資料並跳提示', async () => {
    const { wrapper, auth } = await mountAccount(me)
    const save = wrapper.get('[data-test="save-display-name"]')
    expect(save.attributes('disabled')).toBeDefined()
    const patch = vi.spyOn(api, 'patch').mockResolvedValue({ ...me, display_name: '櫃台阿芬' } as never)
    const success = vi.spyOn(ElMessage, 'success')
    await wrapper.get('#account-display-name').setValue(' 櫃台阿芬 ')
    expect(wrapper.get('[data-test="display-name-count"]').text()).toBe('目前 4／12 字')
    expect(save.attributes('disabled')).toBeUndefined()
    await save.trigger('click')
    await flushPromises()
    expect(patch).toHaveBeenCalledWith('/auth/me', { display_name: '櫃台阿芬' })
    expect(auth.user?.display_name).toBe('櫃台阿芬')
    expect(success).toHaveBeenCalledWith('已更新顯示名稱，同事會看到「櫃台阿芬」')
    expect(wrapper.get('[data-test="save-display-name"]').attributes('disabled')).toBeDefined()
  })

  it('清空就送 null，改回用 Email 前綴', async () => {
    const { wrapper } = await mountAccount({ ...me, display_name: '櫃台阿芬' })
    const patch = vi.spyOn(api, 'patch').mockResolvedValue({ ...me, display_name: null } as never)
    const success = vi.spyOn(ElMessage, 'success')
    await wrapper.get('#account-display-name').setValue('')
    await wrapper.get('[data-test="save-display-name"]').trigger('click')
    await flushPromises()
    expect(patch).toHaveBeenCalledWith('/auth/me', { display_name: null })
    expect(success).toHaveBeenCalledWith('已清除顯示名稱，同事會看到「desk」')
  })

  it('超過 12 字不送出；改名後已讀好的同事名單跟著換', async () => {
    const { wrapper } = await mountAccount(me)
    const patch = vi.spyOn(api, 'patch')
    await wrapper.get('#account-display-name').setValue(THIRTEEN)
    await wrapper.get('[data-test="save-display-name"]').trigger('click')
    await flushPromises()
    expect(patch).not.toHaveBeenCalled()
    expect(wrapper.get('[data-test="display-name-error"]').text()).toBe('顯示名稱最多 12 個字')

    const { staff } = useVisitStaff()
    staff.value = [{ id: 'me', email: 'desk@ivy.example', display_name: null, role: 'reception', is_active: true, campus_keys: ['yihua'] }]
    patch.mockResolvedValue({ ...me, display_name: '阿芬' } as never)
    await wrapper.get('#account-display-name').setValue('阿芬')
    await wrapper.get('[data-test="save-display-name"]').trigger('click')
    await flushPromises()
    expect(staffLabelById('me', staff.value)).toBe('阿芬')
  })
})

describe('側欄帳號區寫名字', () => {
  async function sidebar(signedIn: UserOut) {
    vi.spyOn(api, 'get').mockResolvedValue([] as never)
    const pinia = createPinia()
    useAuthStore(pinia).user = signedIn
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:rest(.*)*', component: { render: () => h('div') } }] })
    await router.push('/media')
    await router.isReady()
    const wrapper = mount(AdminSidebar, { global: { plugins: [pinia, router, ElementPlus] } })
    wrappers.push(wrapper)
    return wrapper
  }

  it('有名稱寫名稱，沒有寫 Email 前綴；校區照舊，完整 Email 在 title', async () => {
    const withName = await sidebar(testUser('reception', { email: 'desk@ivy.example', display_name: '櫃台阿芬', campus_keys: ['yihua'] }))
    expect(withName.get('.sidebar__user-text strong').text()).toBe('櫃台阿芬')
    expect(withName.get('.sidebar__user-text span').text()).toBe('櫃台・義華')
    expect(withName.get('.sidebar__avatar').text()).toBe('櫃')
    expect(withName.get('a.sidebar__account').attributes('title')).toBe('desk@ivy.example（櫃台・義華）')
    expect(withName.get('a.sidebar__account').attributes('aria-label')).toBe('我的帳號：櫃台阿芬（desk@ivy.example）')

    const withoutName = await sidebar(testUser('reception', { email: 'desk@ivy.example', display_name: null, campus_keys: ['yihua'] }))
    expect(withoutName.get('.sidebar__user-text strong').text()).toBe('desk')
    expect(withoutName.get('.sidebar__avatar').text()).toBe('D')
  })
})

// ---------------------------------------------------------------- 操作紀錄
async function mountAudit(entries: unknown[]) {
  vi.spyOn(api, 'get').mockResolvedValue(entries as never)
  const pinia = createPinia()
  useAuthStore(pinia).user = testUser('super_admin', { id: 'me' })
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: defineComponent({ template: '<div />' }) }] })
  await router.push('/audit')
  await router.isReady()
  const wrapper = mount(AuditView, { global: { plugins: [pinia, router, ElementPlus], provide: { [matchedRouteKey as symbol]: computed(() => router.currentRoute.value.matched[0]) } } })
  wrappers.push(wrapper)
  await flushPromises()
  return wrapper
}

const auditEntry = (extra: Record<string, unknown>) => ({
  id: String(Math.random()), actor_user_id: 'u1', actor_email: 'amy@ivy.example', actor_display_name: '王小美',
  action: 'visit_request.no_show', target_type: 'visit_request', target_id: 'v1', target_label: null, campus_key: 'yihua',
  metadata: {}, created_at: '2026-09-28T06:30:00Z', ...extra,
})

describe('操作紀錄的「操作者」', () => {
  it('桌機多一欄操作者：寫名字、完整 Email 在 title；沒名字用 Email 前綴；系統動作寫「系統」', async () => {
    const wrapper = await mountAudit([
      auditEntry({ id: 'a1' }),
      auditEntry({ id: 'a2', actor_display_name: null, actor_email: 'desk@ivy.example', created_at: '2026-09-28T06:00:00Z' }),
      auditEntry({ id: 'a3', actor_user_id: null, actor_email: null, actor_display_name: null, action: 'content.publish_scheduled', target_type: 'content_item', campus_key: null, created_at: '2026-09-28T05:00:00Z' }),
      auditEntry({ id: 'a4', actor_email: null, actor_display_name: null, created_at: '2026-09-28T04:00:00Z' }),
    ])
    const headers = wrapper.findAll('.data-table .el-table__header th').map((th) => th.text())
    expect(headers.slice(0, 3)).toEqual(['時間', '操作者', '操作'])
    const actors = wrapper.findAll('.data-table [data-test="audit-actor"]')
    expect(actors.map((a) => a.text())).toEqual(['王小美', 'desk', '系統', '已移除的帳號'])
    expect(actors.map((a) => a.attributes('title'))).toEqual(['amy@ivy.example', 'desk@ivy.example', undefined, undefined])
    expect(wrapper.text()).not.toContain('amy@ivy.example')
    // 手機卡片也有一行操作者。
    expect(wrapper.findAll('[data-test="audit-actor-mobile"]').map((a) => a.text())).toEqual(['王小美', 'desk', '系統', '已移除的帳號'])
  })

  it('對帳號的操作寫出是哪一個帳號；對方沒名字時只寫 Email 前綴、完整 Email 在 title', async () => {
    const wrapper = await mountAudit([
      auditEntry({ id: 'a1', action: 'user.reset_password', target_type: 'user', target_id: 'u2', target_label: '櫃台阿芬', campus_key: null, metadata: { revoked_sessions: 1 } }),
      auditEntry({ id: 'a2', action: 'user.update_display_name', target_type: 'user', target_id: 'u3', target_label: 'desk@ivy.example', campus_key: null, metadata: { changed: ['display_name'], self: false }, created_at: '2026-09-28T06:00:00Z' }),
    ])
    const targets = wrapper.findAll('.data-table [data-test="audit-target"]')
    expect(targets.map((t) => t.text())).toEqual(['櫃台阿芬', 'desk'])
    expect(targets[1]!.attributes('title')).toBe('desk@ivy.example')
    const rows = wrapper.findAll('.data-table .el-table__body tr').map((row) => row.text())
    expect(rows[0]).toContain('重設密碼・使用者「櫃台阿芬」')
    expect(rows[1]).toContain('變更顯示名稱・使用者「desk」')
    expect(rows[1]).toContain('修改：顯示名稱，由總管理者修改')
    expect(wrapper.get('.mobile-records').text()).toContain('使用者「櫃台阿芬」')
  })

  it('搜尋找得到操作者與對象帳號', async () => {
    const wrapper = await mountAudit([
      auditEntry({ id: 'a1' }),
      auditEntry({ id: 'a2', actor_display_name: '櫃台阿芬', actor_email: 'desk@ivy.example', created_at: '2026-09-28T06:00:00Z' }),
    ])
    await wrapper.get('.filter-search input').setValue('阿芬')
    expect(wrapper.findAll('.data-table [data-test="audit-actor"]').map((a) => a.text())).toEqual(['櫃台阿芬'])
  })
})

// ---------------------------------------------------------------- 案件明細
describe('案件明細的聯絡紀錄寫名字', () => {
  const staff = [
    { id: 'u1', email: 'amy@ivy.example', display_name: '王小美', role: 'campus_admin', is_active: true, campus_keys: ['yihua'] },
    { id: 'u2', email: 'amy@other.example', display_name: null, role: 'reception', is_active: true, campus_keys: ['yihua'] },
  ]
  const detail = {
    id: 'case-a', campus_key: 'yihua', status: 'contacting', source: 'phone', parent_name: '陳媽媽', phone: '0912345678', child_name: null,
    child_birthdate: null, email: null, referral_sources: [], age: null, preferred_time: null, questions: null, party_size: null,
    slot_id: null, slot: null, created_at: '2026-09-22T00:00:00Z', hold_expires_at: null, follow_up_at: null, version: 1,
    created_by: 'u2', confirmed_at: null, cancelled_at: null, pending_reschedule: null, access_link: null,
    history: [{ id: 'e1', event_type: 'contacting', source: 'staff', actor_user_id: 'u1', actor_email: 'amy@ivy.example', actor_display_name: '王小美', before: null, after: null, reason: null, created_at: '2026-09-22T01:00:00Z' }],
  }
  const notes = [{ id: 'n1', note: '已致電', created_at: '2026-09-22T02:00:00Z', created_by: 'u1', created_by_email: 'amy@ivy.example', created_by_display_name: '王小美' }]

  it('聯絡紀錄、登錄的人、歷程都寫名字；沒有承辦人（2026-10-06 拿掉）', async () => {
    vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
      if (path.endsWith('/contact-notes')) return notes as never
      if (path.startsWith('/admin/visit-staff')) return staff as never
      if (path.startsWith('/admin/visit-requests?') || path.startsWith('/admin/slots')) return [] as never
      if (path === '/admin/dashboard') return {} as never
      return detail as never
    })
    const pinia = createPinia()
    useAuthStore(pinia).user = testUser('super_admin')
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/visit-requests/:id', component: VisitDetailView },
        { path: '/:rest(.*)', component: defineComponent({ template: '<div />' }) },
      ],
    })
    await router.push('/visit-requests/case-a')
    await router.isReady()
    const wrapper = mount({ template: '<router-view />' }, { attachTo: document.body, global: { plugins: [pinia, router, ElementPlus] } })
    wrappers.push(wrapper)
    await flushPromises()

    expect(wrapper.find('#visit-assignee').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('承辦')

    const author = wrapper.get('.notes__author')
    expect(author.text()).toBe('王小美')
    expect(author.attributes('title')).toBe('amy@ivy.example')
    expect(wrapper.get('.detail__head').text()).toContain('（amy 登錄）')
    expect(wrapper.get('.timeline__actor').text()).toBe('王小美')
    expect(wrapper.get('.timeline__actor').attributes('title')).toBe('amy@ivy.example')
  })
})

// ---------------------------------------------------------------- 發布紀錄
describe('發布紀錄、排程與通知寫名字', () => {
  it('發布的人、排程的人、送審的人都寫名字，Email 在 title', async () => {
    vi.spyOn(api, 'get').mockImplementation(async (url: string) => {
      if (url.startsWith('/admin/releases')) {
        return { items: [{ id: 'r1', created_at: '2026-09-25T02:00:00Z', created_by_email: 'amy@ivy.example', created_by_display_name: '王小美', source: 'publish', restored_from_release_id: null, is_current: true, changes: [] }], next_before: null } as never
      }
      if (url.startsWith('/admin/publish-jobs')) {
        return [{ id: 'j1', kind: 'campus_faq', campus_key: 'yihua', revision_id: 'r1', revision_version: 2, publish_at: '2099-09-26T01:00:00Z', status: 'scheduled', error: null, created_by_email: 'ed@ivy.example', created_by_display_name: null, created_at: '2026-09-25T01:00:00Z', finished_at: null, can_cancel: true }] as never
      }
      if (url.startsWith('/admin/my-notifications')) {
        return [{ id: 'n1', kind: 'content_review_submitted', campus_key: 'yihua', content_kind: 'campus_faq', revision_version: 3, note: null, error: null, publish_at: null, actor_email: 'ed@ivy.example', actor_display_name: '編輯小陳', created_at: '2026-09-25T02:00:00Z', read_at: null }] as never
      }
      return {} as never
    })
    const pinia = createPinia()
    useAuthStore(pinia).user = testUser('super_admin', { campus_keys: ['yihua'] })
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: defineComponent({ template: '<div />' }) }] })
    await router.push('/releases')
    await router.isReady()
    const wrapper = mount(PublishHistoryView, { global: { plugins: [pinia, router, ElementPlus], provide: { [matchedRouteKey as symbol]: computed(() => router.currentRoute.value.matched[0]) } } })
    wrappers.push(wrapper)
    await flushPromises()

    const by = wrapper.get('.release__by')
    expect(by.text()).toContain('王小美')
    expect(by.attributes('title')).toBe('amy@ivy.example')
    expect(wrapper.get('.notice__meta').text()).toContain('編輯小陳 送審')
    expect(wrapper.text()).not.toContain('ed@ivy.example')

    await router.replace({ query: { tab: 'schedules' } })
    await flushPromises()
    const meta = wrapper.get('.job__meta')
    expect(meta.text()).toContain('ed 排程')
    expect(meta.get('span[title="ed@ivy.example"]').text()).toBe('ed')
  })
})
