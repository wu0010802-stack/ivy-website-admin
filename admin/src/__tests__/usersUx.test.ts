import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { computed, defineComponent } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter, matchedRouteKey } from 'vue-router'
import ElementPlus, { ElMessage, ElMessageBox } from 'element-plus'
import UsersView from '../views/UsersView.vue'
import UserActions from '../components/UserActions.vue'
import { api, ApiError } from '../api/client'
import { ROLE_DESCRIPTIONS, ROLE_LABELS, ROLE_ORDER } from '../api/labels'
import { useAuthStore } from '../stores/auth'
import { testUser } from './fixtures'

const wrappers: VueWrapper[] = []
afterEach(() => { wrappers.forEach(wrapper => wrapper.unmount()); wrappers.length = 0; vi.restoreAllMocks() })

async function setup() {
  const pinia = createPinia()
  useAuthStore(pinia).user = testUser('super_admin', { id: 'local-test', email: 'test@example.invalid', campus_keys: ['yihua'] })
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: defineComponent({ template: '<div />' }) }] })
  await router.push('/users')
  await router.isReady()
  const wrapper = mount(UsersView, { global: { plugins: [pinia, router, ElementPlus], provide: { [matchedRouteKey as symbol]: computed(() => router.currentRoute.value.matched[0]) } } })
  wrappers.push(wrapper)
  await flushPromises()
  return wrapper
}
// 「解除綁定並登出」在每列的「更多」選單裡（2026-10-05 起）：選單預先渲染、teleport 到 body，
// 從 document 找（卸載時會一起移除，不會留到下一個測試）。
function clearLoginItems(_wrapper: VueWrapper) {
  return [...document.body.querySelectorAll('[data-test="clear-external-logins"]')]
}

function button(wrapper: VueWrapper, text: string) {
  return wrapper.findAll('button').find(item => item.text() === text)!
}

describe('使用者清單讀寫互斥', () => {
  it('重新整理尚未完成時停用新增入口，完成後才恢復', async () => {
    let resolveRefresh!: (value: unknown[]) => void
    const pending = new Promise<unknown[]>(resolve => { resolveRefresh = resolve })
    const get = vi.spyOn(api, 'get').mockResolvedValueOnce([]).mockImplementationOnce(() => pending as Promise<never>)
    const post = vi.spyOn(api, 'post')
    const wrapper = await setup()
    expect(button(wrapper, '新增使用者').attributes('disabled')).toBeUndefined()
    await button(wrapper, '重新整理').trigger('click')
    await flushPromises()
    expect(get).toHaveBeenCalledTimes(2)
    expect(button(wrapper, '新增使用者').attributes('disabled')).toBeDefined()
    await button(wrapper, '新增使用者').trigger('click')
    expect(post).not.toHaveBeenCalled()
    expect(wrapper.findAllComponents({ name: 'ElDialog' }).some(dialog => dialog.props('modelValue'))).toBe(false)
    resolveRefresh([])
    await flushPromises()
    expect(button(wrapper, '新增使用者').attributes('disabled')).toBeUndefined()
    await button(wrapper, '新增使用者').trigger('click')
    await flushPromises()
    expect(wrapper.findAllComponents({ name: 'ElDialog' }).some(dialog => dialog.props('modelValue'))).toBe(true)
  })
})

describe('解除別人的 Google／LINE 綁定並登出（2026-09-29）', () => {
  it('只對別人且有綁定的帳號顯示，成功後用回傳的資料更新該列', async () => {
    const me = testUser('super_admin', { id: 'local-test', email: 'test@example.invalid', line_linked: true })
    const other = testUser('campus_admin', { id: 'other', email: 'other@ivy.example', campus_keys: ['yihua'], line_linked: true, google_linked: true })
    const plain = testUser('editor', { id: 'plain', email: 'plain@ivy.example', campus_keys: ['yihua'] })
    vi.spyOn(api, 'get').mockResolvedValue([me, other, plain])
    const post = vi.spyOn(api, 'post').mockResolvedValue({ ...other, line_linked: false, google_linked: false })
    const wrapper = await setup()
    // 桌機表格與手機清單各一份；2026-10-05 起收在每列的「更多」選單裡。
    expect(clearLoginItems(wrapper)).toHaveLength(2)
    const actions = wrapper.findAllComponents(UserActions).find(item => item.props('user').id === 'other')!
    actions.vm.$emit('clearLogins', other)
    await flushPromises()
    expect(post).toHaveBeenCalledWith('/admin/users/other/clear-external-logins')
    expect(clearLoginItems(wrapper)).toHaveLength(0)
  })

  it('自己的列不提供（要到「我的帳號」操作）', async () => {
    const me = testUser('super_admin', { id: 'local-test', email: 'test@example.invalid', line_linked: true, google_linked: true })
    vi.spyOn(api, 'get').mockResolvedValue([me])
    const wrapper = await setup()
    expect(clearLoginItems(wrapper)).toHaveLength(0)
    expect(button(wrapper, '重設密碼')).toBeUndefined()
  })
})

describe('新密碼長度提示（bcrypt 72 bytes 上限）', () => {
  it('超過 72 bytes 的中文密碼不能建立，並說明上限', async () => {
    vi.spyOn(api, 'get').mockResolvedValue([])
    const post = vi.spyOn(api, 'post')
    const wrapper = await setup()
    await button(wrapper, '新增使用者').trigger('click')
    await flushPromises()
    await wrapper.find('input[type="email"]').setValue('new@ivy.example')
    await wrapper.find('input[autocomplete="new-password"]').setValue('常'.repeat(25))
    expect(wrapper.text()).toContain('最多 72 bytes（中文約 24 字）')
    expect(wrapper.text()).toContain('超過 72 bytes')
    // main（PR #15）的表單按鈕不預先停用，按下才逐欄寫出問題。
    await button(wrapper, '建立帳號').trigger('click')
    await flushPromises()
    expect(wrapper.get('#new-user-password-error').text()).toContain('超過 72 bytes')
    expect(wrapper.get('#new-user-password').attributes('aria-invalid')).toBe('true')
    await wrapper.find('input[autocomplete="new-password"]').setValue('常'.repeat(24))
    expect(wrapper.find('#new-user-password-error').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('超過 72 bytes')
    expect(post).not.toHaveBeenCalled()
  })
})

// ---- 2026-09-28 使用者頁 UX：密碼留著可複製、表單說明為什麼不能送、總管理者多一道確認 ----
const other = testUser('campus_admin', { id: 'u2', email: 'ca@ivy.example', campus_keys: ['yihua'] })
const self = testUser('super_admin', { id: 'local-test', email: 'test@example.invalid' })

function openDialog(wrapper: VueWrapper) {
  return wrapper.findAllComponents({ name: 'ElDialog' }).find(dialog => dialog.props('modelValue'))!
}
function anyDialogOpen(wrapper: VueWrapper) {
  return wrapper.findAllComponents({ name: 'ElDialog' }).some(dialog => dialog.props('modelValue'))
}
function setClipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
}

describe('重設與新增後密碼留在畫面上', () => {
  afterEach(() => { Reflect.deleteProperty(navigator, 'clipboard') })

  it('重設成功後對話框不關，顯示新密碼與複製鈕；按完成才關', async () => {
    vi.spyOn(api, 'get').mockResolvedValue([other] as never)
    const post = vi.spyOn(api, 'post').mockResolvedValue({} as never)
    const writeText = vi.fn(async () => {})
    setClipboard(writeText)
    const wrapper = await setup()
    await button(wrapper, '重設密碼').trigger('click')
    await flushPromises()
    expect(openDialog(wrapper).props('closeOnPressEscape')).toBe(true)
    await button(wrapper, '產生密碼').trigger('click')
    const password = (openDialog(wrapper).find('input[aria-label="新密碼"]').element as HTMLInputElement).value
    expect(password).toHaveLength(16)
    await openDialog(wrapper).findAll('button').find(item => item.text() === '重設密碼')!.trigger('click')
    await flushPromises()
    expect(post).toHaveBeenCalledWith('/admin/users/u2/password', { password })
    expect(anyDialogOpen(wrapper)).toBe(true)
    const result = wrapper.get('[data-test="reset-password"]')
    expect((result.find('input').element as HTMLInputElement).value).toBe(password)
    expect(result.text()).toContain('對方所有裝置都已登出')
    // 顯示結果時不會因為點到對話框外面就關掉。
    expect(openDialog(wrapper).props('closeOnClickModal')).toBe(false)
    await button(wrapper, '複製密碼').trigger('click')
    await flushPromises()
    expect(writeText).toHaveBeenCalledWith(password)
    await button(wrapper, '完成').trigger('click')
    await flushPromises()
    expect(anyDialogOpen(wrapper)).toBe(false)
  })

  it('瀏覽器不能自動複製時，改成選取密碼並請人手動複製', async () => {
    vi.spyOn(api, 'get').mockResolvedValue([other] as never)
    vi.spyOn(api, 'post').mockResolvedValue({} as never)
    setClipboard(async () => { throw new Error('denied') })
    const warning = vi.spyOn(ElMessage, 'warning')
    const wrapper = await setup()
    await button(wrapper, '重設密碼').trigger('click')
    await flushPromises()
    await button(wrapper, '產生密碼').trigger('click')
    await openDialog(wrapper).findAll('button').find(item => item.text() === '重設密碼')!.trigger('click')
    await flushPromises()
    const select = vi.spyOn(HTMLInputElement.prototype, 'select')
    await button(wrapper, '複製密碼').trigger('click')
    await flushPromises()
    expect(select).toHaveBeenCalled()
    expect(warning).toHaveBeenCalledWith(expect.objectContaining({ message: '無法自動複製，已選取密碼，請手動複製' }))
  })

  it('建立帳號成功後顯示密碼與複製鈕，不直接關掉', async () => {
    vi.spyOn(api, 'get').mockResolvedValue([] as never)
    vi.spyOn(api, 'post').mockResolvedValue(testUser('editor', { id: 'n1', email: 'new@ivy.example', campus_keys: ['yihua'] }) as never)
    const wrapper = await setup()
    await button(wrapper, '新增使用者').trigger('click')
    await flushPromises()
    await wrapper.get('#new-user-email').setValue('new@ivy.example')
    await button(wrapper, '產生密碼').trigger('click')
    const password = (wrapper.get('#new-user-password').element as HTMLInputElement).value
    await wrapper.findAllComponents({ name: 'ElCheckbox' }).find(box => box.text() === '義華')!.find('input').setValue(true)
    await button(wrapper, '建立帳號').trigger('click')
    await flushPromises()
    const result = wrapper.get('[data-test="created-password"]')
    expect(result.text()).toContain('已建立 new@ivy.example')
    expect((result.find('input').element as HTMLInputElement).value).toBe(password)
    expect(button(wrapper, '複製密碼')).toBeTruthy()
    expect(anyDialogOpen(wrapper)).toBe(true)
  })
})

describe('新增使用者表單說明哪裡沒填好', () => {
  it('按建立帳號時逐欄寫出問題，不送出', async () => {
    vi.spyOn(api, 'get').mockResolvedValue([] as never)
    const post = vi.spyOn(api, 'post')
    const wrapper = await setup()
    await button(wrapper, '新增使用者').trigger('click')
    await flushPromises()
    expect(button(wrapper, '建立帳號').attributes('disabled')).toBeUndefined()
    await button(wrapper, '建立帳號').trigger('click')
    await flushPromises()
    const errors = wrapper.findAll('.field-error').map(item => item.text())
    expect(errors).toEqual(['請輸入 Email', expect.stringContaining('密碼至少要 12 個字元'), '請至少勾選一個負責校區'])
    expect(wrapper.get('#new-user-email').attributes('aria-invalid')).toBe('true')
    await wrapper.get('#new-user-email').setValue('a@b')
    await button(wrapper, '建立帳號').trigger('click')
    await flushPromises()
    expect(wrapper.get('#new-user-email-error').text()).toBe('請輸入完整的 Email，例如 name@example.com')
    expect(post).not.toHaveBeenCalled()
  })

  it('後端說 Email 格式不對時寫在 Email 欄下方，不顯示英文原文', async () => {
    vi.spyOn(api, 'get').mockResolvedValue([] as never)
    vi.spyOn(api, 'post').mockRejectedValue(new ApiError(422, [{ loc: ['body', 'email'], msg: 'value is not a valid email address: The domain name x.y does not exist', type: 'value_error' }]))
    const error = vi.spyOn(ElMessage, 'error')
    const wrapper = await setup()
    await button(wrapper, '新增使用者').trigger('click')
    await flushPromises()
    await wrapper.get('#new-user-email').setValue('name@x.y')
    await button(wrapper, '產生密碼').trigger('click')
    await wrapper.findAllComponents({ name: 'ElCheckbox' }).find(box => box.text() === '義華')!.find('input').setValue(true)
    await button(wrapper, '建立帳號').trigger('click')
    await flushPromises()
    expect(wrapper.get('#new-user-email-error').text()).toBe('請輸入完整的 Email，例如 name@example.com')
    expect(error).not.toHaveBeenCalled()
  })

  it('角色說明一次全部列出，共用內容授權寫出實際範圍', async () => {
    vi.spyOn(api, 'get').mockResolvedValue([] as never)
    const wrapper = await setup()
    await button(wrapper, '新增使用者').trigger('click')
    await flushPromises()
    const dialog = openDialog(wrapper)
    expect(dialog.findAll('.role-option')).toHaveLength(5)
    for (const role of ROLE_ORDER) expect(dialog.text()).toContain(ROLE_DESCRIPTIONS[role])
    // 選項文字仍只有角色名，說明放在外面。
    expect(dialog.findAllComponents({ name: 'ElRadio' }).map(radio => radio.text())).toEqual(ROLE_ORDER.map(role => ROLE_LABELS[role]))
    const shared = dialog.findAllComponents({ name: 'ElFormItem' }).find(item => item.text().includes('也可以編輯全站共用內容'))!
    expect(shared.text()).toContain('入學資訊頁、預約文案、頁尾文字')
    expect(shared.text()).not.toContain('網站設定')
  })
})

describe('新增或升為總管理者多一道確認', () => {
  it('新增總管理者：先列出權限，建立前確認；按先不要就不建立', async () => {
    vi.spyOn(api, 'get').mockResolvedValue([] as never)
    const post = vi.spyOn(api, 'post')
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue('cancel' as never)
    const wrapper = await setup()
    await button(wrapper, '新增使用者').trigger('click')
    await flushPromises()
    await wrapper.findAllComponents({ name: 'ElRadio' }).find(radio => radio.text() === '總管理者')!.find('input').setValue(true)
    await flushPromises()
    expect(wrapper.get('.super-admin-alert').text()).toContain('看到並匯出五校家長資料')
    await wrapper.get('#new-user-email').setValue('boss@ivy.example')
    await button(wrapper, '產生密碼').trigger('click')
    await button(wrapper, '建立帳號').trigger('click')
    await flushPromises()
    expect(confirm).toHaveBeenCalledOnce()
    const [, title, options] = confirm.mock.calls[0]! as unknown as [string, string, Record<string, string>]
    expect(title).toBe('確定讓 boss@ivy.example 成為總管理者？')
    expect(options).toMatchObject({ confirmButtonText: '設為總管理者', cancelButtonText: '先不要' })
    expect(post).not.toHaveBeenCalled()
  })

  it('升為總管理者要確認；改成其他角色不必', async () => {
    vi.spyOn(api, 'get').mockResolvedValue([other] as never)
    const patch = vi.spyOn(api, 'patch').mockImplementation(async (_path, body) => ({ ...other, ...(body as object) }) as never)
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    const wrapper = await setup()
    await button(wrapper, '角色與校區').trigger('click')
    await flushPromises()
    await wrapper.findAllComponents({ name: 'ElRadio' }).find(radio => radio.text() === '櫃台')!.find('input').setValue(true)
    await button(wrapper, '儲存').trigger('click')
    await flushPromises()
    expect(confirm).not.toHaveBeenCalled()
    await button(wrapper, '角色與校區').trigger('click')
    await flushPromises()
    await wrapper.findAllComponents({ name: 'ElRadio' }).find(radio => radio.text() === '總管理者')!.find('input').setValue(true)
    await flushPromises()
    expect(wrapper.find('.super-admin-alert').exists()).toBe(true)
    await button(wrapper, '儲存').trigger('click')
    await flushPromises()
    expect(confirm).toHaveBeenCalledOnce()
    expect(patch).toHaveBeenLastCalledWith('/admin/users/u2/role', { role: 'super_admin', campus_keys: [] })
  })

  it('取消所有校區時寫出為什麼不能儲存', async () => {
    vi.spyOn(api, 'get').mockResolvedValue([other] as never)
    const wrapper = await setup()
    await button(wrapper, '角色與校區').trigger('click')
    await flushPromises()
    await wrapper.findAllComponents({ name: 'ElCheckbox' }).find(box => box.text() === '義華')!.find('input').setValue(false)
    await flushPromises()
    expect(button(wrapper, '儲存').attributes('disabled')).toBeDefined()
    expect(wrapper.get('#scope-campus-error').text()).toContain('請至少勾選一個負責校區')
  })
})

describe('自己的那一列', () => {
  it('不放按不下去的停用與角色鈕，改指到我的帳號', async () => {
    vi.spyOn(api, 'get').mockResolvedValue([self, other] as never)
    const wrapper = await setup()
    const rows = wrapper.findAll('.el-table__body tr')
    const mine = rows.find(row => row.text().includes('test@example.invalid'))!
    expect(mine.findAll('button')).toHaveLength(0)
    expect(mine.text()).toContain('自己的帳號請到我的帳號管理')
    expect(mine.find('a[href="/account"]').exists()).toBe(true)
    const theirs = rows.find(row => row.text().includes('ca@ivy.example'))!
    // 2026-10-05 第九輪：停用收進「更多」選單，不再每列一顆紅色鈕。
    expect(theirs.findAll('button').map(item => item.text())).toEqual(['角色與校區', '重設密碼', '更多'])
  })
})
