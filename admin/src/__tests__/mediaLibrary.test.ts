// 素材庫：用在哪裡、替換並產生草稿、封存與待清理、多檔上傳、影片也能補說明。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { computed, defineComponent } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter, matchedRouteKey } from 'vue-router'
import ElementPlus, { ElMessageBox } from 'element-plus'
import MediaLibraryView from '../views/MediaLibraryView.vue'
import MediaPickerDialog from '../components/MediaPickerDialog.vue'
import MediaReplaceDialog from '../components/MediaReplaceDialog.vue'
import { api, ApiError } from '../api/client'
import { formatDuration, mediaFieldPathLabel } from '../api/labels'
import type { MediaAssetOut, MediaUsagesOut, UserOut } from '../api/types'
import { precheckFile, resetUploadLimits, UPLOAD_CONCURRENCY, useMediaUploadQueue } from '../composables/mediaUpload'
import { useAuthStore } from '../stores/auth'
import { testUser } from './fixtures'

const wrappers: VueWrapper[] = []
beforeEach(() => resetUploadLimits())
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
    id: 'm1',
    campus_key: 'yihua',
    kind: 'image',
    status: 'ready',
    original_filename: 'garden.jpg',
    content_type: 'image/jpeg',
    size_bytes: 2048,
    width: 100,
    height: 80,
    duration_seconds: null,
    created_at: '2026-09-20T02:00:00Z',
    created_by_email: 'teacher@ivy.example',
    archived_at: null,
    deleted_at: null,
    purge_after: null,
    replaces_media_id: null,
    alt_text: '菜園',
    source_attribution: null,
    caption: null,
    license_note: null,
    tags: [],
    crop_focus_x: null,
    crop_focus_y: null,
    processing_error: null,
    usage_count: 0,
    used_in: [],
    variants: [],
    ...overrides,
  }
}

const USAGES: MediaUsagesOut = {
  media_id: 'm1',
  references: [
    {
      content_item_id: 'tour', kind: 'campus_tour', campus_key: 'yihua', revision_id: 'r3', version: 3,
      field_path: 'scenes[1].image', label: '操場', states: ['draft', 'live'], publish_at: null, can_edit: true,
    },
    {
      content_item_id: 'news', kind: 'home_news', campus_key: null, revision_id: 'r7', version: 7,
      field_path: 'articles[0].body[2].image', label: '運動會', states: ['draft'], publish_at: null, can_edit: false,
    },
  ],
  history: [{ content_item_id: 'faq', kind: 'campus_news', campus_key: 'yihua', versions: [2, 1] }],
  untracked_usages: 0,
  can_archive: false,
  can_delete: false,
}

async function mountAs(component: unknown, user: UserOut, props: Record<string, unknown> = {}) {
  const pinia = createPinia()
  useAuthStore(pinia).user = user
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: defineComponent({ template: '<div />' }) }] })
  await router.push('/media')
  await router.isReady()
  const wrapper = mount(component as ReturnType<typeof defineComponent>, {
    props,
    global: { plugins: [pinia, router, ElementPlus], provide: { [matchedRouteKey as symbol]: computed(() => router.currentRoute.value.matched[0]) } },
  } as never)
  wrappers.push(wrapper)
  await flushPromises()
  return wrapper
}

function mockGet(assets: MediaAssetOut[], usages: MediaUsagesOut = USAGES) {
  return vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
    if (path === '/admin/media/upload-limits') return LIMITS as never
    if (path.endsWith('/usages')) return usages as never
    if (path.startsWith('/admin/media')) return assets as never
    return [] as never
  })
}

function pickFiles(input: VueWrapper['element'] | Element, files: File[]) {
  Object.defineProperty(input, 'files', { value: files, configurable: true })
  input.dispatchEvent(new Event('change'))
}

const admin = () => testUser('super_admin', { email: 'admin@ivy.example' })
const buttons = (wrapper: VueWrapper) => wrapper.findAll('button').map((b) => b.text())

describe('素材引用的位置與影片長度', () => {
  it('欄位路徑轉成園方看得懂的位置', () => {
    expect(mediaFieldPathLabel('share_image')).toBe('分享預覽圖')
    expect(mediaFieldPathLabel('scenes[1].image')).toBe('第 2 個場景的照片')
    expect(mediaFieldPathLabel('articles[0].image')).toBe('第 1 則消息的封面')
    expect(mediaFieldPathLabel('articles[1].body[2].image')).toBe('第 2 則消息內文第 3 段的圖片')
    expect(mediaFieldPathLabel('unknown.path')).toBe('unknown.path')
  })

  it('影片長度', () => {
    expect(formatDuration(65.4)).toBe('1:05')
    expect(formatDuration(3725)).toBe('1:02:05')
    expect(formatDuration(null)).toBe('—')
  })
})

describe('多檔上傳佇列', () => {
  it('送出前擋掉 GIF 與超過上限的檔案', () => {
    expect(precheckFile(new File(['x'], 'a.gif', { type: 'image/gif' }), LIMITS)).toContain('格式不支援')
    const big = new File(['x'], 'big.mp4', { type: 'video/mp4' })
    Object.defineProperty(big, 'size', { value: LIMITS.max_video_bytes + 1 })
    expect(precheckFile(big, LIMITS)).toContain('150.0 MB')
    expect(precheckFile(new File(['x'], 'v.mp4', { type: 'video/mp4' }), LIMITS, 'image')).toBe('這裡只能上傳照片')
    expect(precheckFile(new File(['x'], 'ok.webp', { type: 'image/webp' }), LIMITS)).toBeNull()
  })

  it('同時最多上傳兩個，失敗的各自留下原因，不影響其他檔案', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(LIMITS as never)
    let active = 0
    let peak = 0
    const upload = vi.spyOn(api, 'upload').mockImplementation(async (_path: string, form: FormData) => {
      active += 1
      peak = Math.max(peak, active)
      await new Promise((resolve) => setTimeout(resolve, 5))
      active -= 1
      const name = (form.get('file') as File).name
      if (name === 'bad.jpg') throw new ApiError(422, { code: 'MEDIA_INVALID', message: '檔案內容不是合法的圖片' })
      return asset({ id: name, original_filename: name }) as never
    })
    const queue = useMediaUploadQueue({ campusKey: () => 'yihua' })
    await queue.add(['a.jpg', 'bad.jpg', 'c.jpg', 'd.png'].map((n) => new File(['x'], n, { type: n.endsWith('png') ? 'image/png' : 'image/jpeg' })))
    const done = await queue.start()
    expect(upload).toHaveBeenCalledTimes(4)
    expect(peak).toBe(UPLOAD_CONCURRENCY)
    expect(done.map((a) => a.id)).toEqual(['a.jpg', 'c.jpg', 'd.png'])
    const bad = queue.items.value.find((item) => item.file.name === 'bad.jpg')!
    expect(bad.status).toBe('failed')
    expect(bad.error).toBe('檔案內容不是合法的圖片')
    expect((upload.mock.calls[0]![1] as FormData).get('campus_key')).toBe('yihua')
  })
})

describe('素材庫頁', () => {
  it('卡片顯示上傳者與用在哪些內容，「用在哪裡」列出版本、位置與狀態', async () => {
    const get = mockGet([asset({ usage_count: 2, used_in: [{ kind: 'campus_tour', campus_key: 'yihua' }] })])
    const wrapper = await mountAs(MediaLibraryView, admin())
    expect(wrapper.text()).toContain('上傳：teacher・')
    expect(wrapper.text()).toContain('用在：校園探索（義華）')

    await wrapper.findAll('button').find((b) => b.text() === '用在哪裡')!.trigger('click')
    await flushPromises()
    expect(get).toHaveBeenCalledWith('/admin/media/m1/usages')
    const text = wrapper.text()
    expect(text).toContain('第 2 個場景的照片（操場）')
    expect(text).toContain('第 3 版')
    expect(text).toContain('官網上')
    expect(text).toContain('第 1 則消息內文第 3 段的圖片')
    expect(text).toContain('只在舊版本')
    expect(text).toContain('第 2、1 版')
  })

  it('唯讀帳號只能看用在哪裡，不能編輯、替換、封存或刪除', async () => {
    mockGet([asset()])
    const wrapper = await mountAs(MediaLibraryView, testUser('readonly', { campus_keys: ['yihua'] }))
    const labels = buttons(wrapper)
    expect(labels).toContain('用在哪裡')
    for (const hidden of ['編輯', '替換', '封存', '刪除']) expect(labels).not.toContain(hidden)
  })

  it('影片也能編輯說明，卡片顯示長度', async () => {
    mockGet([asset({ id: 'v1', kind: 'video', content_type: 'video/mp4', duration_seconds: 42, alt_text: null })])
    const wrapper = await mountAs(MediaLibraryView, admin())
    expect(wrapper.text()).toContain('影片・0:42')
    expect(wrapper.text()).toContain('未填影片說明')
    await wrapper.findAll('button').find((b) => b.text() === '編輯')!.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('編輯影片說明')
    expect(wrapper.find('.focus').exists()).toBe(false)
    const patch = vi.spyOn(api, 'patch').mockResolvedValue(asset() as never)
    await wrapper.findAll('button').find((b) => b.text() === '儲存')!.trigger('click')
    await flushPromises()
    const body = patch.mock.calls[0]![1] as Record<string, unknown>
    expect(patch.mock.calls[0]![0]).toBe('/admin/media/v1')
    expect(body).not.toHaveProperty('crop_focus_x')
    expect(body).toHaveProperty('license_note')
  })

  it('封存與待清理分頁：待清理只能復原，並顯示永久刪除時間', async () => {
    const get = mockGet([])
    const wrapper = await mountAs(MediaLibraryView, admin())
    get.mockImplementation(async (path: string) =>
      (path === '/admin/media?state=deleted'
        ? [asset({ deleted_at: '2026-09-20T02:00:00Z', purge_after: '2026-09-27T02:00:00Z' })]
        : path === '/admin/media/upload-limits' ? LIMITS : []) as never,
    )
    const deletedTab = wrapper.findAll('label.el-radio-button').find((l) => l.text() === '待清理')!
    await deletedTab.find('input').setValue(true)
    await flushPromises()
    expect(get).toHaveBeenCalledWith('/admin/media?state=deleted')
    expect(wrapper.text()).toContain('後永久刪除')
    const labels = buttons(wrapper)
    expect(labels).toContain('復原')
    expect(labels).not.toContain('刪除')
    const post = vi.spyOn(api, 'post').mockResolvedValue(asset() as never)
    await wrapper.findAll('button').find((b) => b.text() === '復原')!.trigger('click')
    await flushPromises()
    expect(post).toHaveBeenCalledWith('/admin/media/m1/restore')
  })

  it('舊版本還在用時刪除失敗，改提議封存', async () => {
    mockGet([asset()])
    const wrapper = await mountAs(MediaLibraryView, admin())
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    vi.spyOn(api, 'delete').mockRejectedValue(new ApiError(409, { code: 'MEDIA_IN_HISTORY', message: '舊版本還用到這個素材', usages: USAGES }))
    const post = vi.spyOn(api, 'post').mockResolvedValue(asset({ archived_at: '2026-09-25T00:00:00Z' }) as never)
    await wrapper.findAll('button').find((b) => b.text() === '刪除')!.trigger('click')
    await flushPromises()
    expect(confirm).toHaveBeenCalledTimes(2)
    expect(confirm.mock.calls[0]![0]).toContain('7 天內都可以復原')
    expect(confirm.mock.calls[1]![2]).toMatchObject({ confirmButtonText: '改為封存' })
    expect(post).toHaveBeenCalledWith('/admin/media/m1/archive')
  })

  it('上傳對話框可一次選多個檔案，逐檔送出', async () => {
    mockGet([])
    const wrapper = await mountAs(MediaLibraryView, admin())
    await wrapper.findAll('button').find((b) => b.text() === '上傳素材')!.trigger('click')
    await flushPromises()
    const input = wrapper.find('input[type="file"]')
    expect(input.attributes('multiple')).toBeDefined()
    const upload = vi.spyOn(api, 'upload').mockImplementation(async (_p: string, form: FormData) => asset({ id: (form.get('file') as File).name }) as never)
    pickFiles(input.element, [
      new File(['x'], 'a.jpg', { type: 'image/jpeg' }),
      new File(['x'], 'b.jpg', { type: 'image/jpeg' }),
      new File(['x'], 'c.gif', { type: 'image/gif' }),
    ])
    await flushPromises()
    expect(wrapper.findAll('.uploads__row')).toHaveLength(3)
    expect(wrapper.text()).toContain('格式不支援')
    expect(wrapper.text()).toContain('一次上傳多個檔案時，圖片說明請在上傳後按「編輯」各自補上')
    await wrapper.findAll('button').find((b) => b.text() === '上傳 2 個檔案')!.trigger('click')
    await flushPromises()
    expect(upload).toHaveBeenCalledTimes(2)
    expect(wrapper.findAll('.uploads__row[data-status="done"]')).toHaveLength(2)
  })
})

describe('替換素材', () => {
  it('上傳新檔案後列出影響範圍，只為勾選且能編輯的內容產生草稿', async () => {
    const get = mockGet([])
    const upload = vi.spyOn(api, 'upload').mockResolvedValue(asset({ id: 'm2', replaces_media_id: 'm1' }) as never)
    const post = vi.spyOn(api, 'post').mockResolvedValue({
      replacement_id: 'm2',
      items: [{ content_item_id: 'tour', kind: 'campus_tour', campus_key: 'yihua', version: 4, field_paths: ['scenes[1].image'] }],
    } as never)
    const wrapper = await mountAs(MediaReplaceDialog, admin(), { modelValue: false, asset: asset() })
    await wrapper.setProps({ modelValue: true })
    await flushPromises()
    pickFiles(wrapper.find('input[type="file"]').element, [new File(['x'], 'new.png', { type: 'image/png' })])
    await flushPromises()
    await wrapper.findAll('button').find((b) => b.text() === '上傳新檔案')!.trigger('click')
    await flushPromises()
    expect(upload.mock.calls[0]![0]).toBe('/admin/media/m1/replace')
    expect(get).toHaveBeenCalledWith('/admin/media/m1/usages')
    expect(wrapper.text()).toContain('不會直接上線')
    expect(wrapper.text()).toContain('你沒有編輯這項內容的權限')
    expect(wrapper.text()).toContain('熱點位置要重新複核')

    await wrapper.findAll('button').find((b) => b.text() === '產生 1 份草稿')!.trigger('click')
    await flushPromises()
    expect(post).toHaveBeenCalledWith('/admin/media/m1/replace-references', {
      replacement_id: 'm2',
      items: [{ content_item_id: 'tour', expected_version: 3 }],
    })
    expect(wrapper.text()).toContain('第 4 版・第 2 個場景的照片')
  })
})

describe('選圖器', () => {
  it('可一次上傳多張、顯示照片用在哪裡；只傳一張時照舊直接選用', async () => {
    mockGet([asset({ used_in: [{ kind: 'home_news', campus_key: null }], usage_count: 1 })])
    const wrapper = await mountAs(MediaPickerDialog, admin(), { modelValue: false, campusKey: 'yihua' })
    await wrapper.setProps({ modelValue: true })
    await flushPromises()
    expect(wrapper.text()).toContain('用在：最新消息與活動')
    const input = wrapper.find('input[type="file"]')
    expect(input.attributes('multiple')).toBeDefined()

    vi.spyOn(api, 'upload').mockResolvedValue(asset({ id: 'one' }) as never)
    pickFiles(input.element, [new File(['x'], 'one.jpg', { type: 'image/jpeg' })])
    await flushPromises()
    expect(wrapper.emitted('select')?.[0]?.[0]).toMatchObject({ id: 'one' })
  })
})
