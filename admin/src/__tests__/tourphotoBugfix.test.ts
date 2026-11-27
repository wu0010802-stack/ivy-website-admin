// 2026-11-26 修復 tourphoto：校園探索可以發布沒有照片的場景。
// 「新增場景」帶的 image 是空字串、照片欄沒有必填，存檔、發布、排程都不檢查，官網環境頁就出現
// /assets/.webp 破圖。現在比照五校介紹：草稿照存（先取名再選照片），發布、排程、送審前先擋下，
// 講出是哪個場景、切到那個場景；後端 registry 的 publish_blocker 是同一條規則。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, type VueWrapper } from '@vue/test-utils'
import { ElMessage, ElMessageBox } from 'element-plus'
import CampusTourView from '../views/CampusTourView.vue'
import MediaRefField from '../components/MediaRefField.vue'
import EditorScheduleDialog from '../components/EditorScheduleDialog.vue'
import { api } from '../api/client'
import type { UserOut } from '../api/types'
import { cleanup, mockGet, mountWith, superAdmin } from './admissionsTestKit'
import { ROLE_CAPABILITIES, testUser } from './fixtures'

afterEach(cleanup)

type Scene = { key: string; name: string; image: string; intro: string }
const scene = (key: string, name: string, image: string): Scene => ({ key, name, image, intro: '' })
// 第二個場景是按「新增場景」後只改了名稱、忘了選照片的樣子。
const MISSING = () => [scene('hall', '大廳', 'campus'), scene('scene-1764140000000', '戶外遊戲場', '')]

function tourItem(scenes: Scene[]) {
  return {
    id: 'tour-item', kind: 'campus_tour', campus_key: 'yihua', latest_version: 1, current_published_revision_id: null,
    latest_revision: { id: 'rev-1', version: 1, created_at: '2026-11-26T00:00:00Z', payload: { scenes }, review_status: 'draft' },
  }
}

async function mountTour(scenes: Scene[], user: UserOut = superAdmin()) {
  mockGet({
    '/admin/content-items/campus_tour/schedules': [],
    '/admin/content-items/campus_tour/revisions': [],
    '/admin/content-items/campus_tour': tourItem(scenes),
  })
  // 舊程式會開確認框、送出：確認框直接按下去、送出照單全收，才看得出有沒有被擋。
  const confirm = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
  const post = vi.spyOn(api, 'post').mockImplementation(async (_path: string, body?: unknown) => {
    const payload = (body as { payload?: { scenes: Scene[] } } | undefined)?.payload
    return tourItem(payload?.scenes ?? scenes) as never
  })
  const error = vi.spyOn(ElMessage, 'error')
  const { wrapper } = await mountWith(CampusTourView, { path: '/content/campus-tour?campus=yihua', user })
  return { wrapper, confirm, post, error }
}

const buttonByText = (wrapper: VueWrapper, text: string) => wrapper.findAll('button').find((b) => b.text() === text)
const activeTab = (wrapper: VueWrapper) => wrapper.get('.tour__scene-tab.is-active').text()
const errorAbout = (name: string) => expect.objectContaining({ message: expect.stringContaining(`「${name}」`) })

describe('校園探索：場景沒有照片不能上官網', () => {
  it('場景分頁標出缺照片，照片欄是必填', async () => {
    const { wrapper } = await mountTour(MISSING())
    const tabs = wrapper.findAll('.tour__scene-tab[role="tab"]')
    expect(tabs[0]!.text()).not.toContain('缺照片')
    expect(tabs[1]!.text()).toContain('缺照片')
    await tabs[1]!.trigger('click')
    expect(wrapper.findComponent(MediaRefField).props('required')).toBe(true)
    expect(wrapper.get('.tour__side .media-field').text()).toContain('請從素材庫選一張照片')
  })

  it('按發布：不開確認框、不送出，講出是哪個場景並切過去', async () => {
    const { wrapper, confirm, post, error } = await mountTour(MISSING())
    expect(activeTab(wrapper)).toContain('大廳')
    await wrapper.get('.editor__publish').trigger('click')
    await flushPromises()
    expect(confirm).not.toHaveBeenCalled()
    expect(post).not.toHaveBeenCalled()
    expect(error).toHaveBeenCalledWith(errorAbout('戶外遊戲場'))
    expect(activeTab(wrapper)).toContain('戶外遊戲場')
  })

  it('按排程發布：先擋下，不打開排程對話框', async () => {
    const { wrapper, post, error } = await mountTour(MISSING())
    await buttonByText(wrapper, '排程發布')!.trigger('click')
    await flushPromises()
    expect(wrapper.findComponent(EditorScheduleDialog).props('modelValue')).toBe(false)
    expect(post).not.toHaveBeenCalled()
    expect(error).toHaveBeenCalledWith(errorAbout('戶外遊戲場'))
  })

  it('新增場景只取了名字就按「儲存並發布」：不存也不發布；存草稿照常可以', async () => {
    const { wrapper, confirm, post, error } = await mountTour([scene('hall', '大廳', 'campus')])
    await buttonByText(wrapper, '新增場景')!.trigger('click')
    await flushPromises()
    await wrapper.get('.tour__name input').setValue('戶外遊戲場')
    await wrapper.get('.editor__publish').trigger('click')
    await flushPromises()
    expect(confirm).not.toHaveBeenCalled()
    expect(post).not.toHaveBeenCalled()
    expect(error).toHaveBeenCalledWith(errorAbout('戶外遊戲場'))

    await buttonByText(wrapper, '儲存草稿')!.trigger('click')
    await flushPromises()
    expect(post.mock.calls.map(([path]) => String(path))).toEqual(['/admin/content-items/campus_tour/revisions?campus_key=yihua'])
  })

  it('內容編輯按送審也先擋下', async () => {
    const editor = testUser('editor', {
      campus_keys: ['yihua'], capabilities: ['content.shared'], effective_capabilities: [...ROLE_CAPABILITIES.editor, 'content.shared'],
    })
    const { wrapper, post, error } = await mountTour(MISSING(), editor)
    const submit = wrapper.get('.editor__publish')
    expect(submit.text()).toBe('送審')
    await submit.trigger('click')
    await flushPromises()
    expect(post).not.toHaveBeenCalled()
    expect(error).toHaveBeenCalledWith(errorAbout('戶外遊戲場'))
  })

  it('照片都選好時照常開發布確認框、發布', async () => {
    const { wrapper, confirm, post, error } = await mountTour([scene('hall', '大廳', 'campus')])
    expect(wrapper.text()).not.toContain('缺照片')
    await wrapper.get('.editor__publish').trigger('click')
    await flushPromises()
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(post.mock.calls.map(([path]) => String(path))).toEqual(['/admin/content-items/campus_tour/publish?campus_key=yihua'])
    expect(error).not.toHaveBeenCalled()
  })
})
