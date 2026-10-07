// 2026-10-06 方向 D：底部動作列直接寫「草稿有 N 處修改：欄位A、欄位B」，發布確認框只寫欄位名；
// 核准並發布照舊列改前→改後；讀不到官網版時退回舊的差異框。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { computed, defineComponent, nextTick, ref, type VNode } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import ElementPlus, { ElMessageBox } from 'element-plus'
import ContentEditor from '../components/ContentEditor.vue'
import editorSource from '../components/ContentEditor.vue?raw'
import { draftSummary, fieldList, SUMMARY_MAX_FIELDS } from '../composables/draftSummary'
import type { ContentEditorState, DraftBaseline, FieldChange } from '../composables/useContentItem'
import { useAuthStore } from '../stores/auth'
import type { Role } from '../api/types'
import { testUser } from './fixtures'

const wrappers: VueWrapper[] = []
afterEach(() => {
  wrappers.forEach((w) => w.unmount())
  wrappers.length = 0
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

const change = (key: string, label: string, before = '舊', after = '新'): FieldChange => ({ key, label, before, after })
const baseline = (source: DraftBaseline['source'], payload: Record<string, unknown> | null = {}) => computed<DraftBaseline>(() => ({ source, payload }))

function editorState(overrides: Partial<ContentEditorState> = {}): ContentEditorState {
  return {
    loading: ref(false), loadError: ref(null), saving: ref(false), publishing: ref(false), isPublished: ref(false),
    isDirty: computed(() => false), neverPublished: computed(() => false), latestRevisionAt: computed(() => '2026-10-06T02:00:00Z'),
    load: async () => {}, save: async () => true, saveAndPublish: async () => true, reset: () => {},
    ...overrides,
  }
}

async function mountEditor(editor: ContentEditorState, role: Role = 'super_admin') {
  const pinia = createPinia()
  useAuthStore(pinia).user = testUser(role)
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: defineComponent({ template: '<div />' }) }] })
  await router.push('/')
  await router.isReady()
  const wrapper = mount(ContentEditor, { props: { editor }, global: { plugins: [pinia, router, ElementPlus] }, attachTo: document.body })
  wrappers.push(wrapper)
  await flushPromises()
  return wrapper
}

function messageText(message: unknown): string {
  if (typeof message === 'string') return message
  const wrapper = mount(defineComponent({ render: () => message as VNode }))
  const text = wrapper.text()
  wrapper.unmount()
  return text
}

function button(wrapper: VueWrapper, text: string) {
  const found = wrapper.findAll('button').find((b) => b.text().trim() === text)
  if (!found) throw new Error(`找不到按鈕：${text}`)
  return found
}

describe('draftSummary', () => {
  it('和官網比：草稿有 N 處修改，最多列 4 個欄位名，完整清單放 title', () => {
    const five = ['參觀專線', '封面照片', '地址', '校名', '行政區'].map((label, i) => change(`k${i}`, label))
    expect(SUMMARY_MAX_FIELDS).toBe(4)
    expect(draftSummary('live', five.slice(0, 2), false)).toEqual({ lead: '草稿有 2 處修改：', fields: '參觀專線、封面照片', title: '參觀專線、封面照片' })
    expect(fieldList(five)).toBe('參觀專線、封面照片、地址、校名…')
    expect(draftSummary('live', five, false)!.title).toBe('參觀專線、封面照片、地址、校名、行政區')
  })

  it('和官網一樣：沒修改不寫；有修改但改回官網的值時講明還沒儲存', () => {
    expect(draftSummary('live', [], false)).toBeNull()
    expect(draftSummary('live', [], true)!.lead).toBe('內容和官網目前的一樣，還沒儲存。')
  })

  it('從沒發布過、讀不到官網版各有說法', () => {
    expect(draftSummary('first', [], false)!.lead).toBe('還沒發布過，發布後家長才會看到這份內容。')
    // 沒有發布權的內容編輯只能送審，說法跟著 actionNote。
    expect(draftSummary('first', [], false, false)!.lead).toBe('還沒發布過，送審核准後家長才會看到這份內容。')
    expect(draftSummary('saved', [change('tagline', '標語')], true)).toEqual({ lead: '改了 1 個欄位：', fields: '標語', title: '標語' })
    expect(draftSummary('saved', [], true)!.lead).toBe('有未儲存的修改。')
    expect(draftSummary('saved', [], false)).toBeNull()
  })
})

describe('動作列', () => {
  it('沒有未儲存的修改，但草稿和官網不同：照樣寫出欄位（暖黃字），title 是完整清單', async () => {
    const wrapper = await mountEditor(editorState({
      draftBaseline: baseline('live'),
      draftChanges: computed(() => [change('phone', '參觀專線'), change('cover', '封面照片')]),
    }))
    const actions = wrapper.get('.editor__actions')
    expect(actions.classes()).toContain('has-changes')
    expect(actions.get('.editor__actions-text').text()).toBe('草稿有 2 處修改：參觀專線、封面照片')
    expect(actions.get('.editor__actions-text').attributes('title')).toBe('參觀專線、封面照片')
    expect(actions.find('.editor__actions-note').exists()).toBe(false)
  })

  it('和官網一樣、沒有修改：照舊寫儲存與發布的說明', async () => {
    const wrapper = await mountEditor(editorState({ draftBaseline: baseline('live'), draftChanges: computed(() => []) }))
    expect(wrapper.get('.editor__actions').classes()).not.toContain('has-changes')
    expect(wrapper.get('.editor__actions-note').text()).toBe('儲存草稿不會更動官網，發布後才會公開。')
  })

  it('手機也顯示摘要；摘要單行、超出省略', () => {
    const mobile = editorSource.slice(editorSource.indexOf('@media (max-width: 720px)'))
    expect(mobile).toContain('.editor__actions:not(.is-dirty):not(.is-busy):not(.has-changes) .editor__actions-state { display: none; }')
    expect(editorSource).toMatch(/\.editor__actions-text \{[^}]*text-overflow: ellipsis;/)
  })

  it('摘要欄的 flex-basis 是 0%：用 auto 的話長文字會把按鈕擠到第二列、省略號不生效', () => {
    expect(editorSource).toMatch(/\.editor__actions-state \{[^}]*flex: 1 1 0%;/)
    expect(editorSource).not.toMatch(/\.editor__actions-state \{[^}]*flex: 1 1 auto;/)
  })

  it('從沒發布過：能發布的人寫「發布後」，只能送審的內容編輯寫「送審核准後」', async () => {
    const state = () => editorState({ draftBaseline: baseline('first', null), draftChanges: computed(() => []) })
    const publisher = await mountEditor(state(), 'campus_admin')
    expect(publisher.get('.editor__actions-text').text()).toBe('還沒發布過，發布後家長才會看到這份內容。')
    const editor = await mountEditor(state(), 'editor')
    expect(editor.get('.editor__actions-text').text()).toBe('還沒發布過，送審核准後家長才會看到這份內容。')
  })
})

describe('動作列：官網版還在讀', () => {
  it('讀取中不寫差異字樣（不寫「N 處」、也不寫「和官網一樣」），保持原本的說明；讀完才寫', async () => {
    const liveReading = ref(true)
    const wrapper = await mountEditor(editorState({
      draftBaseline: baseline('live'),
      draftChanges: computed(() => [change('phone', '參觀專線'), change('cover', '封面照片')]),
      liveReading,
    }))
    const actions = wrapper.get('.editor__actions')
    expect(actions.classes()).not.toContain('has-changes')
    expect(actions.get('.editor__actions-text').text()).toBe('儲存草稿不會更動官網，發布後才會公開。')
    liveReading.value = false
    await nextTick()
    expect(actions.classes()).toContain('has-changes')
    expect(actions.get('.editor__actions-text').text()).toBe('草稿有 2 處修改：參觀專線、封面照片')
  })

  it('讀取中又有未儲存的修改：只說有未儲存的修改，不寫和官網比的結果', async () => {
    const wrapper = await mountEditor(editorState({
      isDirty: computed(() => true),
      draftBaseline: baseline('live'),
      draftChanges: computed(() => []),
      liveReading: ref(true),
    }))
    const text = wrapper.get('.editor__actions-text').text()
    expect(text).toBe('有未儲存的修改。')
    expect(text).not.toContain('和官網')
  })

  it('讀不到官網版（liveReading 已經是 false、基準 saved）不算讀取中，照舊和上次儲存比', async () => {
    const wrapper = await mountEditor(editorState({
      isDirty: computed(() => true),
      draftBaseline: baseline('saved'),
      draftChanges: computed(() => [change('tagline', '標語')]),
      liveReading: ref(false),
    }))
    expect(wrapper.get('.editor__actions-text').text()).toBe('改了 1 個欄位：標語')
  })
})

describe('發布確認框', () => {
  it('知道官網版：只寫欄位名，不列改前→改後，也不再讀官網版', async () => {
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue('cancel')
    const compareWithLive = vi.fn(async () => null)
    const wrapper = await mountEditor(editorState({
      draftBaseline: baseline('live'),
      draftChanges: computed(() => [change('title', '標題', '舊標題', '新標題')]),
      compareWithLive,
    }))
    await button(wrapper, '發布到官網').trigger('click')
    await flushPromises()
    const [message, , options] = confirm.mock.calls[0]!
    const text = messageText(message)
    expect(text).toContain('和官網目前的內容相比，會更新 1 個欄位：標題。發布後家長立刻看到。')
    expect(text).not.toContain('舊標題')
    expect(compareWithLive).not.toHaveBeenCalled()
    expect((options as { customClass?: string }).customClass).toBeUndefined()
  })

  it('從沒發布過：照舊說第一次上線', async () => {
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue('cancel')
    const wrapper = await mountEditor(editorState({ draftBaseline: baseline('first', null), draftChanges: computed(() => []) }))
    await button(wrapper, '發布到官網').trigger('click')
    await flushPromises()
    expect(messageText(confirm.mock.calls[0]![0])).toContain('這是第一次上線')
  })

  it('讀不到官網版（saved）：退回舊的差異框，列改前→改後', async () => {
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue('cancel')
    const compareWithLive = vi.fn(async () => ({ firstPublish: false, changes: [change('title', '標題', '舊標題', '新標題')] }))
    const wrapper = await mountEditor(editorState({ draftBaseline: baseline('saved'), draftChanges: computed(() => []), compareWithLive }))
    await button(wrapper, '發布到官網').trigger('click')
    await flushPromises()
    expect(compareWithLive).toHaveBeenCalledOnce()
    expect(messageText(confirm.mock.calls[0]![0])).toContain('舊標題')
  })

  it('核准並發布照舊列完整差異（核准的人不是改的人）', async () => {
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue('cancel')
    const compareWithLive = vi.fn(async () => ({ firstPublish: false, changes: [change('title', '標題', '舊標題', '新標題')] }))
    const wrapper = await mountEditor(editorState({
      reviewStatus: computed(() => 'pending_review'),
      review: async () => true,
      draftBaseline: baseline('live'),
      draftChanges: computed(() => [change('title', '標題', '舊標題', '新標題')]),
      compareWithLive,
    }))
    await button(wrapper, '核准並發布').trigger('click')
    await flushPromises()
    expect(compareWithLive).toHaveBeenCalledOnce()
    expect(messageText(confirm.mock.calls[0]![0])).toContain('舊標題')
  })
})
