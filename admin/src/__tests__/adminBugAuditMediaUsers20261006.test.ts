// 2026-10-06 後台 bug 稽核（前端）：素材（第 22–24 條）、帳號管理重新驗證（第 25 條）。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, type VueWrapper } from '@vue/test-utils'
import { ElMessage } from 'element-plus'
import MediaLibraryView from '../views/MediaLibraryView.vue'
import MediaUsagesDrawer from '../components/MediaUsagesDrawer.vue'
import UsersView from '../views/UsersView.vue'
import UserActions from '../components/UserActions.vue'
import { ApiError, api } from '../api/client'
import type { MediaAssetOut, MediaUsagesOut, UserOut } from '../api/types'
import { resetUploadLimits } from '../composables/mediaUpload'
import { testUser } from './fixtures'
import { cleanup, deferred, mountWith } from './admissionsTestKit'

beforeEach(() => resetUploadLimits())
afterEach(cleanup)

function asset(overrides: Partial<MediaAssetOut> = {}): MediaAssetOut {
  return {
    id: 'm1', campus_key: 'yihua', kind: 'image', status: 'ready', original_filename: 'garden.jpg', content_type: 'image/jpeg',
    size_bytes: 2048, width: 100, height: 80, duration_seconds: null, created_at: '2026-09-20T02:00:00Z', created_by_email: 'teacher@ivy.example',
    archived_at: null, deleted_at: null, purge_after: null, replaces_media_id: null, alt_text: '菜園', source_attribution: null, caption: null,
    license_note: null, tags: [], crop_focus_x: null, crop_focus_y: null, processing_error: null, usage_count: 0, used_in: [], variants: [], version: 1,
    ...overrides,
  } as MediaAssetOut
}

function mockMedia(assets: MediaAssetOut[]) {
  return vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
    if (path === '/admin/media/upload-limits') return { max_image_bytes: 1, max_video_bytes: 1, image_types: [], video_types: [], purge_delay_days: 7 } as never
    if (path.startsWith('/admin/media')) return assets as never
    return [] as never
  })
}

// ------------------------------------------------------------------ 22
describe('22. 素材庫的校區篩選與上傳預選只限可用的校區', () => {
  const campusAdmin = () => testUser('campus_admin', { id: 'ca', email: 'ca@example.invalid', campus_keys: ['yihua'] })

  it('分校管理者：篩選只列跨校共用與自己的校區', async () => {
    mockMedia([])
    const { wrapper } = await mountWith(MediaLibraryView, { path: '/media', user: campusAdmin() })
    const filter = wrapper.findAllComponents({ name: 'ElSelect' }).find((select) => select.props('placeholder') === '全部校區')!
    expect(filter.findAllComponents({ name: 'ElOption' }).map((option) => option.props('value'))).toEqual(['__shared', 'yihua'])
  })

  it('篩選值不在可上傳的校區裡：上傳時不預選它，改用自己的校區', async () => {
    mockMedia([])
    const { wrapper } = await mountWith(MediaLibraryView, { path: '/media', user: campusAdmin() })
    wrapper.findAllComponents({ name: 'ElSelect' }).find((select) => select.props('placeholder') === '全部校區')!.vm.$emit('update:modelValue', 'minghua')
    await flushPromises()
    await wrapper.findAll('button').find((b) => b.text() === '上傳素材')!.trigger('click')
    await flushPromises()
    const uploadCampus = wrapper.findAllComponents({ name: 'ElSelect' }).find((select) => select.props('placeholder') === '請選擇校區')!
    expect(uploadCampus.props('modelValue')).toBe('yihua')
  })
})

// ------------------------------------------------------------------ 23
describe('23. 素材卡片的復原、取消封存、重新處理不能連按', () => {
  it('請求還沒回來：同一張卡的按鈕停用，再按也不會再送', async () => {
    mockMedia([
      asset({ id: 'del', deleted_at: '2026-10-01T00:00:00Z', purge_after: '2026-10-08T00:00:00Z' }),
      asset({ id: 'arc', archived_at: '2026-10-01T00:00:00Z' }),
    ])
    const pending = deferred<unknown>()
    const post = vi.spyOn(api, 'post').mockReturnValue(pending.promise as never)
    const { wrapper } = await mountWith(MediaLibraryView, { path: '/media' })
    const card = (id: string) => wrapper.get(`[data-media-id="${id}"]`)
    const cardButton = (id: string, text: string) => card(id).findAll('button').find((b) => b.text() === text)!
    await cardButton('del', '復原').trigger('click')
    await cardButton('del', '復原').trigger('click')
    await cardButton('arc', '取消封存').trigger('click')
    await cardButton('arc', '取消封存').trigger('click')
    expect(post.mock.calls.map((call) => call[0])).toEqual(['/admin/media/del/restore', '/admin/media/arc/unarchive'])
    expect(cardButton('del', '復原').attributes('disabled')).toBeDefined()
    expect(cardButton('arc', '取消封存').attributes('disabled')).toBeDefined()
    pending.resolve({})
    await flushPromises()
  })

  it('重新處理失敗的影片也一樣', async () => {
    mockMedia([asset({ id: 'vid', kind: 'video', status: 'failed', content_type: 'video/mp4' })])
    const pending = deferred<unknown>()
    const post = vi.spyOn(api, 'post').mockReturnValue(pending.promise as never)
    const { wrapper } = await mountWith(MediaLibraryView, { path: '/media' })
    const retry = () => wrapper.get('[data-media-id="vid"]').findAll('button').find((b) => b.text() === '重新處理')!
    await retry().trigger('click')
    await retry().trigger('click')
    expect(post).toHaveBeenCalledTimes(1)
    pending.resolve(asset({ id: 'vid', kind: 'video', status: 'processing' }))
    await flushPromises()
  })
})

// ------------------------------------------------------------------ 24
describe('24. 「用在哪裡」抽屜只顯示最後打開的那個素材', () => {
  it('先開 A、馬上換 B：A 較晚回來也不會蓋掉 B', async () => {
    const usages = (label: string): MediaUsagesOut => ({
      media_id: label, references: [{ content_item_id: `c-${label}`, kind: 'campus_tour', campus_key: 'yihua', revision_id: 'r', version: 1, field_path: 'scenes[0].image', label, states: ['draft'], publish_at: null, can_edit: true }],
      history: [], untracked_usages: 0, can_archive: false, can_delete: false,
    })
    const slow = deferred<unknown>()
    vi.spyOn(api, 'get').mockImplementation(async (path: string) => (path.includes('/a/') ? slow.promise : usages('B 的場景')) as never)
    const { wrapper } = await mountWith(MediaUsagesDrawer, { path: '/media', props: { modelValue: true, asset: asset({ id: 'a', original_filename: 'a.jpg' }) } })
    await wrapper.setProps({ asset: asset({ id: 'b', original_filename: 'b.jpg' }) })
    await flushPromises()
    slow.resolve(usages('A 的場景'))
    await flushPromises()
    expect(document.body.textContent).toContain('B 的場景')
    expect(document.body.textContent).not.toContain('A 的場景')
  })
})

// ------------------------------------------------------------------ 25
describe('25. 帳號管理的敏感寫入要重新驗證', () => {
  const me = () => testUser('super_admin', { id: 'local-test', email: 'test@example.invalid' })
  const amy = (changes: Partial<UserOut> = {}) => testUser('campus_admin', { id: 'u2', email: 'amy@ivy.example', campus_keys: ['yihua'], capabilities: [], ...changes })
  const bob = (changes: Partial<UserOut> = {}) => testUser('editor', { id: 'u3', email: 'bob@ivy.example', campus_keys: ['yihua'], is_active: false, ...changes })
  const REAUTH = () => new ApiError(403, { code: 'REAUTH_REQUIRED', message: '這個操作要先確認是你本人，請輸入目前的密碼。' })
  const WRONG = () => new ApiError(403, { code: 'REAUTH_REQUIRED', message: '目前的密碼不正確' })

  // 後端：沒帶密碼回 REAUTH_REQUIRED；帶錯也是；帶對才成功。
  function guarded<T>(result: (body: Record<string, unknown>) => T, options: { always?: boolean } = {}) {
    return (body: Record<string, unknown>) => {
      if (body.current_password === 'right-pass') return result(body)
      if (body.current_password) throw WRONG()
      if (options.always === false) return result(body)
      throw REAUTH()
    }
  }

  const reauthForm = () => document.body.querySelector('[data-test="reauth-form"]')
  const reauthOpen = () => {
    const form = reauthForm()
    return Boolean(form && (form.closest('.el-overlay') as HTMLElement | null)?.style.display !== 'none')
  }
  async function typePassword(value: string) {
    const input = document.body.querySelector<HTMLInputElement>('input[data-test="reauth-password"], [data-test="reauth-password"] input')!
    input.value = value
    input.dispatchEvent(new Event('input'))
    await flushPromises()
    document.body.querySelector<HTMLButtonElement>('[data-test="reauth-submit"]')!.click()
    await flushPromises()
  }
  async function cancelReauth() {
    document.body.querySelector<HTMLButtonElement>('[data-test="reauth-cancel"]')!.click()
    await flushPromises()
  }
  const buttonIn = (wrapper: VueWrapper, text: string) => wrapper.findAll('button').find((b) => b.text() === text)!
  async function openScope(wrapper: VueWrapper, user: UserOut) {
    wrapper.findAllComponents(UserActions).find((item) => item.props('user').id === user.id)!.vm.$emit('scope', user)
    await flushPromises()
  }
  async function tickExport(wrapper: VueWrapper) {
    await wrapper.findAllComponents({ name: 'ElCheckbox' }).find((box) => box.text().includes('匯出負責校區的家長個資'))!.find('input').setValue(true)
  }

  it('改角色：先要求輸入目前的密碼；打錯留在對話框，打對就接著送完角色與授權，之後的操作自動帶上', async () => {
    vi.spyOn(api, 'get').mockResolvedValue([me(), amy(), bob()] as never)
    const patch = vi.spyOn(api, 'patch').mockImplementation(async (path: string, body?: unknown) => {
      const handler = path.endsWith('/role')
        ? guarded((b) => amy({ role: b.role as never, campus_keys: b.campus_keys as never, capabilities: [] }))
        : path.endsWith('/capabilities')
          ? guarded((b) => amy({ capabilities: b.capabilities as never }))
          : guarded(() => bob({ is_active: true }))
      return handler(body as Record<string, unknown>) as never
    })
    const { wrapper } = await mountWith(UsersView, { path: '/users', user: me() })
    await openScope(wrapper, amy())
    await tickExport(wrapper)
    await buttonIn(wrapper, '儲存').trigger('click')
    await flushPromises()
    expect(reauthOpen()).toBe(true)
    expect(reauthForm()!.textContent).toContain('這個操作要先確認是你本人')

    await typePassword('wrong-pass')
    expect(reauthOpen()).toBe(true)
    expect(document.body.querySelector('[data-test="reauth-error"]')?.textContent).toContain('目前的密碼不正確')

    await typePassword('right-pass')
    expect(reauthOpen()).toBe(false)
    const calls = patch.mock.calls.map(([path, body]) => [path, body])
    expect(calls.at(-2)).toEqual(['/admin/users/u2/role', { role: 'campus_admin', campus_keys: ['yihua'], current_password: 'right-pass' }])
    expect(calls.at(-1)).toEqual(['/admin/users/u2/capabilities', { capabilities: ['booking.export'], current_password: 'right-pass' }])

    // 恢復停用的帳號也要驗證：剛驗證過，自動帶上，不再跳對話框。
    wrapper.findAllComponents(UserActions).find((item) => item.props('user').id === 'u3')!.vm.$emit('toggle', bob())
    await flushPromises()
    expect(reauthOpen()).toBe(false)
    expect(patch).toHaveBeenLastCalledWith('/admin/users/u3/active', { is_active: true, current_password: 'right-pass' })
  })

  it('記住的密碼超過 10 分鐘就不再帶，重新請本人輸入', async () => {
    const start = Date.now()
    const now = vi.spyOn(Date, 'now').mockReturnValue(start)
    vi.spyOn(api, 'get').mockResolvedValue([me(), amy(), bob()] as never)
    const patch = vi.spyOn(api, 'patch').mockImplementation(async (_path: string, body?: unknown) => guarded(() => bob({ is_active: true }))(body as Record<string, unknown>) as never)
    const { wrapper } = await mountWith(UsersView, { path: '/users', user: me() })
    const toggleBob = async () => {
      wrapper.findAllComponents(UserActions).find((item) => item.props('user').id === 'u3')!.vm.$emit('toggle', bob())
      await flushPromises()
    }
    await toggleBob()
    await typePassword('right-pass')
    now.mockReturnValue(start + 11 * 60 * 1000)
    patch.mockClear()
    await toggleBob()
    expect(patch).toHaveBeenCalledWith('/admin/users/u3/active', { is_active: true })
    expect(reauthOpen()).toBe(true)
    await cancelReauth()
  })

  it('停用不需要驗證，本文不帶密碼', async () => {
    vi.spyOn(api, 'get').mockResolvedValue([me(), amy()] as never)
    const patch = vi.spyOn(api, 'patch').mockResolvedValue(amy({ is_active: false }) as never)
    const { wrapper } = await mountWith(UsersView, { path: '/users', user: me() })
    wrapper.findAllComponents(UserActions).find((item) => item.props('user').id === 'u2')!.vm.$emit('toggle', amy())
    await flushPromises()
    expect(patch).toHaveBeenCalledWith('/admin/users/u2/active', { is_active: false })
  })

  it('角色已經存好、改授權時要驗證但按了取消：再按儲存只補送授權，不重送角色', async () => {
    vi.spyOn(api, 'get').mockResolvedValue([me(), amy()] as never)
    const patch = vi.spyOn(api, 'patch').mockImplementation(async (path: string, body?: unknown) => {
      const b = body as Record<string, unknown>
      if (path.endsWith('/role')) return amy({ role: b.role as never, campus_keys: b.campus_keys as never }) as never
      return guarded((x) => amy({ capabilities: x.capabilities as never }))(b) as never
    })
    const { wrapper } = await mountWith(UsersView, { path: '/users', user: me() })
    await openScope(wrapper, amy())
    await tickExport(wrapper)
    await buttonIn(wrapper, '儲存').trigger('click')
    await flushPromises()
    expect(reauthOpen()).toBe(true)
    await cancelReauth()
    expect(reauthOpen()).toBe(false)
    // 角色與校區對話框還開著，勾選也還在。
    await buttonIn(wrapper, '儲存').trigger('click')
    await flushPromises()
    await typePassword('right-pass')
    expect(patch.mock.calls.filter(([path]) => String(path).endsWith('/role'))).toHaveLength(1)
    expect(patch).toHaveBeenLastCalledWith('/admin/users/u2/capabilities', { capabilities: ['booking.export'], current_password: 'right-pass' })
  })

  it('新增帳號與替人設密碼：要求驗證後帶 current_password 重送同一個請求', async () => {
    vi.spyOn(api, 'get').mockResolvedValue([me(), amy()] as never)
    const post = vi.spyOn(api, 'post').mockImplementation(async (path: string, body?: unknown) => {
      const b = body as Record<string, unknown>
      if (path === '/admin/users') return guarded((x) => testUser('editor', { id: 'u9', email: String(x.email), campus_keys: ['yihua'] }))(b) as never
      return guarded(() => ({}))(b) as never
    })
    const { wrapper } = await mountWith(UsersView, { path: '/users', user: me() })
    await buttonIn(wrapper, '新增使用者').trigger('click')
    await flushPromises()
    await wrapper.get('#new-user-email').setValue('new@ivy.example')
    await buttonIn(wrapper, '產生密碼').trigger('click')
    await wrapper.findAllComponents({ name: 'ElCheckbox' }).find((box) => box.text() === '義華')!.find('input').setValue(true)
    await buttonIn(wrapper, '建立帳號').trigger('click')
    await flushPromises()
    expect(reauthOpen()).toBe(true)
    await typePassword('right-pass')
    expect(post).toHaveBeenLastCalledWith('/admin/users', expect.objectContaining({ email: 'new@ivy.example', current_password: 'right-pass' }))
    expect(wrapper.find('[data-test="created-password"]').exists()).toBe(true)

    // 替人設密碼：剛驗證過，自動帶上。
    post.mockClear()
    wrapper.findAllComponents(UserActions).find((item) => item.props('user').id === 'u2')!.vm.$emit('reset', amy())
    await flushPromises()
    await buttonIn(wrapper, '產生密碼').trigger('click')
    const resetDialog = wrapper.findAllComponents({ name: 'ElDialog' }).find((item) => item.props('modelValue') && item.props('title')?.includes('重設'))
    const submit = (resetDialog ?? wrapper).findAll('button').filter((b) => b.text() === '重設密碼').at(-1)!
    await submit.trigger('click')
    await flushPromises()
    expect(post).toHaveBeenCalledWith('/admin/users/u2/password', expect.objectContaining({ current_password: 'right-pass' }))
  })

  it('密碼驗證被鎖（429）：關掉對話框、說明暫停，不另外跳「更新失敗」', async () => {
    vi.spyOn(api, 'get').mockResolvedValue([me(), amy(), bob()] as never)
    vi.spyOn(api, 'patch').mockImplementation(async (_path: string, body?: unknown) => {
      if ((body as Record<string, unknown>).current_password) throw new ApiError(429, { code: 'LOGIN_LOCKED', message: '鎖定' })
      throw REAUTH()
    })
    const error = vi.spyOn(ElMessage, 'error')
    const { wrapper } = await mountWith(UsersView, { path: '/users', user: me() })
    wrapper.findAllComponents(UserActions).find((item) => item.props('user').id === 'u3')!.vm.$emit('toggle', bob())
    await flushPromises()
    await typePassword('any-pass')
    expect(reauthOpen()).toBe(false)
    expect(error).toHaveBeenCalledTimes(1)
    expect(String((error.mock.calls[0]![0] as { message: string }).message)).toContain('暫停 15 分鐘')
  })
})
