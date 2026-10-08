// 素材庫：用在哪裡、替換並產生草稿、封存與待清理、多檔上傳、影片也能補說明。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { computed, defineComponent } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter, matchedRouteKey } from 'vue-router'
import ElementPlus, { ElMessage, ElMessageBox } from 'element-plus'
import MediaLibraryView from '../views/MediaLibraryView.vue'
import MediaPickerDialog from '../components/MediaPickerDialog.vue'
import MediaReplaceDialog from '../components/MediaReplaceDialog.vue'
import MediaUsagesDrawer from '../components/MediaUsagesDrawer.vue'
import { api, ApiError } from '../api/client'
import { formatDuration, formatFileSize, mediaFieldPathLabel } from '../api/labels'
import type { MediaAssetOut, MediaUsagesOut, UserOut } from '../api/types'
import { precheckFile, resetUploadLimits, UPLOAD_CONCURRENCY, uploadKindHint, useMediaUploadQueue } from '../composables/mediaUpload'
import { useAuthStore } from '../stores/auth'
import { mediaListParams, mediaPage, testUser } from './fixtures'

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
    version: 1,
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
  history: [{ content_item_id: 'cnews', kind: 'campus_news', campus_key: 'yihua', versions: [2, 1] }],
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
    if (path.startsWith('/admin/media?')) return mediaPage(assets) as never
    return [] as never
  })
}

/** 送出過的素材列表請求（只看列表，不含單張、用在哪裡與上傳上限）。 */
function listCalls(get: { mock: { calls: unknown[][] } }) {
  return get.mock.calls.map(([path]) => String(path)).filter((path) => path.startsWith('/admin/media?')).map(mediaListParams)
}

function pickFiles(input: VueWrapper['element'] | Element, files: File[]) {
  Object.defineProperty(input, 'files', { value: files, configurable: true })
  input.dispatchEvent(new Event('change'))
}

const admin = () => testUser('super_admin', { email: 'admin@ivy.example' })
const buttons = (wrapper: VueWrapper) => wrapper.findAll('button').map((b) => b.text())

// 卡片的「更多」選單掛在 body 底下（不在 wrapper 裡），打開後從 document 找選項。
async function openMore(wrapper: VueWrapper, index = 0) {
  await wrapper.findAll('button').filter((b) => b.text() === '更多')[index]!.trigger('click')
  // 選單延後一個計時器才掛上去。
  await vi.waitFor(() => expect(document.body.querySelector('.media-more-menu .el-dropdown-menu__item')).not.toBeNull())
  return Array.from(document.body.querySelectorAll<HTMLElement>('.media-more-menu .el-dropdown-menu__item')).map((el) => el.textContent?.trim() ?? '')
}

async function chooseMore(wrapper: VueWrapper, label: string, index = 0) {
  await openMore(wrapper, index)
  const item = Array.from(document.body.querySelectorAll<HTMLElement>('.media-more-menu .el-dropdown-menu__item')).find((el) => el.textContent?.trim() === label)
  expect(item, `更多選單裡要有「${label}」`).toBeDefined()
  item!.click()
  await flushPromises()
}

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
    expect(precheckFile(big, LIMITS)).toBe('檔案超過 150 MB')
    expect(precheckFile(new File(['x'], 'v.mp4', { type: 'video/mp4' }), LIMITS, 'image')).toBe('這裡只能上傳照片')
    expect(precheckFile(new File(['x'], 'ok.webp', { type: 'image/webp' }), LIMITS)).toBeNull()
  })

  it('iPhone 的 HEIC、MOV 被擋下時說明怎麼處理，不只寫格式不支援', () => {
    const heic = precheckFile(new File(['x'], 'IMG_0001.HEIC', { type: 'image/heic' }), LIMITS)
    expect(heic).toContain('iPhone 的 HEIC 照片')
    expect(heic).toContain('存成 JPEG')
    // Windows 等拿不到 type 的也看副檔名。
    expect(precheckFile(new File(['x'], 'IMG_0002.heic', { type: '' }), LIMITS, 'image')).toContain('iPhone 的 HEIC 照片')
    const mov = precheckFile(new File(['x'], 'IMG_0003.MOV', { type: 'video/quicktime' }), LIMITS)
    expect(mov).toContain('iPhone 的 MOV 影片')
    expect(mov).toContain('轉成 MP4')
    expect(mov).not.toContain('最相容')
    expect(precheckFile(new File(['x'], 'clip.mov', { type: '' }), LIMITS, 'video')).toContain('iPhone 的 MOV 影片')
    // 部署設定已經接受的格式不擋。
    expect(precheckFile(new File(['x'], 'a.heic', { type: 'image/heic' }), { ...LIMITS, image_types: [...LIMITS.image_types, 'image/heic'] })).toBeNull()
  })

  it('檔案大小不寫多餘的「.0」，但 1.5 MB 不四捨五入', () => {
    expect(uploadKindHint(LIMITS, 'image')).toBe('JPG、PNG 或 WebP（15 MB 內）')
    expect(uploadKindHint(LIMITS, 'video')).toBe('MP4（150 MB 內）')
    expect(uploadKindHint(null, 'video')).toBe('MP4')
    expect(formatFileSize(1.5 * 1024 * 1024)).toBe('1.5 MB')
  })

  it('限定影片時擋掉照片；拿不到 type 的檔案照限定的種類檢查大小', () => {
    expect(precheckFile(new File(['x'], 'a.png', { type: 'image/png' }), LIMITS, 'video')).toBe('這裡只能上傳影片（MP4）')
    expect(precheckFile(new File(['x'], 'v.mp4', { type: '' }), LIMITS, 'video')).toBeNull()
    const big = new File(['x'], 'v.mp4', { type: '' })
    Object.defineProperty(big, 'size', { value: LIMITS.max_image_bytes + 1 })
    expect(precheckFile(big, LIMITS, 'video')).toBeNull()
    expect(precheckFile(big, LIMITS, 'image')).toBe('檔案超過 15 MB')
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
    expect(text).not.toContain('第 3 版')
    expect(text).toContain('官網上')
    expect(text).toContain('第 1 則消息內文第 3 段的圖片')
    expect(text).toContain('只在舊版本')
    expect(text).toContain('2 個舊版本')
    expect(text).not.toContain('第 2、1 版')
  })

  it('篩選有看得到的標籤，筆數放在清單上方；分頁和篩選分開', async () => {
    const outdoor = asset({ tags: ['戶外'] })
    const all = [outdoor, asset({ id: 'm2', original_filename: 'b.jpg', campus_key: null })]
    const get = mockGet(all)
    get.mockImplementation(async (path: string) => {
      if (path === '/admin/media/upload-limits') return LIMITS as never
      // 後端篩標籤；state_total 與標籤選單不受篩選影響。
      if (mediaListParams(path).tag === '戶外') return mediaPage([outdoor], { state_total: 2, tags: ['戶外'] }) as never
      return mediaPage(all) as never
    })
    const wrapper = await mountAs(MediaLibraryView, admin())
    const fields = wrapper.findAll('.filter-bar .filter-field > span:first-child').map((span) => span.text())
    expect(fields).toEqual(['搜尋素材', '校區', '標籤', '類型'])
    // 可清除的下拉選單不能包在 label 裡（按 × 清除後清單會又自己打開），改用 aria-label 對上可見標題。
    const selects = wrapper.findAll('.filter-bar .el-select')
    expect(selects).toHaveLength(2)
    for (const select of selects) expect(select.element.closest('label')).toBeNull()
    expect(selects.map((s) => s.find('input').attributes('aria-label'))).toEqual(['校區', '標籤'])
    // 類型只由單選鈕組本身指向標題，不重複念兩次。
    expect(wrapper.find('.media-kind').attributes('aria-labelledby')).toBe('media-kind-label')
    expect(wrapper.find('.filter-bar [role="group"]').exists()).toBe(false)
    expect(wrapper.find('.filter-bar').text()).not.toContain('已封存')
    expect(wrapper.find('.media-tabs').text()).toContain('待清理')
    expect(wrapper.find('.list-summary').text()).toContain('2 個素材')
    expect(wrapper.text()).toContain('跨校共用')

    await wrapper.find('.media__tag').trigger('click')
    await flushPromises()
    expect(listCalls(get).at(-1)).toEqual({ tag: '戶外', page: '1', page_size: '60' })
    expect(wrapper.find('.list-summary').text()).toContain('顯示 1 / 2 個素材')
  })

  it('卡片直接放編輯與用在哪裡；替換、封存、刪除收進「更多」，刪除在最後', async () => {
    mockGet([asset({ alt_text: null })])
    const wrapper = await mountAs(MediaLibraryView, admin())
    expect(wrapper.text()).toContain('未填圖片說明')
    expect(wrapper.text()).not.toContain('替代文字')
    const actions = wrapper.find('.media__actions').findAll('button').map((b) => b.text())
    expect(actions).toEqual(['編輯', '用在哪裡', '更多'])
    expect(await openMore(wrapper)).toEqual(['替換', '封存', '刪除'])
  })

  it('已封存的素材：卡片放取消封存，「更多」裡是編輯與刪除', async () => {
    const get = mockGet([])
    const wrapper = await mountAs(MediaLibraryView, admin())
    get.mockImplementation(async (path: string) =>
      (path === '/admin/media/upload-limits' ? LIMITS : mediaPage(mediaListParams(path).state === 'archived' ? [asset({ archived_at: '2026-09-25T00:00:00Z' })] : [])) as never)
    await wrapper.findAll('label.el-radio-button').find((l) => l.text() === '已封存')!.find('input').setValue(true)
    await flushPromises()
    expect(wrapper.find('.media__actions').findAll('button').map((b) => b.text())).toEqual(['取消封存', '用在哪裡', '更多'])
    expect(await openMore(wrapper)).toEqual(['編輯', '刪除'])
  })

  it('草稿還在用的素材：封存、刪除不送出也不先跳刪除確認，直接說原因並打開用在哪裡', async () => {
    const get = mockGet([asset({ usage_count: 1, used_in: [{ kind: 'campus_tour', campus_key: 'yihua' }] })])
    const wrapper = await mountAs(MediaLibraryView, admin())
    const info = vi.spyOn(ElMessage, 'info')
    const confirm = vi.spyOn(ElMessageBox, 'confirm')
    const post = vi.spyOn(api, 'post')
    const del = vi.spyOn(api, 'delete')

    await chooseMore(wrapper, '刪除')
    expect(confirm).not.toHaveBeenCalled()
    expect(del).not.toHaveBeenCalled()
    expect(info.mock.calls[0]![0]).toContain('先到內容頁換掉才能刪除')
    expect(get).toHaveBeenCalledWith('/admin/media/m1/usages')
    expect(wrapper.text()).toContain('第 2 個場景的照片（操場）')

    await chooseMore(wrapper, '封存')
    expect(post).not.toHaveBeenCalled()
    expect(info.mock.calls[1]![0]).toContain('先到內容頁換掉才能封存')
  })

  it('快速切換分頁時，較晚回來的舊分頁清單不會蓋掉目前的分頁', async () => {
    const get = mockGet([])
    const wrapper = await mountAs(MediaLibraryView, admin())
    const pending = new Map<string, (value: MediaAssetOut[]) => void>()
    get.mockImplementation((path: string) =>
      (path === '/admin/media/upload-limits'
        ? Promise.resolve(LIMITS)
        : new Promise((resolve) => pending.set(mediaListParams(path).state ?? 'active', (items) => resolve(mediaPage(items))))) as never)
    const tab = (label: string) => wrapper.findAll('label.el-radio-button').find((l) => l.text() === label)!.find('input')
    await tab('已封存').setValue(true)
    await tab('待清理').setValue(true)
    await flushPromises()
    pending.get('deleted')!([asset({ id: 'gone', original_filename: 'gone.jpg', deleted_at: '2026-09-20T02:00:00Z', purge_after: '2026-09-27T02:00:00Z' })])
    await flushPromises()
    pending.get('archived')!([asset({ id: 'old', original_filename: 'archived.jpg', archived_at: '2026-09-20T02:00:00Z' })])
    await flushPromises()
    expect(wrapper.text()).toContain('gone.jpg')
    expect(wrapper.text()).not.toContain('archived.jpg')
    expect(wrapper.find('.list-summary').text()).toContain('1 個素材')
  })

  it('篩選與關鍵字交給後端，換篩選回第 1 頁；超過一頁才有分頁，換頁帶 page', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const get = vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
        if (path === '/admin/media/upload-limits') return LIMITS as never
        return mediaPage([asset({ tags: ['戶外'] })], { total: 130, state_total: 200, page: Number(mediaListParams(path).page) }) as never
      })
      const wrapper = await mountAs(MediaLibraryView, admin())
      expect(listCalls(get)).toEqual([{ page: '1', page_size: '60' }])
      expect(wrapper.find('.list-summary').text()).toContain('200 個素材')
      expect(wrapper.find('.media-pager').text()).toContain('共 130 個素材')

      wrapper.findComponent({ name: 'ElPagination' }).vm.$emit('current-change', 3)
      await flushPromises()
      expect(listCalls(get).at(-1)).toEqual({ page: '3', page_size: '60' })

      await wrapper.findAll('label.el-radio-button').find((l) => l.text() === '影片')!.find('input').setValue(true)
      await flushPromises()
      expect(listCalls(get).at(-1)).toEqual({ kind: 'video', page: '1', page_size: '60' })

      wrapper.findAllComponents({ name: 'ElSelect' }).find((select) => select.props('placeholder') === '全部校區')!.vm.$emit('update:modelValue', '__shared')
      await flushPromises()
      expect(listCalls(get).at(-1)).toEqual({ campus: '__shared', kind: 'video', page: '1', page_size: '60' })

      // 關鍵字停下 300ms 才送，前後空白不送。
      const sent = listCalls(get).length
      const search = wrapper.find('input[placeholder="檔名、圖片說明、內部備註或標籤"]')
      await search.setValue('菜')
      await search.setValue(' 菜園 ')
      await vi.advanceTimersByTimeAsync(299)
      expect(listCalls(get)).toHaveLength(sent)
      await vi.advanceTimersByTimeAsync(1)
      await flushPromises()
      expect(listCalls(get)).toHaveLength(sent + 1)
      expect(listCalls(get).at(-1)).toEqual({ campus: '__shared', kind: 'video', q: '菜園', page: '1', page_size: '60' })
      expect(wrapper.find('.list-summary').text()).toContain('顯示 130 / 200 個素材')

      await wrapper.findAll('button').find((b) => b.text() === '清除篩選')!.trigger('click')
      await flushPromises()
      expect(listCalls(get).at(-1)).toEqual({ page: '1', page_size: '60' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('一頁以內不顯示分頁', async () => {
    mockGet([asset()])
    const wrapper = await mountAs(MediaLibraryView, admin())
    expect(wrapper.find('.media-pager').exists()).toBe(false)
  })

  it('封存後重抓目前這一頁；這一頁因此空了就退回上一頁', async () => {
    let archived = false
    const get = vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
      if (path === '/admin/media/upload-limits') return LIMITS as never
      const page = Number(mediaListParams(path).page)
      const total = archived ? 60 : 61
      // 第 2 頁只有一張，封存後第 2 頁就空了。
      if (page === 2) return mediaPage(archived ? [] : [asset({ id: 'last', original_filename: 'last.jpg' })], { total, page }) as never
      return mediaPage([asset({ id: 'first', original_filename: 'first.jpg' })], { total, page }) as never
    })
    vi.spyOn(api, 'post').mockImplementation(async () => {
      archived = true
      return {} as never
    })
    const wrapper = await mountAs(MediaLibraryView, admin())
    wrapper.findComponent({ name: 'ElPagination' }).vm.$emit('current-change', 2)
    await flushPromises()
    expect(wrapper.find('[data-media-id="last"]').exists()).toBe(true)
    const sent = listCalls(get).length

    await chooseMore(wrapper, '封存')
    await flushPromises()
    expect(listCalls(get).slice(sent)).toEqual([{ page: '2', page_size: '60' }, { page: '1', page_size: '60' }])
    expect(wrapper.find('[data-media-id="first"]').exists()).toBe(true)
  })

  it('上傳完成回到第 1 頁重抓（新上傳的排在最前面）', async () => {
    const get = vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
      if (path === '/admin/media/upload-limits') return LIMITS as never
      return mediaPage([asset()], { total: 61, page: Number(mediaListParams(path).page) }) as never
    })
    const wrapper = await mountAs(MediaLibraryView, admin())
    wrapper.findComponent({ name: 'ElPagination' }).vm.$emit('current-change', 2)
    await flushPromises()
    expect(listCalls(get).at(-1)).toEqual({ page: '2', page_size: '60' })

    await wrapper.findAll('button').find((b) => b.text() === '上傳素材')!.trigger('click')
    await flushPromises()
    vi.spyOn(api, 'upload').mockResolvedValue(asset({ id: 'new' }) as never)
    pickFiles(wrapper.find('input[type="file"]').element, [new File(['x'], 'a.jpg', { type: 'image/jpeg' })])
    await flushPromises()
    await wrapper.findAll('button').find((b) => b.text() === '上傳 1 個檔案')!.trigger('click')
    await flushPromises()
    expect(listCalls(get).at(-1)).toEqual({ page: '1', page_size: '60' })
  })

  it('編輯素材：改了說明後按 X 先問要不要放棄，選「先不要」就留著；沒改過直接關', async () => {
    mockGet([asset()])
    const wrapper = await mountAs(MediaLibraryView, admin())
    const editDialog = () => wrapper.findAllComponents({ name: 'ElDialog' }).find((d) => d.props('title') === '編輯素材')!
    await wrapper.findAll('button').find((b) => b.text() === '編輯')!.trigger('click')
    await flushPromises()
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue('cancel')
    const alt = wrapper.findAll('input').find((el) => (el.element as HTMLInputElement).value === '菜園')!
    await alt.setValue('孩子在菜園澆水')
    await editDialog().find('.el-dialog__headerbtn').trigger('click')
    await flushPromises()
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(confirm.mock.calls[0]![2]).toMatchObject({ confirmButtonText: '放棄修改', cancelButtonText: '先不要' })
    expect((editDialog().vm as unknown as { visible: boolean }).visible).toBe(true)
    expect((alt.element as HTMLInputElement).value).toBe('孩子在菜園澆水')

    await alt.setValue('菜園')
    await editDialog().find('.el-dialog__headerbtn').trigger('click')
    await flushPromises()
    expect(confirm).toHaveBeenCalledTimes(1)
    // v-model 要等關閉動畫結束才回報，這裡直接看對話框本身是否已經收起。
    expect((editDialog().vm as unknown as { visible: boolean }).visible).toBe(false)
  })

  it('編輯素材：改過內容按「取消」也先問，選「先不要」就留著', async () => {
    mockGet([asset()])
    const wrapper = await mountAs(MediaLibraryView, admin())
    const editDialog = () => wrapper.findAllComponents({ name: 'ElDialog' }).find((d) => d.props('title') === '編輯素材')!
    await wrapper.findAll('button').find((b) => b.text() === '編輯')!.trigger('click')
    await flushPromises()
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue('cancel')
    const cancel = () => editDialog().findAll('button').find((b) => b.text() === '取消')!
    const alt = wrapper.findAll('input').find((el) => (el.element as HTMLInputElement).value === '菜園')!
    await alt.setValue('孩子在菜園澆水')
    await cancel().trigger('click')
    await flushPromises()
    expect(confirm).toHaveBeenCalledTimes(1)
    expect((editDialog().vm as unknown as { visible: boolean }).visible).toBe(true)
    expect((alt.element as HTMLInputElement).value).toBe('孩子在菜園澆水')

    confirm.mockResolvedValue('confirm' as never)
    await cancel().trigger('click')
    await flushPromises()
    expect(confirm).toHaveBeenCalledTimes(2)
    expect((editDialog().vm as unknown as { visible: boolean }).visible).toBe(false)
  })

  it('唯讀帳號只能看用在哪裡，不能編輯、替換、封存或刪除', async () => {
    mockGet([asset()])
    const wrapper = await mountAs(MediaLibraryView, testUser('readonly', { campus_keys: ['yihua'] }))
    const labels = buttons(wrapper)
    expect(labels).toContain('用在哪裡')
    for (const hidden of ['編輯', '替換', '封存', '刪除', '更多']) expect(labels).not.toContain(hidden)
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
    expect(body.expected_version).toBe(1)
  })

  it('素材的 caption 叫「內部備註」並講明不顯示在官網，舊值照原樣存回', async () => {
    mockGet([asset({ caption: '2025 畢業典禮大合照' })])
    const wrapper = await mountAs(MediaLibraryView, admin())
    expect(wrapper.find('input[placeholder="檔名、圖片說明、內部備註或標籤"]').exists()).toBe(true)
    await wrapper.findAll('button').find((b) => b.text() === '編輯')!.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('內部備註（不會顯示在官網）')
    expect(wrapper.text()).not.toContain('圖說')
    const patch = vi.spyOn(api, 'patch').mockResolvedValue(asset() as never)
    await wrapper.findAll('button').find((b) => b.text() === '儲存')!.trigger('click')
    await flushPromises()
    expect((patch.mock.calls[0]![1] as Record<string, unknown>).caption).toBe('2025 畢業典禮大合照')
  })

  it('別人先改過說明時不蓋掉，確認後載入最新的說明重新編輯', async () => {
    const get = mockGet([asset({ version: 3 })])
    const wrapper = await mountAs(MediaLibraryView, admin())
    await wrapper.findAll('button').find((b) => b.text() === '編輯')!.trigger('click')
    await flushPromises()
    const patch = vi.spyOn(api, 'patch').mockRejectedValue(
      new ApiError(409, { code: 'MEDIA_VERSION_CONFLICT', message: '這個素材的說明剛被其他人修改，請重新載入後再編輯', current_version: 4 }),
    )
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    get.mockImplementation(async (path: string) =>
      (path === '/admin/media/m1' ? asset({ version: 4, alt_text: '別人改的說明' }) : mediaPage([asset({ version: 4, alt_text: '別人改的說明' })])) as never)
    await wrapper.findAll('button').find((b) => b.text() === '儲存')!.trigger('click')
    await flushPromises()
    expect((patch.mock.calls[0]![1] as Record<string, unknown>).expected_version).toBe(3)
    expect(String(confirm.mock.calls[0]![0])).toContain('你這次的修改會捨棄')
    expect(get).toHaveBeenCalledWith('/admin/media/m1')
    const alt = wrapper.findAll('textarea, input').find((el) => (el.element as HTMLInputElement).value === '別人改的說明')
    expect(alt).toBeDefined()
  })

  it('封存與待清理分頁：待清理只能復原，並顯示永久刪除時間', async () => {
    const get = mockGet([])
    const wrapper = await mountAs(MediaLibraryView, admin())
    get.mockImplementation(async (path: string) =>
      (path === '/admin/media/upload-limits'
        ? LIMITS
        : mediaPage(mediaListParams(path).state === 'deleted' ? [asset({ deleted_at: '2026-09-20T02:00:00Z', purge_after: '2026-09-27T02:00:00Z' })] : [])) as never,
    )
    const deletedTab = wrapper.findAll('label.el-radio-button').find((l) => l.text() === '待清理')!
    await deletedTab.find('input').setValue(true)
    await flushPromises()
    expect(get).toHaveBeenCalledWith('/admin/media?state=deleted&page=1&page_size=60')
    expect(wrapper.text()).toContain('後永久刪除')
    // 待清理只能復原：卡片上沒有「更多」（刪除、封存都收在裡面），也沒有用在哪裡。
    expect(wrapper.find('.media__actions').findAll('button').map((b) => b.text())).toEqual(['復原'])
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
    await chooseMore(wrapper, '刪除')
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

  it('還沒選檔案時主要鈕寫「選擇檔案後上傳」；可以留空的校區寫跨校共用', async () => {
    mockGet([])
    const wrapper = await mountAs(MediaLibraryView, admin())
    await wrapper.findAll('button').find((b) => b.text() === '上傳素材')!.trigger('click')
    await flushPromises()
    const submit = wrapper.findAll('button').find((b) => b.text() === '選擇檔案後上傳')!
    expect(submit.attributes('disabled')).toBeDefined()
    expect(buttons(wrapper)).not.toContain('上傳 0 個檔案')
    expect(wrapper.find('.drop').text()).toContain('15 MB 內')
    expect(wrapper.find('.drop').text()).not.toContain('.0 MB')
    const campus = wrapper.findAllComponents({ name: 'ElSelect' }).find((c) => c.props('placeholder') === '跨校共用（每一校都能用）')
    expect(campus).toBeDefined()
  })

  it('上傳中關不掉對話框，再按「上傳素材」也不會把剩下的檔案改送到別的校區', async () => {
    mockGet([])
    const wrapper = await mountAs(MediaLibraryView, admin())
    const uploadDialog = () => wrapper.findAllComponents({ name: 'ElDialog' }).find((d) => d.props('title') === '上傳素材')!
    await wrapper.findAll('button').find((b) => b.text() === '上傳素材')!.trigger('click')
    await flushPromises()
    const finishers: (() => void)[] = []
    const upload = vi.spyOn(api, 'upload').mockImplementation((_p: string, form: FormData) =>
      new Promise((resolve) => finishers.push(() => resolve(asset({ id: (form.get('file') as File).name }) as never))) as never)
    pickFiles(wrapper.find('input[type="file"]').element, ['a.jpg', 'b.jpg', 'c.jpg'].map((n) => new File(['x'], n, { type: 'image/jpeg' })))
    await flushPromises()
    const campusSelect = wrapper.findAllComponents({ name: 'ElSelect' }).find((c) => c.props('placeholder') === '跨校共用（每一校都能用）')!
    campusSelect.vm.$emit('update:modelValue', 'yihua')
    await flushPromises()
    expect(uploadDialog().props('closeOnClickModal')).toBe(false)
    await wrapper.findAll('button').find((b) => b.text() === '上傳 3 個檔案')!.trigger('click')
    await flushPromises()
    expect(upload).toHaveBeenCalledTimes(UPLOAD_CONCURRENCY)
    expect(uploadDialog().props('closeOnPressEscape')).toBe(false)
    expect(uploadDialog().props('showClose')).toBe(false)

    // 對話框理應關不掉；就算又按了「上傳素材」，也只是把對話框打開。
    await wrapper.findAll('button').find((b) => b.text() === '上傳素材')!.trigger('click')
    finishers.shift()!()
    await flushPromises()
    finishers.splice(0).forEach((finish) => finish())
    await flushPromises()
    finishers.splice(0).forEach((finish) => finish())
    await flushPromises()
    expect(upload).toHaveBeenCalledTimes(3)
    expect(upload.mock.calls.map((call) => (call[1] as FormData).get('campus_key'))).toEqual(['yihua', 'yihua', 'yihua'])
    expect(uploadDialog().props('showClose')).toBe(true)
  })

  it('沒有共用權限的校區管理者：上傳預設帶自己的校區，不會送出跨校共用被拒', async () => {
    mockGet([])
    const wrapper = await mountAs(MediaLibraryView, testUser('campus_admin', { campus_keys: ['minghua'] }))
    await wrapper.findAll('button').find((b) => b.text() === '上傳素材')!.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('共用素材需要「全站共用內容」權限')
    const upload = vi.spyOn(api, 'upload').mockResolvedValue(asset({ id: 'm9', campus_key: 'minghua' }) as never)
    pickFiles(wrapper.find('input[type="file"]').element, [new File(['x'], 'a.jpg', { type: 'image/jpeg' })])
    await flushPromises()
    await wrapper.findAll('button').find((b) => b.text() === '上傳 1 個檔案')!.trigger('click')
    await flushPromises()
    expect((upload.mock.calls[0]![1] as FormData).get('campus_key')).toBe('minghua')
  })

  it('處理中的影片顯示轉檔中，輪詢到可用就換掉；失敗的可以重新處理', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const processing = asset({ id: 'vp', kind: 'video', status: 'processing', original_filename: 'run.mp4', content_type: 'video/mp4', duration_seconds: 8 })
      const failed = asset({ id: 'vf', kind: 'video', status: 'failed', original_filename: 'bad.mp4', content_type: 'video/mp4', processing_error: '影片轉檔逾時（120 秒）' })
      const get = vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
        if (path === '/admin/media/upload-limits') return LIMITS as never
        if (path === '/admin/media/vp') return { ...processing, status: 'ready' } as never
        if (path.startsWith('/admin/media?')) return mediaPage([processing, failed]) as never
        return [] as never
      })
      const post = vi.spyOn(api, 'post').mockResolvedValue({ ...failed, status: 'processing', processing_error: null } as never)
      const wrapper = await mountAs(MediaLibraryView, admin())
      const card = (id: string) => wrapper.find(`[data-media-id="${id}"]`)
      expect(card('vp').text()).toContain('轉檔中，轉好才能預覽與發布')
      expect(card('vf').text()).toContain('處理失敗：影片轉檔逾時（120 秒）')
      // 轉檔中也能按「編輯」補說明（選影片上傳後的提示叫人來按）；失敗的只放重新處理。
      const actions = (id: string) => card(id).find('.media__actions').findAll('button').map((b) => b.text())
      expect(actions('vp')).toContain('編輯')
      expect(actions('vp')).not.toContain('重新處理')
      expect(actions('vf')).toContain('重新處理')
      expect(actions('vf')).not.toContain('編輯')

      await vi.advanceTimersByTimeAsync(5000)
      await flushPromises()
      expect(get).toHaveBeenCalledWith('/admin/media/vp')
      expect(card('vp').text()).not.toContain('轉檔中')

      await card('vf').findAll('button').find((b) => b.text() === '重新處理')!.trigger('click')
      await flushPromises()
      expect(post).toHaveBeenCalledWith('/admin/media/vf/retry')
      expect(card('vf').text()).toContain('轉檔中')
    } finally {
      vi.useRealTimers()
    }
  })

  it('轉檔中的影片按「編輯」打開影片說明', async () => {
    const processing = asset({ id: 'vp', kind: 'video', status: 'processing', original_filename: 'run.mp4', content_type: 'video/mp4', duration_seconds: 8, alt_text: null })
    mockGet([processing])
    const wrapper = await mountAs(MediaLibraryView, admin())
    await wrapper.find('[data-media-id="vp"]').findAll('button').find((b) => b.text() === '編輯')!.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('編輯影片說明')
  })
})

describe('替換素材', () => {
  async function openReplace(user: UserOut = admin(), target: MediaAssetOut = asset()) {
    const wrapper = await mountAs(MediaReplaceDialog, user, { modelValue: false, asset: target })
    await wrapper.setProps({ modelValue: true })
    await flushPromises()
    return wrapper
  }

  async function uploadNew(wrapper: VueWrapper, file = new File(['x'], 'new.png', { type: 'image/png' })) {
    pickFiles(wrapper.find('input[type="file"]').element, [file])
    await flushPromises()
    await wrapper.findAll('button').find((b) => b.text() === '上傳新檔案')!.trigger('click')
    await flushPromises()
  }

  const positionBoxes = (wrapper: VueWrapper) => wrapper.findAll('.replace__item input[type="checkbox"]')

  it('上傳新檔案後列出影響範圍，預設不勾，只為勾選且能編輯的位置產生草稿', async () => {
    const get = mockGet([])
    const upload = vi.spyOn(api, 'upload').mockResolvedValue(asset({ id: 'm2', replaces_media_id: 'm1' }) as never)
    const post = vi.spyOn(api, 'post').mockResolvedValue({
      replacement_id: 'm2',
      items: [{ content_item_id: 'tour', kind: 'campus_tour', campus_key: 'yihua', version: 4, field_paths: ['scenes[1].image'] }],
    } as never)
    const wrapper = await openReplace()
    await uploadNew(wrapper)
    expect(upload.mock.calls[0]![0]).toBe('/admin/media/m1/replace')
    expect(get).toHaveBeenCalledWith('/admin/media/m1/usages')
    expect(wrapper.text()).toContain('不會直接上線')
    expect(wrapper.text()).toContain('預設不改任何位置')
    expect(wrapper.text()).toContain('你沒有編輯這項內容的權限')
    const boxes = positionBoxes(wrapper)
    expect(boxes.map((box) => (box.element as HTMLInputElement).checked)).toEqual([false, false])
    expect((boxes[1]!.element as HTMLInputElement).disabled).toBe(true)
    const submit = () => wrapper.findAll('button').find((b) => /^產生 \d+ 份草稿$/.test(b.text()))!
    expect(submit().text()).toBe('產生 0 份草稿')
    expect(submit().attributes('disabled')).toBeDefined()

    await boxes[0]!.setValue(true)
    // 校園探索換照片不再要求複核熱點（熱點 2026-10-04 隨分校頁拿掉）。
    expect(wrapper.text()).not.toContain('熱點')
    await submit().trigger('click')
    await flushPromises()
    expect(post).toHaveBeenCalledWith('/admin/media/m1/replace-references', {
      replacement_id: 'm2',
      items: [{ content_item_id: 'tour', expected_version: 3, field_paths: ['scenes[1].image'] }],
    })
    expect(wrapper.text()).toContain('第 2 個場景的照片')
    expect(wrapper.text()).not.toContain('第 4 版')
  })

  it('同一則消息的封面與內文可以只換封面；全選只選能編輯的位置', async () => {
    mockGet([], {
      ...USAGES,
      references: [
        {
          content_item_id: 'news', kind: 'home_news', campus_key: null, revision_id: 'r7', version: 7,
          field_path: 'articles[0].image', label: '運動會', states: ['draft'], publish_at: null, can_edit: true,
        },
        {
          content_item_id: 'news', kind: 'home_news', campus_key: null, revision_id: 'r7', version: 7,
          field_path: 'articles[0].body[2].image', label: '運動會', states: ['draft'], publish_at: null, can_edit: true,
        },
        {
          content_item_id: 'other', kind: 'campus_tour', campus_key: 'minghua', revision_id: 'r2', version: 2,
          field_path: 'scenes[0].image', label: null, states: ['draft'], publish_at: null, can_edit: false,
        },
      ],
    })
    vi.spyOn(api, 'upload').mockResolvedValue(asset({ id: 'm2' }) as never)
    const post = vi.spyOn(api, 'post').mockResolvedValue({ replacement_id: 'm2', items: [] } as never)
    const wrapper = await openReplace()
    await uploadNew(wrapper)
    expect(wrapper.text()).toContain('第 1 則消息的封面（運動會）')
    expect(wrapper.text()).toContain('第 1 則消息內文第 3 段的圖片（運動會）')

    const toggle = () => wrapper.findAll('button').find((b) => ['全選可編輯的位置', '全部取消'].includes(b.text()))!
    await toggle().trigger('click')
    expect(positionBoxes(wrapper).map((box) => (box.element as HTMLInputElement).checked)).toEqual([true, true, false])
    await toggle().trigger('click')
    expect(positionBoxes(wrapper).map((box) => (box.element as HTMLInputElement).checked)).toEqual([false, false, false])

    await positionBoxes(wrapper)[0]!.setValue(true)
    await wrapper.findAll('button').find((b) => b.text() === '產生 1 份草稿')!.trigger('click')
    await flushPromises()
    expect(post.mock.calls[0]![1]).toEqual({
      replacement_id: 'm2',
      items: [{ content_item_id: 'news', expected_version: 7, field_paths: ['articles[0].image'] }],
    })
  })

  it('替換影片時，選到照片先擋下，不送到後端', async () => {
    mockGet([])
    const upload = vi.spyOn(api, 'upload')
    const wrapper = await openReplace(admin(), asset({ kind: 'video', content_type: 'video/mp4', original_filename: 'day.mp4' }))
    pickFiles(wrapper.find('input[type="file"]').element, [new File(['x'], 'photo.jpg', { type: 'image/jpeg' })])
    await flushPromises()
    expect(wrapper.text()).toContain('這裡只能上傳影片（MP4）')
    const button = wrapper.findAll('button').find((b) => b.text() === '上傳新檔案')!
    expect(button.attributes('disabled')).toBeDefined()
    expect(upload).not.toHaveBeenCalled()
  })

  it('新檔案已上傳但讀不到影響範圍：停在確認步驟可重新載入，不會再上傳一次', async () => {
    const get = mockGet([])
    get.mockImplementation(async (path: string) => {
      if (path === '/admin/media/upload-limits') return LIMITS as never
      throw new ApiError(500, 'HTTP 500')
    })
    const upload = vi.spyOn(api, 'upload').mockResolvedValue(asset({ id: 'm2' }) as never)
    const wrapper = await openReplace()
    await uploadNew(wrapper)
    expect(upload).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).toContain('新檔案已經加入素材庫，不用重新上傳')
    expect(buttons(wrapper)).not.toContain('上傳新檔案')
    expect(wrapper.emitted('done')).toHaveLength(1)

    get.mockImplementation(async (path: string) => (path.endsWith('/usages') ? USAGES : LIMITS) as never)
    await wrapper.findAll('button').find((b) => b.text() === '重新載入影響範圍')!.trigger('click')
    await flushPromises()
    expect(wrapper.text()).not.toContain('無法讀取影響範圍')
    expect(wrapper.text()).toContain('第 2 個場景的照片（操場）')
    expect(upload).toHaveBeenCalledTimes(1)
  })
  it('關掉 A 的替換視窗後才回來的上傳結果，不會拿去替換 B', async () => {
    mockGet([], { ...USAGES, media_id: 'asset-b', references: [USAGES.references[0]!] })
    let finishUpload!: (value: MediaAssetOut) => void
    const upload = vi.spyOn(api, 'upload').mockImplementation(() => new Promise((resolve) => { finishUpload = resolve }) as never)
    const post = vi.spyOn(api, 'post').mockResolvedValue({ replacement_id: 'new-a', items: [] } as never)
    const wrapper = await openReplace(admin(), asset({ id: 'asset-a' }))
    pickFiles(wrapper.find('input[type="file"]').element, [new File(['x'], 'new-a.png', { type: 'image/png' })])
    await flushPromises()
    await wrapper.findAll('button').find((button) => button.text() === '上傳新檔案')!.trigger('click')
    expect(upload.mock.calls[0]![0]).toBe('/admin/media/asset-a/replace')

    // 素材庫頁關窗後元件還在，換成 B 再打開。
    await wrapper.findAll('button').find((button) => button.text() === '取消')!.trigger('click')
    await wrapper.setProps({ modelValue: false })
    await wrapper.setProps({ asset: asset({ id: 'asset-b', original_filename: 'b.jpg' }), modelValue: true })
    finishUpload(asset({ id: 'new-a', replaces_media_id: 'asset-a' }))
    await flushPromises()

    // A 的新素材照樣進素材庫（通知父層重新載入），但 B 的視窗還停在上傳步驟。
    expect(wrapper.emitted('done')).toHaveLength(1)
    expect(wrapper.find('input[type="file"]').exists()).toBe(true)
    expect(wrapper.find('.replace__item').exists()).toBe(false)
    expect(buttons(wrapper)).toContain('上傳新檔案')
    expect(post).not.toHaveBeenCalled()
  })
})

describe('用在哪裡的連結', () => {
  const refs = (overrides: Partial<MediaUsagesOut['references'][number]>[]): MediaUsagesOut => ({
    ...USAGES,
    history: [],
    references: overrides.map((o, i) => ({
      content_item_id: `c${i}`, kind: 'campus_news', campus_key: 'yihua', revision_id: `r${i}`, version: 1,
      field_path: 'items[0].image', label: null, states: ['draft'], publish_at: null, can_edit: false, ...o,
    })),
  })

  async function openDrawer(user: UserOut, usages: MediaUsagesOut) {
    mockGet([], usages)
    return mountAs(MediaUsagesDrawer, user, { modelValue: true, asset: asset({ campus_key: null }) })
  }

  const heads = (wrapper: VueWrapper) =>
    wrapper.findAll('.usages__item-head').map((head) => ({
      text: head.text(),
      link: head.find('a').exists() ? head.find('a').attributes('href') : null,
    }))

  it('分校管理者看到別校與沒有授權的共用內容，只寫原因、不給會被擋的連結', async () => {
    const wrapper = await openDrawer(
      testUser('campus_admin', { campus_keys: ['minghua'] }),
      refs([
        { content_item_id: 'mine', campus_key: 'minghua', can_edit: true },
        { content_item_id: 'theirs', campus_key: 'yihua' },
        { content_item_id: 'shared', kind: 'home_news', campus_key: null, field_path: 'articles[0].image' },
      ]),
    )
    const [mine, theirs, shared] = heads(wrapper)
    expect(mine!.text).toContain('前往編輯')
    expect(mine!.link).toContain('/content/campus-news?campus=minghua')
    expect(theirs).toEqual({ text: expect.stringContaining('由其他校區管理'), link: null })
    expect(shared).toEqual({ text: expect.stringContaining('沒有編輯權限'), link: null })
  })

  it('校園探索由總部管理：分校管理者連自己校的也只寫「由總部管理」（2026-10-05）', async () => {
    const wrapper = await openDrawer(
      testUser('campus_admin', { campus_keys: ['minghua'] }),
      refs([{ content_item_id: 'tour', kind: 'campus_tour', campus_key: 'minghua', field_path: 'scenes[0].image' }]),
    )
    expect(heads(wrapper)).toEqual([{ text: expect.stringContaining('由總部管理'), link: null }])
  })

  it('唯讀帳號看自己校的內容是「前往查看」', async () => {
    const wrapper = await openDrawer(testUser('readonly', { campus_keys: ['yihua'] }), refs([{ campus_key: 'yihua' }]))
    const [own] = heads(wrapper)
    expect(own!.text).toContain('前往查看')
    expect(own!.text).not.toContain('前往編輯')
    expect(own!.link).toContain('/content/campus-news?campus=yihua')
  })
})

describe('選圖器', () => {
  it('選影片：向後端只要影片、不要處理失敗的；處理中的可以選並標示轉檔中', async () => {
    const get = mockGet([
      asset({ id: 'ok', kind: 'video', campus_key: null, original_filename: 'ok.mp4' }),
      asset({ id: 'vp', kind: 'video', campus_key: null, status: 'processing', original_filename: 'run.mp4' }),
    ])
    const wrapper = await mountAs(MediaPickerDialog, admin(), { modelValue: false, kind: 'video' })
    await wrapper.setProps({ modelValue: true })
    await flushPromises()
    // 選圖器沒帶校區時只列跨校共用。
    expect(listCalls(get)).toEqual([{ kind: 'video', exclude_failed: 'true', campus: '__shared', page: '1', page_size: '40' }])
    const text = wrapper.findAll('.picker__item').map((item) => item.text()).join('\n')
    expect(text).toContain('run.mp4')
    expect(text).toContain('轉檔中，轉好才能發布')
  })

  it('有校區時要那一校加跨校共用；關鍵字停下 300ms 才向後端搜尋', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const get = mockGet([asset()])
      const wrapper = await mountAs(MediaPickerDialog, admin(), { modelValue: false, campusKey: 'yihua' })
      await wrapper.setProps({ modelValue: true })
      await flushPromises()
      expect(listCalls(get)).toEqual([{ kind: 'image', exclude_failed: 'true', campus: 'yihua', include_shared: 'true', page: '1', page_size: '40' }])

      await wrapper.find('input[placeholder="搜尋檔名或說明"]').setValue('菜')
      await wrapper.find('input[placeholder="搜尋檔名或說明"]').setValue('菜園')
      await vi.advanceTimersByTimeAsync(299)
      expect(listCalls(get)).toHaveLength(1)
      await vi.advanceTimersByTimeAsync(1)
      await flushPromises()
      expect(listCalls(get)).toHaveLength(2)
      expect(listCalls(get)[1]).toMatchObject({ q: '菜園', page: '1' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('還有下一頁才出現「載入更多」，按了接在後面；沒有了就收起來', async () => {
    const first = Array.from({ length: 40 }, (_, i) => asset({ id: `p1-${i}`, original_filename: `first-${i}.jpg` }))
    const second = Array.from({ length: 5 }, (_, i) => asset({ id: `p2-${i}`, original_filename: `second-${i}.jpg` }))
    const get = vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
      if (path === '/admin/media/upload-limits') return LIMITS as never
      const page = mediaListParams(path).page
      return mediaPage(page === '2' ? second : first, { total: 45, page: Number(page), page_size: 40 }) as never
    })
    const wrapper = await mountAs(MediaPickerDialog, admin(), { modelValue: false, campusKey: 'yihua' })
    await wrapper.setProps({ modelValue: true })
    await flushPromises()
    expect(wrapper.findAll('.picker__item')).toHaveLength(40)
    const more = () => wrapper.findAll('button').find((b) => b.text() === '載入更多')
    expect(more()).toBeDefined()

    await more()!.trigger('click')
    await flushPromises()
    expect(listCalls(get).at(-1)).toMatchObject({ campus: 'yihua', page: '2', page_size: '40' })
    const names = wrapper.findAll('.picker__name').map((n) => n.text())
    expect(names).toHaveLength(45)
    expect(names[0]).toBe('first-0.jpg')
    expect(names.at(-1)).toBe('second-4.jpg')
    expect(more()).toBeUndefined()
  })

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

  it('沒有圖片說明的照片在格子上就標出來，並說明選用後官網會沒有圖片說明', async () => {
    mockGet([asset(), asset({ id: 'bare', original_filename: 'bare.jpg', alt_text: null, campus_key: null })])
    const wrapper = await mountAs(MediaPickerDialog, admin(), { modelValue: false, campusKey: 'yihua' })
    await wrapper.setProps({ modelValue: true })
    await flushPromises()
    const tiles = wrapper.findAll('.picker__item')
    expect(tiles.find((t) => t.text().includes('garden.jpg'))!.text()).not.toContain('未填圖片說明')
    const bare = tiles.find((t) => t.text().includes('bare.jpg'))!
    expect(bare.text()).toContain('未填圖片說明')
    expect(bare.text()).toContain('跨校共用')
    expect(wrapper.find('.picker__alt-note').text()).toContain('官網會沒有圖片說明')
    expect(wrapper.text()).toContain('15 MB 內')

    // 選圖器裡上傳的照片沒有說明：選用時提醒，不只說成功。
    const warning = vi.spyOn(ElMessage, 'warning')
    vi.spyOn(api, 'upload').mockResolvedValue(asset({ id: 'new', alt_text: null }) as never)
    pickFiles(wrapper.find('input[type="file"]').element, [new File(['x'], 'new.jpg', { type: 'image/jpeg' })])
    await flushPromises()
    expect(wrapper.emitted('select')?.[0]?.[0]).toMatchObject({ id: 'new' })
    // 句子長，停留久一點、可以自己關。
    expect(warning.mock.calls[0]![0]).toMatchObject({ message: expect.stringContaining('還沒有圖片說明'), duration: 8000, showClose: true })
  })

  it('選圖器上傳中關不掉', async () => {
    mockGet([])
    const wrapper = await mountAs(MediaPickerDialog, admin(), { modelValue: false, campusKey: 'yihua' })
    await wrapper.setProps({ modelValue: true })
    await flushPromises()
    let finish!: () => void
    vi.spyOn(api, 'upload').mockImplementation(() => new Promise((resolve) => { finish = () => resolve(asset() as never) }) as never)
    pickFiles(wrapper.find('input[type="file"]').element, [new File(['x'], 'a.jpg', { type: 'image/jpeg' })])
    await flushPromises()
    const dialog = wrapper.findComponent({ name: 'ElDialog' })
    expect(dialog.props('closeOnPressEscape')).toBe(false)
    expect(dialog.props('closeOnClickModal')).toBe(false)
    expect(dialog.props('showClose')).toBe(false)
    finish()
    await flushPromises()
    expect(dialog.props('showClose')).toBe(true)
  })
})
