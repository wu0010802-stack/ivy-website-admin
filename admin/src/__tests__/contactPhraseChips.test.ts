// 聯絡片語（2026-10-12 規格 4.2）：輸入框上方的片語 chip、附加規則與共用快取。
// 管理頁另見 contactPhrasesView.test.ts；案件時間線與招生記錄聯絡的接線在各自的測試檔。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { defineComponent, h, ref } from 'vue'
import { ElInput, type InputInstance } from 'element-plus'
import ContactPhraseChips from '../components/ContactPhraseChips.vue'
import { api } from '../api/client'
import { appendPhrase, invalidateContactPhrases, usePhraseInsert } from '../composables/useContactPhrases'
import { campusAdmin, cleanup, mountWith, reception } from './admissionsTestKit'
import { testUser } from './fixtures'

const PHRASES = ['已致電，家長沒接', '已加 LINE，等家長回覆']
const phrasesOut = (phrases = PHRASES) => ({ phrases, version: 1, updated_at: null, updated_by_name: null })

beforeEach(() => invalidateContactPhrases())
afterEach(() => cleanup())

function phraseCalls(get: { mock: { calls: unknown[][] } }) {
  return get.mock.calls.filter(([path]) => path === '/admin/contact-phrases')
}

describe('appendPhrase', () => {
  it('輸入框空白，或只有空白：直接帶入', () => {
    expect(appendPhrase('', 'A')).toBe('A')
    expect(appendPhrase('  ', 'A')).toBe('A')
    expect(appendPhrase(' \n ', 'A')).toBe('A')
  })

  it('已有字、結尾不是標點：先補「，」再接上', () => {
    expect(appendPhrase('已致電', 'A')).toBe('已致電，A')
  })

  it('結尾多的空白不算：「已致電 」接成「已致電，A」；結尾已換行就直接接在新的一行', () => {
    expect(appendPhrase('已致電 ', 'A')).toBe('已致電，A')
    expect(appendPhrase('已致電。　', 'A')).toBe('已致電。A')
    expect(appendPhrase('第一行\n', 'A')).toBe('第一行\nA')
  })

  it('結尾是標點：直接接上，不重複補', () => {
    for (const mark of '，。、！？；：,.!?;:') expect(appendPhrase(`已致電${mark}`, 'A')).toBe(`已致電${mark}A`)
  })
})

describe('片語 chip 列', () => {
  it('每句一顆按鈕，包在有名稱的群組裡；點一下送出那一句', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(phrasesOut() as never)
    const { wrapper } = await mountWith(ContactPhraseChips)
    const group = wrapper.get('[role="group"]')
    expect(group.attributes('aria-label')).toBe('常用片語')
    const buttons = group.findAll('button')
    expect(buttons.map((b) => b.text())).toEqual(PHRASES)
    expect(buttons.every((b) => b.attributes('type') === 'button')).toBe(true)
    await buttons[1]!.trigger('click')
    expect(wrapper.emitted('pick')).toEqual([[PHRASES[1]]])
  })

  it('讀取失敗：整列不渲染，也不丟錯', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(new Error('boom'))
    const { wrapper } = await mountWith(ContactPhraseChips)
    expect(wrapper.find('[role="group"]').exists()).toBe(false)
    expect(wrapper.html()).not.toContain('button')
  })

  it('沒有片語（或回應不是預期的形狀）：整列不渲染', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(phrasesOut([]) as never)
    const empty = await mountWith(ContactPhraseChips)
    expect(empty.wrapper.find('[role="group"]').exists()).toBe(false)
    cleanup()
    invalidateContactPhrases()
    // 其他測試常把沒對到的路徑回成 [] 或別的物件
    vi.spyOn(api, 'get').mockResolvedValue([] as never)
    const odd = await mountWith(ContactPhraseChips)
    expect(odd.wrapper.find('[role="group"]').exists()).toBe(false)
  })

  it('同一頁兩個元件只發一次 GET；清掉快取後再掛會重新讀', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue(phrasesOut() as never)
    const Both = defineComponent({ render: () => h('div', [h(ContactPhraseChips), h(ContactPhraseChips)]) })
    const { wrapper } = await mountWith(Both)
    expect(wrapper.findAll('[role="group"]')).toHaveLength(2)
    expect(phraseCalls(get)).toHaveLength(1)

    const later = await mountWith(ContactPhraseChips)
    expect(later.wrapper.findAll('button')).toHaveLength(2)
    expect(phraseCalls(get)).toHaveLength(1)

    invalidateContactPhrases()
    await mountWith(ContactPhraseChips)
    expect(phraseCalls(get)).toHaveLength(2)
  })

  it('讀取失敗不留在快取裡：下次掛載會再試一次', async () => {
    const get = vi.spyOn(api, 'get').mockRejectedValueOnce(new Error('boom')).mockResolvedValue(phrasesOut() as never)
    const first = await mountWith(ContactPhraseChips)
    expect(first.wrapper.find('[role="group"]').exists()).toBe(false)
    const second = await mountWith(ContactPhraseChips)
    expect(second.wrapper.findAll('button')).toHaveLength(2)
    expect(phraseCalls(get)).toHaveLength(2)
  })

  it('沒有 contact_phrases.read 的帳號（內容編輯）不發請求、不渲染', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue(phrasesOut() as never)
    const { wrapper } = await mountWith(ContactPhraseChips, { user: testUser('editor', { id: 'ed', email: 'ed@example.invalid' }) })
    expect(wrapper.find('[role="group"]').exists()).toBe(false)
    expect(phraseCalls(get)).toHaveLength(0)
  })

  it('接待人員與分校管理者讀得到', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue(phrasesOut() as never)
    expect((await mountWith(ContactPhraseChips, { user: reception() })).wrapper.findAll('button')).toHaveLength(2)
    expect((await mountWith(ContactPhraseChips, { user: campusAdmin() })).wrapper.findAll('button')).toHaveLength(2)
    expect(phraseCalls(get)).toHaveLength(1)
  })
})

describe('點 chip 帶入輸入框', () => {
  // 跟案件時間線、招生記錄聯絡同一種接法：textarea 的 v-model 加上 usePhraseInsert。
  const Host = defineComponent({
    props: { initial: { type: String, default: '' }, maxLength: { type: Number, default: 0 } },
    setup(props) {
      const text = ref(props.initial)
      const input = ref<InputInstance>()
      const pick = usePhraseInsert(() => text.value, (value) => { text.value = value }, input, { maxLength: props.maxLength || undefined })
      return () => h('div', [
        h(ContactPhraseChips, { onPick: pick }),
        h(ElInput, { ref: input, modelValue: text.value, 'onUpdate:modelValue': (v: string) => { text.value = v }, type: 'textarea' }),
      ])
    },
  })

  const textareaOf = (wrapper: { get: (selector: string) => { element: Element } }) => wrapper.get('textarea').element as HTMLTextAreaElement

  it('空白時直接帶入；游標在結尾，焦點在輸入框', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(phrasesOut() as never)
    const { wrapper } = await mountWith(Host)
    await wrapper.findAll('button')[0]!.trigger('click')
    await flushPromises()
    const textarea = textareaOf(wrapper)
    expect(textarea.value).toBe(PHRASES[0])
    expect(document.activeElement).toBe(textarea)
    expect(textarea.selectionStart).toBe(PHRASES[0]!.length)
    expect(textarea.selectionEnd).toBe(PHRASES[0]!.length)
  })

  it('已有字就補「，」再接；連點兩句依序接在後面，游標一直在結尾', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(phrasesOut() as never)
    const { wrapper } = await mountWith(Host, { props: { initial: '下午再打' } })
    await wrapper.findAll('button')[0]!.trigger('click')
    await flushPromises()
    await wrapper.findAll('button')[1]!.trigger('click')
    await flushPromises()
    const textarea = textareaOf(wrapper)
    expect(textarea.value).toBe(`下午再打，${PHRASES[0]}，${PHRASES[1]}`)
    expect(textarea.selectionStart).toBe(textarea.value.length)
  })

  it('放不下的時候不插入、說明原因', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(phrasesOut() as never)
    const initial = '字'.repeat(995)
    const { wrapper } = await mountWith(Host, { props: { initial, maxLength: 1000 } })
    await wrapper.findAll('button')[0]!.trigger('click')
    await flushPromises()
    expect(textareaOf(wrapper).value).toBe(initial)
    expect(document.body.textContent).toContain('字數已達上限')
  })
})
