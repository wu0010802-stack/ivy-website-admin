// 2026-10-06 方向 D：後台把還沒存的表單送進預覽 iframe。握手、debounce、來源驗證、狀態。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h, isProxy, nextTick, ref, shallowRef } from 'vue'
import { LIVE_PREVIEW_DEBOUNCE_MS, LIVE_PREVIEW_READY_TIMEOUT_MS, useLivePreview } from '../composables/useLivePreview'
import { PREVIEW_MAX_DRAFT_CHARS } from '../composables/previewProtocol'
import type { PreviewTarget } from '../composables/previewTargets'

const ORIGIN = 'https://ivy.example'
const FOOTER: PreviewTarget = { id: 'footer', label: '頁尾', page: 'home', block: 'site-footer' }
const HEADER: PreviewTarget = { id: 'header', label: '頁首預約鈕', page: 'home', block: 'site-header', fields: ['cta_label'] }
const READY = { type: 'ivy-preview:ready', v: 1 }

const wrappers: VueWrapper[] = []
// 只假 setTimeout：@vue/test-utils 的 flushPromises 用 setImmediate，一起假掉會卡住。
beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }) })
afterEach(() => {
  wrappers.forEach((w) => w.unmount())
  wrappers.length = 0
  // 還原 vi.spyOn（例如 JSON.stringify），不留給下一則測試
  vi.restoreAllMocks()
  vi.useRealTimers()
})

interface SetupOptions {
  target?: PreviewTarget
  origin?: string
  enabled?: boolean
}

function setup({ target = FOOTER, origin = ORIGIN, enabled = true }: SetupOptions = {}) {
  const win = new EventTarget()
  const add = vi.spyOn(win, 'addEventListener')
  const remove = vi.spyOn(win, 'removeEventListener')
  const frameWindow = { postMessage: vi.fn() }
  const frame = shallowRef<{ contentWindow: typeof frameWindow | null } | null>({ contentWindow: frameWindow })
  const form = ref<Record<string, unknown>>({ tagline: '舊標語', cta_label: '預約參觀', copyright: '©' })
  const targetRef = shallowRef<PreviewTarget | null>(target)
  const enabledRef = ref(enabled)
  let handle!: ReturnType<typeof useLivePreview>
  const wrapper = mount(defineComponent({
    setup() {
      handle = useLivePreview({
        frame, origin, kind: 'site_footer', campusKey: ref(null), form, target: targetRef, enabled: enabledRef, win: win as never,
      })
      return () => h('div')
    },
  }))
  wrappers.push(wrapper)
  function reply(data: unknown, source: unknown = frameWindow, from = ORIGIN) {
    const event = new Event('message')
    Object.assign(event, { data, source, origin: from })
    win.dispatchEvent(event)
  }
  return { win, add, remove, frame, frameWindow, form, targetRef, enabledRef, wrapper, reply, handle: () => handle }
}

describe('useLivePreview', () => {
  it('還沒 ready 前不送；ready 後立刻送一則，targetOrigin 是預覽來源', async () => {
    const { frameWindow, form, reply, handle } = setup()
    expect(handle().state.value).toBe('connecting')
    form.value.tagline = '新標語'
    await vi.advanceTimersByTimeAsync(400)
    expect(frameWindow.postMessage).not.toHaveBeenCalled()
    reply(READY)
    expect(handle().state.value).toBe('live')
    expect(frameWindow.postMessage).toHaveBeenCalledOnce()
    const [message, targetOrigin] = frameWindow.postMessage.mock.calls[0]!
    expect(targetOrigin).toBe(ORIGIN)
    expect(message).toMatchObject({ type: 'ivy-preview:draft', v: 1, seq: 1, kind: 'site_footer', campusKey: null, page: 'home', payload: { tagline: '新標語' } })
    expect(message.focus).toEqual({ block: 'site-footer', campusKey: null, probe: null, mark: true })
  })

  it('打字 debounce 300ms：連打兩次只送一則，帶改到的文字；送的是純 JSON', async () => {
    expect(LIVE_PREVIEW_DEBOUNCE_MS).toBe(300)
    const { frameWindow, form, reply } = setup()
    reply(READY)
    frameWindow.postMessage.mockClear()
    form.value.tagline = '新'
    await nextTick()
    form.value.tagline = '新標語\n第二行'
    await vi.advanceTimersByTimeAsync(299)
    expect(frameWindow.postMessage).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(frameWindow.postMessage).toHaveBeenCalledOnce()
    const [message] = frameWindow.postMessage.mock.calls[0]!
    expect(message.seq).toBe(2)
    expect(message.focus.probe).toBe('新標語')
    expect(isProxy(message.payload)).toBe(false)
    expect(() => structuredClone(message)).not.toThrow()
  })

  it('每一則的 payload 只 JSON 複製一次（在 buildDraftMessage 裡），不先複製再複製', async () => {
    const { frameWindow, form, reply } = setup()
    const stringify = vi.spyOn(JSON, 'stringify')
    // 整份表單被序列化的次數（比對「這次改到哪裡」只序列化單一欄位，不算整份）。
    const wholeCopies = () => stringify.mock.calls.filter(([value]) => value !== null && typeof value === 'object' && 'copyright' in value).length
    reply(READY)
    expect(frameWindow.postMessage).toHaveBeenCalledOnce()
    expect(wholeCopies()).toBe(1)
    form.value.tagline = '新標語'
    await vi.advanceTimersByTimeAsync(300)
    expect(frameWindow.postMessage).toHaveBeenCalledTimes(2)
    expect(wholeCopies()).toBe(2)
  })

  it('上一則測試的 spy 已還原：JSON.stringify 還是原本的函式', () => {
    expect(vi.isMockFunction(JSON.stringify)).toBe(false)
  })

  it('別的 origin、不是這個 iframe 送來的回覆一律不理', () => {
    const { reply, handle } = setup()
    reply(READY, { postMessage: vi.fn() })
    reply(READY, undefined, 'https://evil.example')
    reply({ type: 'ivy-preview:ready', v: 9 })
    expect(handle().state.value).toBe('connecting')
    // ready 之後，別的來源也不能把狀態改掉、不能報成已套用
    reply(READY)
    expect(handle().state.value).toBe('live')
    reply({ type: 'ivy-preview:denied', v: 1 }, undefined, 'https://evil.example')
    reply({ type: 'ivy-preview:denied', v: 1 }, { postMessage: vi.fn() })
    reply({ type: 'ivy-preview:applied', v: 1, seq: 7, hit: 'text' }, { postMessage: vi.fn() })
    reply({ type: 'ivy-preview:applied', v: 1, seq: 7, hit: 'text' }, undefined, 'https://evil.example')
    expect(handle().state.value).toBe('live')
    expect(handle().appliedSeq.value).toBe(0)
  })

  it('沒有目前的 iframe（source 與 frame 同為 null）也不收', () => {
    const { frame, reply, handle } = setup()
    frame.value = null
    reply(READY, null)
    reply(READY, undefined)
    expect(handle().state.value).toBe('connecting')
  })

  it('denied → denied；20 秒沒 ready → saved，之後預覽頁補上 ready 還是接得上', async () => {
    expect(LIVE_PREVIEW_READY_TIMEOUT_MS).toBe(20_000)
    const denied = setup()
    denied.reply({ type: 'ivy-preview:denied', v: 1 })
    expect(denied.handle().state.value).toBe('denied')
    const slow = setup()
    await vi.advanceTimersByTimeAsync(19_999)
    expect(slow.handle().state.value).toBe('connecting')
    await vi.advanceTimersByTimeAsync(1)
    expect(slow.handle().state.value).toBe('saved')
    slow.reply(READY)
    expect(slow.handle().state.value).toBe('live')
    expect(slow.frameWindow.postMessage).toHaveBeenCalledOnce()
  })

  it('ready 之後不再有 20 秒逾時；denied 也會取消逾時', async () => {
    const live = setup()
    live.reply(READY)
    const denied = setup()
    denied.reply({ type: 'ivy-preview:denied', v: 1 })
    await vi.advanceTimersByTimeAsync(30_000)
    expect(live.handle().state.value).toBe('live')
    expect(denied.handle().state.value).toBe('denied')
  })

  it('applied 記下最大的 seq', () => {
    const { reply, handle } = setup()
    reply({ type: 'ivy-preview:applied', v: 1, seq: 3, hit: 'text' })
    reply({ type: 'ivy-preview:applied', v: 1, seq: 2, hit: 'block' })
    expect(handle().appliedSeq.value).toBe(3)
  })

  it('applied 的 hit 是 failed：不算已套用、不推進 appliedSeq，狀態列要說畫不出來；狀態不是 denied', () => {
    const { reply, handle } = setup()
    reply(READY)
    reply({ type: 'ivy-preview:applied', v: 1, seq: 1, hit: 'text' })
    expect(handle().appliedSeq.value).toBe(1)
    expect(handle().notice.value).toBeNull()
    reply({ type: 'ivy-preview:applied', v: 1, seq: 2, hit: 'failed' })
    expect(handle().appliedSeq.value).toBe(1)
    expect(handle().notice.value).toBe('render-failed')
    expect(handle().state.value).toBe('live')
    // 比較舊的回覆晚到，不能把「畫不出來」蓋掉
    reply({ type: 'ivy-preview:applied', v: 1, seq: 1, hit: 'text' })
    expect(handle().notice.value).toBe('render-failed')
    // 之後有一則畫得出來的，說明就收起來
    reply({ type: 'ivy-preview:applied', v: 1, seq: 3, hit: 'none' })
    expect(handle().appliedSeq.value).toBe(3)
    expect(handle().notice.value).toBeNull()
  })

  it('分頁有 fields：改到別的欄位時不框不捲；切分頁立刻送', async () => {
    const { frameWindow, form, reply, targetRef } = setup({ target: HEADER })
    reply(READY)
    form.value.copyright = '© 2026'
    await vi.advanceTimersByTimeAsync(300)
    expect(frameWindow.postMessage.mock.calls.at(-1)![0].focus).toEqual({ block: 'site-header', campusKey: null, probe: null, mark: false })
    form.value.cta_label = '預約看看'
    await vi.advanceTimersByTimeAsync(300)
    expect(frameWindow.postMessage.mock.calls.at(-1)![0].focus).toEqual({ block: 'site-header', campusKey: null, probe: '預約看看', mark: true })
    const count = frameWindow.postMessage.mock.calls.length
    targetRef.value = FOOTER
    await nextTick()
    expect(frameWindow.postMessage).toHaveBeenCalledTimes(count + 1)
    expect(frameWindow.postMessage.mock.calls.at(-1)![0].focus.block).toBe('site-footer')
  })

  it('換了 iframe（換校、重新載入）：回到 connecting，舊 iframe 的 ready 與 applied 不算', async () => {
    const { frame, frameWindow, reply, handle } = setup()
    reply(READY)
    reply({ type: 'ivy-preview:applied', v: 1, seq: 1, hit: 'text' })
    expect(handle().appliedSeq.value).toBe(1)
    const next = { postMessage: vi.fn() }
    frame.value = { contentWindow: next }
    await nextTick()
    expect(handle().state.value).toBe('connecting')
    expect(handle().appliedSeq.value).toBe(0)
    reply(READY, frameWindow)
    reply({ type: 'ivy-preview:applied', v: 1, seq: 5, hit: 'text' }, frameWindow)
    expect(handle().state.value).toBe('connecting')
    expect(handle().appliedSeq.value).toBe(0)
    expect(frameWindow.postMessage).toHaveBeenCalledOnce()
    reply(READY, next)
    expect(handle().state.value).toBe('live')
    expect(next.postMessage).toHaveBeenCalledOnce()
    // seq 不歸零，新 iframe 收到的也是比之前大的
    expect(next.postMessage.mock.calls[0]![0].seq).toBe(2)
  })

  it('換 iframe 時舊的 20 秒逾時作廢，新的重新算', async () => {
    const { frame, handle } = setup()
    await vi.advanceTimersByTimeAsync(15_000)
    frame.value = { contentWindow: { postMessage: vi.fn() } }
    await nextTick()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(handle().state.value).toBe('connecting')
    await vi.advanceTimersByTimeAsync(10_000)
    expect(handle().state.value).toBe('saved')
  })

  it('已經 ready 的 iframe 在送出之前換掉：待送的訊息不會跑去新 iframe，也不會送給舊的', async () => {
    const { frame, frameWindow, form, reply } = setup()
    reply(READY)
    frameWindow.postMessage.mockClear()
    form.value.tagline = '寫到一半'
    await nextTick()
    const swapped = { postMessage: vi.fn() }
    frame.value = { contentWindow: swapped }
    await vi.advanceTimersByTimeAsync(1_000)
    expect(swapped.postMessage).not.toHaveBeenCalled()
    expect(frameWindow.postMessage).not.toHaveBeenCalled()
  })

  it('預覽欄收起（iframe 沒了）：回到 connecting，不再送、不再收', async () => {
    const { frame, frameWindow, form, reply, handle } = setup()
    reply(READY)
    frameWindow.postMessage.mockClear()
    frame.value = null
    await nextTick()
    expect(handle().state.value).toBe('connecting')
    form.value.tagline = '新標語'
    await vi.advanceTimersByTimeAsync(30_000)
    expect(frameWindow.postMessage).not.toHaveBeenCalled()
    expect(handle().state.value).toBe('connecting')
    reply(READY, frameWindow)
    expect(handle().state.value).toBe('connecting')
  })

  it('seq 一直遞增，不管送了幾則', async () => {
    const { frameWindow, form, reply } = setup()
    reply(READY)
    for (const text of ['一二', '一二三', '一二三四']) {
      form.value.tagline = text
      await vi.advanceTimersByTimeAsync(300)
    }
    const seqs = frameWindow.postMessage.mock.calls.map(([message]) => message.seq)
    expect(seqs).toEqual([1, 2, 3, 4])
  })

  it('永遠不用 * 當 targetOrigin；來源是空字串或 * 時什麼都不送', async () => {
    const good = setup()
    good.reply(READY)
    good.form.value.tagline = '新標語'
    await vi.advanceTimersByTimeAsync(300)
    good.targetRef.value = HEADER
    await nextTick()
    expect(good.frameWindow.postMessage.mock.calls.length).toBeGreaterThan(2)
    for (const call of good.frameWindow.postMessage.mock.calls) expect(call[1]).toBe(ORIGIN)

    for (const origin of ['', '*', 'null', 'https://ivy.example/admin']) {
      const bad = setup({ origin })
      // 來源不是真的 origin，連回覆都收不進來；就算直接給 ready 也不會送
      bad.reply(READY, bad.frameWindow, origin)
      bad.form.value.tagline = '新標語'
      await vi.advanceTimersByTimeAsync(400)
      expect(bad.frameWindow.postMessage).not.toHaveBeenCalled()
    }
  })

  it('草稿太大（超過上限）就不送，說太大、狀態當成 saved；縮回去就接著送，seq 不跳號', async () => {
    const { frameWindow, form, reply, handle } = setup()
    reply(READY)
    expect(frameWindow.postMessage).toHaveBeenCalledOnce()
    form.value.tagline = 'x'.repeat(PREVIEW_MAX_DRAFT_CHARS + 1)
    await vi.advanceTimersByTimeAsync(300)
    expect(frameWindow.postMessage).toHaveBeenCalledOnce()
    expect(handle().notice.value).toBe('too-large')
    expect(handle().state.value).toBe('saved')
    form.value.tagline = '縮回去了'
    await vi.advanceTimersByTimeAsync(300)
    expect(frameWindow.postMessage).toHaveBeenCalledTimes(2)
    expect(frameWindow.postMessage.mock.calls[1]![0].seq).toBe(2)
    expect(handle().notice.value).toBeNull()
    expect(handle().state.value).toBe('live')
  })

  it('一開始就太大、轉不成 JSON：同樣不送、不丟錯', async () => {
    const huge = setup()
    huge.form.value.tagline = 'x'.repeat(PREVIEW_MAX_DRAFT_CHARS + 1)
    huge.reply(READY)
    expect(huge.frameWindow.postMessage).not.toHaveBeenCalled()
    expect(huge.handle().notice.value).toBe('too-large')
    expect(huge.handle().state.value).toBe('saved')

    const cyclic = setup()
    const loop: Record<string, unknown> = {}
    loop.self = loop
    cyclic.form.value.loop = loop
    expect(() => cyclic.reply(READY)).not.toThrow()
    expect(cyclic.frameWindow.postMessage).not.toHaveBeenCalled()
    expect(cyclic.handle().notice.value).toBe('too-large')
  })

  it('表單不是物件（還沒載入）時不送，也不當成太大', () => {
    const { frameWindow, form, reply, handle } = setup()
    ;(form as { value: unknown }).value = null
    reply(READY)
    expect(frameWindow.postMessage).not.toHaveBeenCalled()
    expect(handle().notice.value).toBeNull()
    expect(handle().state.value).toBe('live')
  })

  it('卸載後不再收訊息、不再送、計時器都清掉', async () => {
    const { reply, handle, wrapper, add, remove, form, frameWindow } = setup()
    const state = handle().state
    form.value.tagline = '寫到一半'
    await nextTick()
    wrapper.unmount()
    wrappers.length = 0
    expect(remove).toHaveBeenCalledWith('message', add.mock.calls[0]![1])
    expect(vi.getTimerCount()).toBe(0)
    reply(READY)
    expect(state.value).toBe('connecting')
    expect(frameWindow.postMessage).not.toHaveBeenCalled()
  })
})

describe('useLivePreview enabled', () => {
  it('預覽欄沒顯示（enabled=false）：不掛 message listener、不 watch 表單、不開計時器', async () => {
    const { add, form, frameWindow, reply, handle } = setup({ enabled: false })
    expect(add).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
    form.value.tagline = '新標語'
    await vi.advanceTimersByTimeAsync(30_000)
    expect(vi.getTimerCount()).toBe(0)
    reply(READY)
    expect(handle().state.value).toBe('connecting')
    expect(frameWindow.postMessage).not.toHaveBeenCalled()
  })

  it('改成 enabled 才掛上並開始握手；再關掉就拆乾淨', async () => {
    const { add, remove, enabledRef, reply, handle, frameWindow, form } = setup({ enabled: false })
    enabledRef.value = true
    await nextTick()
    expect(add).toHaveBeenCalledTimes(1)
    expect(add.mock.calls[0]![0]).toBe('message')
    reply(READY)
    expect(handle().state.value).toBe('live')
    expect(frameWindow.postMessage).toHaveBeenCalledOnce()
    form.value.tagline = '寫到一半'
    await nextTick()
    enabledRef.value = false
    await nextTick()
    expect(remove).toHaveBeenCalledWith('message', add.mock.calls[0]![1])
    expect(handle().state.value).toBe('connecting')
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(frameWindow.postMessage).toHaveBeenCalledOnce()
    reply(READY)
    expect(handle().state.value).toBe('connecting')
  })
})

// 路徑要走變數：Vite 會把字面的 new URL('…', import.meta.url) 當成素材網址改寫，讀不到檔案。
const readSource = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')

describe('預覽通訊只走 previewProtocol', () => {
  it('useLivePreview 與 ContentEditor 不手寫 postMessage、不手寫 targetOrigin * 、不自己解析回覆', () => {
    for (const relative of ['../composables/useLivePreview.ts', '../components/ContentEditor.vue']) {
      const source = readSource(relative)
      expect(source, relative).not.toMatch(/\.postMessage\s*\(/)
      expect(source, relative).not.toMatch(/['"`]\*['"`]/)
      expect(source, relative).not.toContain('parsePreviewReply')
    }
    const composable = readSource('../composables/useLivePreview.ts')
    expect(composable).toContain('sendDraftMessage(')
    expect(composable).toContain('readPreviewReply(')
    expect(composable).toContain('buildDraftMessage(')
  })
})
