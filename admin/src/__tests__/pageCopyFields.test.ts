import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h, ref, type Component, type Ref } from 'vue'
import ElementPlus, { ElForm } from 'element-plus'
import PageCopyField from '../components/PageCopyField.vue'
import PagePhotoField from '../components/PagePhotoField.vue'
import MediaSlotField from '../components/MediaSlotField.vue'
import { resetTitleFontCoverage, TITLE_FONT_FILES } from '../composables/useTitleFontCoverage'
import type { MediaAssetOut, MediaSlotPayload } from '../api/types'

const wrappers: VueWrapper[] = []
function mockCharsets(bd: string) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) =>
    (String(input).endsWith(`/assets/fonts/${TITLE_FONT_FILES.bd}`) ? new Response(bd) : new Response('', { status: 404 })) as never)
}
beforeEach(() => resetTitleFontCoverage())
afterEach(() => {
  wrappers.forEach((w) => w.unmount())
  wrappers.length = 0
  vi.restoreAllMocks()
  resetTitleFontCoverage()
})

/** 包在 el-form 裡掛載（el-form-item 需要），render function 寫法。 */
function mountInForm(render: () => ReturnType<typeof h>) {
  const wrapper = mount(defineComponent({ setup: () => () => h(ElForm, null, { default: render }) }), {
    global: { plugins: [ElementPlus], stubs: { MediaSlotField: true } },
  })
  wrappers.push(wrapper)
  return wrapper
}

function copyField(value: Ref<string>, props: Record<string, unknown>) {
  return mountInForm(() => h(PageCopyField as Component, { ...props, modelValue: value.value, 'onUpdate:modelValue': (v: string) => { value.value = v } }))
}

function photoField(photo: Ref<MediaSlotPayload | null | undefined>, alt: Ref<string | undefined>, props: Record<string, unknown>) {
  return mountInForm(() => h(PagePhotoField as Component, {
    ...props,
    photo: photo.value,
    'onUpdate:photo': (v: MediaSlotPayload | null | undefined) => { photo.value = v },
    alt: alt.value,
    'onUpdate:alt': (v: string | undefined) => { alt.value = v },
  }))
}

describe('PageCopyField', () => {
  it('標題欄位：可以換行、顯示建議字數與缺字提示', async () => {
    mockCharsets('從動手做開始愛上學習，。')
    const value = ref('從動手做開始，\n愛上學習。')
    const wrapper = copyField(value, { label: '首屏大標', hint: 'curHeroTitle', title: true })
    await flushPromises()
    expect(wrapper.find('textarea').exists()).toBe(true)
    expect(wrapper.text()).toContain('按 Enter 換行')
    expect(wrapper.find('.glyph-hint').exists()).toBe(false)
    await wrapper.find('textarea').setValue('從動手做開始，\n愛上學習𠮷')
    await flushPromises()
    expect(value.value).toBe('從動手做開始，\n愛上學習𠮷')
    expect(wrapper.find('.glyph-hint').text()).toContain('「𠮷」')
  })

  it('一般欄位：按 Enter 不會換行，也不提示缺字', async () => {
    mockCharsets('')
    const value = ref('一句話')
    const wrapper = copyField(value, { label: '首屏介紹', hint: 'curLede', multiline: true })
    await flushPromises()
    const event = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true, bubbles: true })
    wrapper.find('textarea').element.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(wrapper.find('.glyph-hint').exists()).toBe(false)
  })

  it('輸入法選字的 Enter 不被擋，一般 Enter 才被擋', async () => {
    mockCharsets('')
    const wrapper = copyField(ref('一句話'), { label: '首屏介紹', hint: 'curLede', multiline: true })
    await flushPromises()
    const textarea = wrapper.find('textarea').element
    const composing = new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, cancelable: true, bubbles: true })
    textarea.dispatchEvent(composing)
    expect(composing.defaultPrevented).toBe(false)
    const legacy = new KeyboardEvent('keydown', { key: 'Enter', keyCode: 229, cancelable: true, bubbles: true })
    textarea.dispatchEvent(legacy)
    expect(legacy.defaultPrevented).toBe(false)
    const plain = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true, bubbles: true })
    textarea.dispatchEvent(plain)
    expect(plain.defaultPrevented).toBe(true)
  })
})

describe('PagePhotoField', () => {
  const asset = (id: string, alt: string) => ({ id, alt_text: alt }) as MediaAssetOut
  const previews = [{ label: '桌機（4:5）', ratio: '4 / 5' }, { label: '手機與平板（4:3）', ratio: '4 / 3' }]
  const base = { label: '首屏照片', builtin: '官網內建照片', builtinSrc: '/assets/cur-hero.webp', previews, help: '換照片後記得確認焦點' }

  it('選了照片才出現說明欄，說明帶入素材庫的說明；改回內建時清空', async () => {
    const photo = ref<MediaSlotPayload | null | undefined>(undefined)
    const alt = ref<string | undefined>(undefined)
    const wrapper = photoField(photo, alt, base)
    expect(wrapper.text()).not.toContain('首屏照片說明')
    const slot = wrapper.findComponent(MediaSlotField)
    slot.vm.$emit('update:modelValue', { media_id: 'a', focus_x: null, focus_y: null })
    slot.vm.$emit('picked', asset('a', '孩子在畫畫'), null)
    await flushPromises()
    expect(alt.value).toBe('孩子在畫畫')
    expect(wrapper.text()).toContain('首屏照片說明')
    slot.vm.$emit('update:modelValue', null)
    slot.vm.$emit('cleared')
    await flushPromises()
    expect(alt.value).toBe('')
    expect(wrapper.text()).not.toContain('首屏照片說明')
  })

  it('換成另一張照片時說明換成新照片的，不留舊照片的說明', async () => {
    const photo = ref<MediaSlotPayload | null | undefined>({ media_id: 'a', focus_x: null, focus_y: null })
    const alt = ref<string | undefined>('舊照片的說明')
    const wrapper = photoField(photo, alt, { ...base, label: '照片' })
    wrapper.findComponent(MediaSlotField).vm.$emit('picked', asset('b', ''), 'a')
    await flushPromises()
    expect(alt.value).toBe('')
  })

  it('焦點預覽照傳入的各版位比例（桌機、手機分開）；no-focus 時不給焦點', () => {
    const withFocus = photoField(ref(undefined), ref(undefined), base)
    expect(withFocus.findComponent(MediaSlotField).props('focusPreviews')).toEqual(previews)
    const noFocus = photoField(ref(undefined), ref(undefined), { ...base, noFocus: true })
    expect(noFocus.findComponent(MediaSlotField).props('focus')).toBe(false)
    expect(noFocus.findComponent(MediaSlotField).props('focusPreviews')).toEqual([])
  })
})
