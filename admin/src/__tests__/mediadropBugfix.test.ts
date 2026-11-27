// 2026-11-26 修正：素材上傳中拖放加入的檔案不會上傳，對話框卻顯示成功並關閉，
// 再開上傳框時這些檔案被清掉（園方以為 40 張都傳上去了，其實只傳了 30 張）。
// 一致的規則：上傳中不收新檔案（跟移除、清空一樣），拖放會被擋下並說明；
// 按下上傳前已經收下、還在檢查格式的檔案一定排進這一輪；還有沒傳的檔案就不算全部完成。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { computed, defineComponent } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter, matchedRouteKey } from 'vue-router'
import ElementPlus, { ElMessage } from 'element-plus'
import MediaLibraryView from '../views/MediaLibraryView.vue'
import { api } from '../api/client'
import type { MediaAssetOut, UserOut } from '../api/types'
import { resetUploadLimits, UPLOAD_CONCURRENCY, useMediaUploadQueue } from '../composables/mediaUpload'
import { useAuthStore } from '../stores/auth'
import { mediaPage, testUser } from './fixtures'

// 素材庫頁建立的上傳佇列，讓測試可以模擬「有檔案在這一輪開始後才排進來」。
const created = vi.hoisted(() => ({ queues: [] as unknown[] }))
vi.mock('../composables/mediaUpload', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../composables/mediaUpload')>()
  return {
    ...actual,
    useMediaUploadQueue: (options: Parameters<typeof actual.useMediaUploadQueue>[0]) => {
      const queue = actual.useMediaUploadQueue(options)
      created.queues.push(queue)
      return queue
    },
  }
})

const wrappers: VueWrapper[] = []
beforeEach(() => {
  resetUploadLimits()
  created.queues.length = 0
})
afterEach(() => {
  wrappers.forEach((wrapper) => wrapper.unmount())
  wrappers.length = 0
  vi.restoreAllMocks()
})

const LIMITS = {
  max_image_bytes: 15 * 1024 * 1024,
  max_video_bytes: 150 * 1024 * 1024,
  image_types: ['image/jpeg', 'image/png', 'image/webp'],
  video_types: ['video/mp4'],
  purge_delay_days: 7,
}

function asset(overrides: Partial<MediaAssetOut> = {}): MediaAssetOut {
  return {
    id: 'm1', campus_key: 'yihua', kind: 'image', status: 'ready', original_filename: 'garden.jpg', content_type: 'image/jpeg',
    size_bytes: 2048, width: 100, height: 80, duration_seconds: null, created_at: '2026-09-20T02:00:00Z',
    created_by_email: 'teacher@ivy.example', archived_at: null, deleted_at: null, purge_after: null, replaces_media_id: null,
    alt_text: null, source_attribution: null, caption: null, license_note: null, tags: [], crop_focus_x: null, crop_focus_y: null,
    processing_error: null, usage_count: 0, used_in: [], variants: [], version: 1, ...overrides,
  }
}

const jpgs = (...names: string[]) => names.map((name) => new File(['x'], name, { type: 'image/jpeg' }))

function mockGet() {
  return vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
    if (path === '/admin/media/upload-limits') return LIMITS as never
    if (path.startsWith('/admin/media?')) return mediaPage([]) as never
    return [] as never
  })
}

/** 每個上傳都等測試手動放行，才能在「上傳中」做事。 */
function holdUploads() {
  const finishers: (() => void)[] = []
  const upload = vi.spyOn(api, 'upload').mockImplementation((_path: string, form: FormData) =>
    new Promise((resolve) => finishers.push(() => resolve(asset({ id: (form.get('file') as File).name }) as never))) as never)
  async function finishAll() {
    for (let round = 0; round < 10 && finishers.length; round += 1) {
      finishers.splice(0).forEach((finish) => finish())
      await flushPromises()
    }
  }
  const names = () => upload.mock.calls.map((call) => ((call[1] as FormData).get('file') as File).name)
  return { upload, finishAll, names }
}

async function mountLibrary(user: UserOut = testUser('super_admin', { email: 'admin@ivy.example' })) {
  const pinia = createPinia()
  useAuthStore(pinia).user = user
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: defineComponent({ template: '<div />' }) }] })
  await router.push('/media')
  await router.isReady()
  const wrapper = mount(MediaLibraryView as ReturnType<typeof defineComponent>, {
    global: { plugins: [pinia, router, ElementPlus], provide: { [matchedRouteKey as symbol]: computed(() => router.currentRoute.value.matched[0]) } },
  } as never)
  wrappers.push(wrapper)
  await flushPromises()
  return wrapper
}

function pickFiles(input: Element, files: File[]) {
  Object.defineProperty(input, 'files', { value: files, configurable: true })
  input.dispatchEvent(new Event('change'))
}

function dropFiles(target: Element, files: File[]) {
  const event = new Event('drop', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'dataTransfer', { value: { files } })
  target.dispatchEvent(event)
}

const rows = (wrapper: VueWrapper) =>
  wrapper.findAll('.uploads__row').map((row) => `${row.find('.uploads__name').text()}:${row.attributes('data-status')}`)
const uploadDialog = (wrapper: VueWrapper) => wrapper.findAllComponents({ name: 'ElDialog' }).find((d) => d.props('title') === '上傳素材')!
const button = (wrapper: VueWrapper, text: string) => wrapper.findAll('button').find((b) => b.text() === text)!

describe('素材庫：上傳中拖放的檔案不能被默默略過', () => {
  it('上傳中拖放被擋下並說明，拖放區看得出停用；這一批傳完才顯示成功', async () => {
    mockGet()
    const wrapper = await mountLibrary()
    await button(wrapper, '上傳素材').trigger('click')
    await flushPromises()
    const { upload, finishAll, names } = holdUploads()
    pickFiles(wrapper.find('input[type="file"]').element, jpgs('a.jpg', 'b.jpg', 'c.jpg'))
    await flushPromises()
    await button(wrapper, '上傳 3 個檔案').trigger('click')
    await flushPromises()
    expect(upload).toHaveBeenCalledTimes(UPLOAD_CONCURRENCY)

    const warning = vi.spyOn(ElMessage, 'warning')
    const success = vi.spyOn(ElMessage, 'success')
    const drop = wrapper.find('.drop')
    dropFiles(drop.element, jpgs('d.jpg', 'e.jpg'))
    await flushPromises()
    // 沒有排進清單（排進來也不會傳），並告訴園方要等這一批傳完。
    expect(rows(wrapper).map((row) => row.split(':')[0])).toEqual(['a.jpg', 'b.jpg', 'c.jpg'])
    expect(warning).toHaveBeenCalledTimes(1)
    expect(String((warning.mock.calls[0]![0] as { message: string }).message)).toContain('傳完')

    // 上傳中：拖放區標成停用（裡面的選檔框本來就 disabled），不再寫「再加入檔案」。
    expect(drop.classes()).toContain('is-disabled')
    expect(drop.find('strong').text()).not.toBe('再加入檔案')
    expect(drop.find('strong').text()).toContain('傳完')

    await finishAll()
    expect(names()).toEqual(['a.jpg', 'b.jpg', 'c.jpg'])
    expect(success.mock.calls.map((call) => call[0])).toEqual(['已上傳 3 個檔案'])
    expect(uploadDialog(wrapper).props('modelValue')).toBe(false)
  })

  it('這一輪傳完還有等待上傳的檔案：不顯示成功、不關閉對話框，提示還有幾個沒傳', async () => {
    mockGet()
    const wrapper = await mountLibrary()
    await button(wrapper, '上傳素材').trigger('click')
    await flushPromises()
    const { finishAll, names } = holdUploads()
    pickFiles(wrapper.find('input[type="file"]').element, jpgs('a.jpg', 'b.jpg'))
    await flushPromises()
    await button(wrapper, '上傳 2 個檔案').trigger('click')
    await flushPromises()

    // 不論從哪條路，只要這一輪開始後清單裡又多了等待上傳的檔案（這裡直接塞進佇列模擬）。
    const queue = created.queues[0] as ReturnType<typeof useMediaUploadQueue>
    queue.items.value.push({ id: 999, file: jpgs('late.jpg')[0]!, kind: 'image', status: 'queued', error: null, asset: null })
    await flushPromises()

    const warning = vi.spyOn(ElMessage, 'warning')
    const success = vi.spyOn(ElMessage, 'success')
    await finishAll()
    expect(names()).toEqual(['a.jpg', 'b.jpg'])
    expect(success).not.toHaveBeenCalled()
    expect(uploadDialog(wrapper).props('modelValue')).toBe(true)
    expect(warning).toHaveBeenCalledTimes(1)
    expect(String((warning.mock.calls[0]![0] as { message: string }).message)).toContain('1 個')
    expect(rows(wrapper)).toContain('late.jpg:queued')
    // 留著的檔案可以再按一次上傳送出。
    expect(button(wrapper, '上傳 1 個檔案').attributes('disabled')).toBeUndefined()
  })
})

describe('多檔上傳佇列：上傳中不收新檔案，開始前收下的一定排進這一輪', () => {
  it('上傳中呼叫 add 不會排進清單（跟移除、清空一樣）', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(LIMITS as never)
    const { finishAll, names } = holdUploads()
    const queue = useMediaUploadQueue({ campusKey: () => 'yihua' })
    await queue.add(jpgs('a.jpg', 'b.jpg', 'c.jpg'))
    const round = queue.start()
    await flushPromises()
    expect(queue.running.value).toBe(true)

    await queue.add(jpgs('d.jpg', 'e.jpg'))
    expect(queue.items.value.map((item) => item.file.name)).toEqual(['a.jpg', 'b.jpg', 'c.jpg'])

    await finishAll()
    const done = await round
    expect(done.map((a) => a.id)).toEqual(['a.jpg', 'b.jpg', 'c.jpg'])
    expect(names()).toEqual(['a.jpg', 'b.jpg', 'c.jpg'])
    expect(queue.counts.value.queued).toBe(0)
  })

  it('按下上傳時還在檢查格式（等上限讀回來）的檔案，跟這一輪一起傳，不會留在等待上傳', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(LIMITS as never)
    const { finishAll, names } = holdUploads()
    const queue = useMediaUploadQueue({ campusKey: () => 'yihua' })
    await queue.add(jpgs('a.jpg'))
    // add 還在等上限（非同步），這時就開始上傳。
    void queue.add(jpgs('b.jpg', 'c.jpg'))
    const round = queue.start()
    await flushPromises()
    await finishAll()
    const done = await round
    expect(names()).toEqual(['a.jpg', 'b.jpg', 'c.jpg'])
    expect(done.map((a) => a.id)).toEqual(['a.jpg', 'b.jpg', 'c.jpg'])
    expect(queue.counts.value.queued).toBe(0)
  })

  it('沒有等待上傳的檔案時 start 直接回空陣列，不會卡在上傳中', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(LIMITS as never)
    const queue = useMediaUploadQueue({ campusKey: () => 'yihua' })
    expect(await queue.start()).toEqual([])
    expect(queue.running.value).toBe(false)
  })
})
