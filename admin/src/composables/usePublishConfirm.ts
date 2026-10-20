import { h, ref, type Ref, type VNode } from 'vue'
import { ElMessageBox } from 'element-plus'
import { formatDateTime } from '../api/labels'
import type { ContentEditorState, FieldChange, PublishJob } from './useContentItem'

// ContentEditor 動作列的發布、核准、退回確認框（2026-10-20 從 ContentEditor.vue 抽出，行為不變）。
// 確認框寫出按下去官網會換掉哪些欄位；開框前讀官網版比對的這段時間 preparing 為 true（發布鈕顯示處理中、表單鎖住）。

interface PublishConfirmOptions {
  /** 確認框標題裡的內容名稱（已加引號），例如「各校消息與活動（明華）」。 */
  named: Ref<string>
  previewUrl: Ref<string>
  /** 已排定、還沒到期的排程：現在發布或核准，到時都會略過。 */
  scheduled: Ref<PublishJob[]>
  /** 和上次儲存相比的修改（讀不到官網版時退回用這份）。 */
  changes: Ref<FieldChange[]>
  /** 動作列的清單：和官網那一版比（useContentItem.draftChanges）。 */
  draftChangeList: Ref<FieldChange[]>
  baselineSource: Ref<string>
  isDirty: Ref<boolean>
  isPublished: Ref<boolean>
  neverPublished: Ref<boolean>
  latestRevisionAt: Ref<string | null>
}

interface ConfirmSummary {
  intro: string
  list: FieldChange[]
}

export function usePublishConfirm(editor: ContentEditorState, options: PublishConfirmOptions) {
  const { named, previewUrl, scheduled, changes, draftChangeList, baselineSource, isDirty, isPublished, neverPublished, latestRevisionAt } = options
  const preparing = ref(false)

  // 發布、核准是對外動作：按下去官網立刻換掉。確認框列出「官網現在 → 按下去之後」
  // 哪些欄位會變、變成什麼（DESIGN 第四輪：列差異而不是時間戳），已存的草稿、
  // 送審的版本和未儲存的修改都算進去。從沒發布過就說是第一次上線，不拿空白比。
  // 讀不到官網版時退回：有未儲存修改列和上次儲存相比的差異，否則講官網現在是哪一版。
  async function summarizeAgainstLive(verb: string): Promise<ConfirmSummary> {
    const comparison = editor.compareWithLive ? await editor.compareWithLive() : null
    if (comparison?.firstPublish) {
      return { intro: `這是第一次上線：官網目前顯示預設文字，${verb}後家長就會看到這份內容。`, list: [] }
    }
    if (comparison) {
      return comparison.changes.length
        ? { intro: `和官網目前的內容相比，會更新 ${comparison.changes.length} 個欄位，${verb}後家長立刻看到：`, list: comparison.changes }
        : { intro: `內容和官網目前的一樣，${verb}後家長看到的不會改變。`, list: [] }
    }
    if (changes.value.length) return { intro: `這次會更新 ${changes.value.length} 個欄位，${verb}後家長立刻看到：`, list: changes.value }
    const current = isPublished.value
      ? `官網目前顯示的是 ${formatDateTime(latestRevisionAt.value)} 的版本。`
      : neverPublished.value
        ? '官網目前顯示的是預設文字。'
        : '官網目前顯示的是上一版。'
    return { intro: `${current}${verb}後家長立刻看到這一版。`, list: [] }
  }

  async function prepareSummary(verb: string): Promise<ConfirmSummary> {
    preparing.value = true
    try {
      return await summarizeAgainstLive(verb)
    } finally {
      preparing.value = false
    }
  }

  // 排程到期時官網已經是同一版或更新的內容就會略過，所以現在發布或核准，
  // 已排好的排程到時都不會再發布。
  function scheduleSkipNote(): string {
    if (!scheduled.value.length) return ''
    const times = scheduled.value.map((job) => formatDateTime(job.publish_at)).join('、')
    return `已排定 ${times} 自動發布；現在發布後，這個排程到時會略過。`
  }

  function confirmBody(summary: ConfirmSummary, notes: (string | VNode | null)[]) {
    const list = summary.list
    return h('div', { class: 'publish-diff' }, [
      h('p', null, summary.intro),
      list.length
        ? h('ul', null, list.slice(0, 8).map((c) => h('li', { key: c.key }, [
            h('strong', null, c.label),
            h('span', { class: 'publish-diff__before' }, c.before),
            h('span', { class: 'publish-diff__arrow', 'aria-hidden': 'true' }, '→'),
            h('span', { class: 'publish-diff__after' }, c.after),
            c.detail ? h('span', { class: 'publish-diff__detail' }, c.detail) : null,
          ])))
        : null,
      list.length > 8 ? h('p', { class: 'hint' }, `還有 ${list.length - 8} 個欄位。`) : null,
      ...notes.filter((note) => note).map((note) => h('p', { class: 'hint' }, [note!])),
    ])
  }

  async function rejectWithNote() {
    if (!editor.review) return
    try {
      const result = await ElMessageBox.prompt('寫下要修改的地方，內容編輯打開這一頁就看得到。', `退回${named.value}這次送審？`, {
        confirmButtonText: '退回',
        cancelButtonText: '先不要',
        inputType: 'textarea',
        inputValidator: (v: string) => Boolean((v ?? '').trim()) || '請寫下退回原因',
      })
      await editor.review('reject', (result as { value: string }).value.trim())
    } catch {
      /* 取消 */
    }
  }

  // 核准者要看得到編輯改了什麼：列出送審的版本和官網的差異，另附草稿預覽。
  async function approve() {
    if (!editor.review || preparing.value) return
    const summary = await prepareSummary('核准')
    const preview = previewUrl.value ? h('a', { href: previewUrl.value, target: '_blank', rel: 'noopener' }, '預覽送審的內容 ↗') : null
    try {
      await ElMessageBox.confirm(confirmBody(summary, [scheduleSkipNote(), preview]), `核准並發布${named.value}？`, {
        confirmButtonText: '核准並發布',
        cancelButtonText: '先不要',
        type: 'warning',
        customClass: summary.list.length ? 'publish-confirm' : undefined,
      })
    } catch {
      return
    }
    await editor.review('approve')
  }

  // 2026-10-06 方向 D：動作列已經寫出和官網不同的欄位，發布確認框只寫欄位名，不再列改前→改後
  //（核准照舊列，核准的人不是改的人）。讀不到官網版（saved）時回 null，退回舊的差異框。
  function quickSummary(verb: string): ConfirmSummary | null {
    if (baselineSource.value === 'first') return { intro: `這是第一次上線：官網目前顯示預設文字，${verb}後家長就會看到這份內容。`, list: [] }
    if (baselineSource.value !== 'live') return null
    const list = draftChangeList.value
    return list.length
      ? { intro: `和官網目前的內容相比，會更新 ${list.length} 個欄位：${list.map((c) => c.label).join('、')}。${verb}後家長立刻看到。`, list: [] }
      : { intro: `內容和官網目前的一樣，${verb}後家長看到的不會改變。`, list: [] }
  }

  async function publishWithConfirm() {
    if (preparing.value) return
    const summary = quickSummary('發布') ?? (await prepareSummary('發布'))
    const message = confirmBody(summary, [scheduleSkipNote(), '發布後若要改回，可以從「版本紀錄」還原上一版。'])
    try {
      await ElMessageBox.confirm(message, `發布${named.value}到官網？`, {
        confirmButtonText: isDirty.value ? '儲存並發布' : '發布',
        cancelButtonText: '先不要',
        type: 'warning',
        customClass: summary.list.length ? 'publish-confirm' : undefined,
      })
    } catch {
      return
    }
    await editor.saveAndPublish()
  }

  return { preparing, approve, rejectWithNote, publishWithConfirm }
}
