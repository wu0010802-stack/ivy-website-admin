// 聯絡片語管理頁（2026-10-12 規格 4.2）：總管理者維護全站一份的片語清單。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import ContactPhrasesView from '../views/ContactPhrasesView.vue'
import ContactPhraseChips from '../components/ContactPhraseChips.vue'
import { ApiError, api } from '../api/client'
import type { ContactPhrasesOut } from '../api/types'
import { hasUnsavedChanges } from '../composables/useUnsavedChanges'
import { invalidateContactPhrases } from '../composables/useContactPhrases'
import { authGuard, routes } from '../router'
import { canListNavItem, canOpenPath, navItem, NAV_GROUPS } from '../router/nav'
import { useAuthStore } from '../stores/auth'
import { campusAdmin, cleanup, mountWith, reception } from './admissionsTestKit'
import { testUser } from './fixtures'

const DEFAULTS = ['已致電，家長沒接', '已致電，轉語音信箱', '已加 LINE，等家長回覆']

function out(overrides: Partial<ContactPhrasesOut> = {}): ContactPhrasesOut {
  return { phrases: [...DEFAULTS], version: 3, updated_at: '2026-10-10T02:30:00Z', updated_by_name: '怡君', ...overrides }
}

beforeEach(() => invalidateContactPhrases())
afterEach(() => cleanup())

async function mountPage(data: ContactPhrasesOut = out()) {
  const get = vi.spyOn(api, 'get').mockResolvedValue(data as never)
  const mounted = await mountWith(ContactPhrasesView, { path: '/contact-phrases' })
  return { ...mounted, get }
}

const inputs = (wrapper: VueWrapper) => wrapper.findAll<HTMLInputElement>('li.phrase-row input')
const values = (wrapper: VueWrapper) => inputs(wrapper).map((input) => input.element.value)
const button = (wrapper: VueWrapper, label: string) => wrapper.findAll('button').find((b) => b.text() === label || b.attributes('aria-label') === label)

async function typeInto(wrapper: VueWrapper, index: number, text: string) {
  await inputs(wrapper)[index]!.setValue(text)
}

describe('載入與顯示', () => {
  it('每句一列：輸入框 60 字上限並顯示字數，標示第幾句；頁首只有一句說明', async () => {
    const { wrapper, get } = await mountPage()
    expect(get).toHaveBeenCalledWith('/admin/contact-phrases')
    expect(values(wrapper)).toEqual(DEFAULTS)
    for (const [index, input] of inputs(wrapper).entries()) {
      expect(input.attributes('maxlength')).toBe('60')
      expect(input.attributes('aria-label')).toBe(`第 ${index + 1} 句`)
    }
    expect(wrapper.text()).toContain('8 / 60')
    expect(wrapper.get('.page-header__lead').text()).toContain('點一下帶入')
  })

  it('顯示最後修改的人與時間；預設片語（沒人改過）不顯示這一行', async () => {
    const edited = await mountPage()
    expect(edited.wrapper.get('.phrases__meta').text()).toMatch(/^最後修改：怡君・/)
    cleanup()
    const fresh = await mountPage(out({ updated_at: null, updated_by_name: null, version: 1 }))
    expect(fresh.wrapper.find('.phrases__meta').exists()).toBe(false)
  })

  it('沒有片語時說明輸入框上方不會出現這一列，仍可新增', async () => {
    const { wrapper } = await mountPage(out({ phrases: [] }))
    expect(wrapper.text()).toContain('目前沒有片語')
    expect(button(wrapper, '新增一句')!.attributes('disabled')).toBeUndefined()
  })

  it('讀取失敗：說明原因、可以重新載入，不顯示空清單', async () => {
    const get = vi.spyOn(api, 'get').mockRejectedValueOnce(new Error('boom')).mockResolvedValue(out() as never)
    const { wrapper } = await mountWith(ContactPhrasesView, { path: '/contact-phrases' })
    expect(wrapper.text()).toContain('無法讀取聯絡片語')
    expect(wrapper.find('li.phrase-row').exists()).toBe(false)
    await button(wrapper, '重新載入')!.trigger('click')
    await flushPromises()
    expect(get).toHaveBeenCalledTimes(2)
    expect(values(wrapper)).toEqual(DEFAULTS)
  })
})

describe('編輯清單', () => {
  it('新增一句：加在最後、焦點移到新的輸入框', async () => {
    const { wrapper } = await mountPage()
    await button(wrapper, '新增一句')!.trigger('click')
    await flushPromises()
    expect(values(wrapper)).toEqual([...DEFAULTS, ''])
    expect(document.activeElement).toBe(inputs(wrapper)[3]!.element)
  })

  it('刪除：aria-label 寫明是哪一句', async () => {
    const { wrapper } = await mountPage()
    const remove = button(wrapper, '刪除第 2 句「已致電，轉語音信箱」')
    expect(remove).toBeDefined()
    await remove!.trigger('click')
    expect(values(wrapper)).toEqual([DEFAULTS[0], DEFAULTS[2]])
  })

  it('上移、下移：交換位置，第一句不能上移、最後一句不能下移，焦點跟著那一句', async () => {
    const { wrapper } = await mountPage()
    expect(button(wrapper, '上移第 1 句「已致電，家長沒接」')!.attributes('disabled')).toBeDefined()
    expect(button(wrapper, '下移第 3 句「已加 LINE，等家長回覆」')!.attributes('disabled')).toBeDefined()

    await button(wrapper, '下移第 1 句「已致電，家長沒接」')!.trigger('click')
    await flushPromises()
    expect(values(wrapper)).toEqual([DEFAULTS[1], DEFAULTS[0], DEFAULTS[2]])
    expect((document.activeElement as HTMLElement).getAttribute('aria-label')).toBe('下移第 2 句「已致電，家長沒接」')

    await button(wrapper, '上移第 3 句「已加 LINE，等家長回覆」')!.trigger('click')
    await flushPromises()
    expect(values(wrapper)).toEqual([DEFAULTS[1], DEFAULTS[2], DEFAULTS[0]])
  })

  it('20 句時新增鈕停用並寫出原因；刪掉一句又可以新增', async () => {
    const twenty = Array.from({ length: 20 }, (_, i) => `片語${i + 1}`)
    const { wrapper } = await mountPage(out({ phrases: twenty }))
    expect(button(wrapper, '新增一句')!.attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('最多 20 句')
    await button(wrapper, '刪除第 20 句「片語20」')!.trigger('click')
    expect(button(wrapper, '新增一句')!.attributes('disabled')).toBeUndefined()
  })

  it('有改動才能儲存；有未存的修改時離開頁面會被攔', async () => {
    const { wrapper } = await mountPage()
    expect(button(wrapper, '儲存')!.attributes('disabled')).toBeDefined()
    expect(hasUnsavedChanges()).toBe(false)
    await typeInto(wrapper, 0, '已致電，家長沒接，改天再打')
    expect(button(wrapper, '儲存')!.attributes('disabled')).toBeUndefined()
    expect(hasUnsavedChanges()).toBe(true)
    // 改回原樣就不算修改
    await typeInto(wrapper, 0, DEFAULTS[0]!)
    expect(hasUnsavedChanges()).toBe(false)
  })
})

describe('儲存', () => {
  it('送出 { phrases, expected_version }；成功後以回應為準、清掉快取、不再有未存的修改', async () => {
    const { wrapper, get } = await mountPage()
    await button(wrapper, '新增一句')!.trigger('click')
    await typeInto(wrapper, 3, '  家長想再看看  ')
    await button(wrapper, '下移第 1 句「已致電，家長沒接」')!.trigger('click')
    const saved = out({ phrases: [DEFAULTS[1]!, DEFAULTS[0]!, DEFAULTS[2]!, '家長想再看看'], version: 4, updated_by_name: '管理者' })
    const put = vi.spyOn(api, 'put').mockResolvedValue(saved as never)

    await button(wrapper, '儲存')!.trigger('click')
    await flushPromises()

    expect(put).toHaveBeenCalledTimes(1)
    expect(put).toHaveBeenCalledWith('/admin/contact-phrases', {
      phrases: [DEFAULTS[1], DEFAULTS[0], DEFAULTS[2], '家長想再看看'],
      expected_version: 3,
    })
    expect(values(wrapper)).toEqual(saved.phrases)
    expect(wrapper.get('.phrases__meta').text()).toContain('管理者')
    expect(hasUnsavedChanges()).toBe(false)
    expect(button(wrapper, '儲存')!.attributes('disabled')).toBeDefined()
    expect(document.body.textContent).toContain('已儲存')
    // 輸入框上方的 chip 下次掛載要讀新的
    const before = get.mock.calls.length
    get.mockResolvedValue(saved as never)
    const chips = await mountWith(ContactPhraseChips)
    expect(get.mock.calls.length).toBe(before + 1)
    expect(chips.wrapper.findAll('button').map((b) => b.text())).toEqual(saved.phrases)
  })

  it('清空成 0 句也能存（輸入框上方不顯示這一列）', async () => {
    const { wrapper } = await mountPage(out({ phrases: ['只有一句'] }))
    await button(wrapper, '刪除第 1 句「只有一句」')!.trigger('click')
    const put = vi.spyOn(api, 'put').mockResolvedValue(out({ phrases: [], version: 4 }) as never)
    await button(wrapper, '儲存')!.trigger('click')
    await flushPromises()
    expect(put).toHaveBeenCalledWith('/admin/contact-phrases', { phrases: [], expected_version: 3 })
  })

  it('有空白的句子：標在那一句、不送出', async () => {
    const { wrapper } = await mountPage()
    await button(wrapper, '新增一句')!.trigger('click')
    await typeInto(wrapper, 3, '   ')
    const put = vi.spyOn(api, 'put')
    await button(wrapper, '儲存')!.trigger('click')
    await flushPromises()
    expect(put).not.toHaveBeenCalled()
    const rows = wrapper.findAll('li.phrase-row')
    expect(rows[3]!.text()).toContain('請填寫內容，或刪除這一句')
    expect(rows[0]!.text()).not.toContain('請填寫內容')
  })

  it('409：提示剛有人改過、重新載入最新版，不覆蓋', async () => {
    const { wrapper, get } = await mountPage()
    await typeInto(wrapper, 0, '我改的')
    vi.spyOn(api, 'put').mockRejectedValue(
      new ApiError(409, { code: 'CONTACT_PHRASES_VERSION_CONFLICT', message: '片語剛被其他人修改', current_version: 4 }),
    )
    get.mockResolvedValue(out({ phrases: ['別人改的'], version: 4, updated_by_name: '小美' }) as never)
    await button(wrapper, '儲存')!.trigger('click')
    await flushPromises()
    expect(document.body.textContent).toContain('剛有人改過片語，已重新載入')
    expect(values(wrapper)).toEqual(['別人改的'])
    expect(wrapper.get('.phrases__meta').text()).toContain('小美')
    expect(hasUnsavedChanges()).toBe(false)
  })

  it('422：錯誤標在對應的那一句（loc 的 0 起算要換成第幾句），其他句不受影響', async () => {
    const { wrapper } = await mountPage()
    await typeInto(wrapper, 1, '請點 javascript:alert(1)')
    vi.spyOn(api, 'put').mockRejectedValue(
      new ApiError(422, [{ loc: ['body', 'phrases', 1], msg: 'Value error, 片語不可含 javascript:', type: 'value_error' }]),
    )
    await button(wrapper, '儲存')!.trigger('click')
    await flushPromises()
    const rows = wrapper.findAll('li.phrase-row')
    expect(rows[1]!.text()).toContain('片語不可含 javascript:')
    expect(rows[1]!.classes()).toContain('is-error')
    const input = rows[1]!.get('input')
    expect(input.attributes('aria-invalid')).toBe('true')
    expect(rows[1]!.get('[role="alert"]').attributes('id')).toBe(input.attributes('aria-describedby'))
    expect(rows[0]!.get('input').attributes('aria-invalid')).toBe('false')
    expect(rows[0]!.text()).not.toContain('javascript')
    expect(rows[2]!.text()).not.toContain('javascript')
    // 修改那一句後錯誤就消失
    await typeInto(wrapper, 1, '改好了')
    expect(wrapper.findAll('li.phrase-row')[1]!.text()).not.toContain('javascript')
    // 沒有被吃掉的修改：仍是未存狀態
    expect(hasUnsavedChanges()).toBe(true)
  })

  it('422 指到整份清單（超過 20 句）：寫在清單上方，不標在某一句', async () => {
    const { wrapper } = await mountPage()
    await typeInto(wrapper, 0, '改一下')
    vi.spyOn(api, 'put').mockRejectedValue(
      new ApiError(422, [{ loc: ['body', 'phrases'], msg: 'List should have at most 20 items after validation, not 21', type: 'too_long' }]),
    )
    await button(wrapper, '儲存')!.trigger('click')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('最多 20')
  })

  it('其他錯誤（例如連線失敗）：提示儲存失敗，內容留在畫面上', async () => {
    const { wrapper } = await mountPage()
    await typeInto(wrapper, 0, '我改的')
    vi.spyOn(api, 'put').mockRejectedValue(new Error('offline'))
    await button(wrapper, '儲存')!.trigger('click')
    await flushPromises()
    expect(document.body.textContent).toContain('儲存失敗')
    expect(values(wrapper)[0]).toBe('我改的')
    expect(button(wrapper, '儲存')!.attributes('disabled')).toBeUndefined()
  })
})

describe('權限與側欄', () => {
  it('側欄「系統」分組有「聯絡片語」，路徑 /contact-phrases，搜尋得到範本、片語、聯絡', () => {
    const system = NAV_GROUPS.find((group) => group.key === 'system')!
    const item = system.items.find((i) => i.name === 'contact-phrases')!
    expect(item.title).toBe('聯絡片語')
    expect(item.path).toBe('/contact-phrases')
    expect(item.keywords).toEqual(expect.arrayContaining(['範本', '片語', '聯絡']))
    expect(item.icon).toBeTruthy()
  })

  it('只有總管理者看得到側欄項目與總覽連結；其他角色（含接待人員）看不到', () => {
    const item = navItem('contact-phrases')!
    const listed = (role: Parameters<typeof testUser>[0]) => canListNavItem(item, testUser(role), null)
    expect(listed('super_admin')).toBe(true)
    for (const role of ['campus_admin', 'reception', 'editor', 'readonly'] as const) expect(listed(role)).toBe(false)
    expect(canOpenPath('/contact-phrases', reception())).toBe(false)
    expect(canOpenPath('/contact-phrases', campusAdmin())).toBe(false)
  })

  it('直接開網址：非總管理者被導回起始頁並帶 denied，總管理者進得去', async () => {
    const router = createRouter({ history: createMemoryHistory(), routes })
    const target = router.resolve('/contact-phrases')
    expect(target.meta.title).toBe('聯絡片語')
    expect(target.meta.roles).toEqual(['super_admin'])

    setActivePinia(createPinia())
    useAuthStore().user = campusAdmin()
    const denied = await authGuard(target as never)
    expect(denied).toMatchObject({ query: { denied: 'contact-phrases' } })

    useAuthStore().user = reception()
    expect(await authGuard(target as never)).toMatchObject({ query: { denied: 'contact-phrases' } })

    useAuthStore().user = testUser('super_admin', { id: 'admin', email: 'admin@example.invalid' })
    expect(await authGuard(target as never)).toBe(true)
  })
})
