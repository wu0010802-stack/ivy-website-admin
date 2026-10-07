<script setup lang="ts">
import { computed, h, provide, ref, useId, useTemplateRef, watch, type VNode } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { usePermissions } from '../composables/usePermissions'
import { formatDateTime, staffLabel, staffOf } from '../api/labels'
import { contentPathFieldLabel } from '../api/contentFieldLabels'
import type { ContentFieldError } from '../api/errors'
import type { ContentEditorState, FieldChange, PublishJob } from '../composables/useContentItem'
import { useUnsavedChanges } from '../composables/useUnsavedChanges'
import { draftSummary } from '../composables/draftSummary'
import { revealContentPath } from '../composables/newsContent'
import { campusSelectLabelKey } from './campusSelectLabel'
import RevisionHistoryDrawer from './RevisionHistoryDrawer.vue'
import { dirtySectionIds, MIN_NAV_SECTIONS, type EditorSection } from '../composables/editorSections'
import EditorSectionNav from './EditorSectionNav.vue'
import LivePreviewPane from './LivePreviewPane.vue'
import { useNarrowScreen } from '../composables/useNarrowScreen'
import {
  livePreviewOrigin,
  previewFrameUrl,
  previewTargetsFor,
  readPreviewViewport,
  rememberPreviewViewport,
  type PreviewViewport,
} from '../composables/previewTargets'

// 十個內容編輯頁共用的外殼：狀態列、載入骨架、表單插槽、黏底動作列，
// 以及「有未儲存修改就離開」的攔截。頁面只負責欄位本身。
const props = defineProps<{
  editor: ContentEditorState
  /** 尚未選校區等情況：不顯示表單，改顯示這段提示 */
  placeholder?: string
  /** 表單寬度，預設 640 */
  width?: 'narrow' | 'wide'
  /** 長頁面的段落目錄（composables/editorSections.ts）；少於兩段不顯示 */
  sections?: EditorSection[]
}>()

const loading = computed(() => props.editor.loading.value)
const loadError = computed(() => props.editor.loadError.value)
const saving = computed(() => props.editor.saving.value)
const publishing = computed(() => props.editor.publishing.value)
const isPublished = computed(() => props.editor.isPublished.value)
const isDirty = computed(() => props.editor.isDirty.value)
const neverPublished = computed(() => props.editor.neverPublished.value)
const latestRevisionAt = computed(() => props.editor.latestRevisionAt.value)
const latestRevisionId = computed(() => props.editor.latestRevisionId?.value ?? null)
const liveVersion = computed(() => props.editor.liveVersion?.value ?? null)
const busy = computed(() => saving.value || publishing.value)

// 段落目錄：頁面傳進來的段落（標題元素的 id 與字）。至少兩段才顯示。
const navSections = computed(() => props.sections ?? [])
const hasNav = computed(() => navSections.value.length >= MIN_NAV_SECTIONS)

// 右側官網預覽（2026-10-06 方向 D）：1280 以上、後台與官網同源、這種內容有對應預覽頁時才放。
// 1280 以下維持原本版面，用狀態列的「存草稿並預覽」開新分頁。
const previewTargets = computed(() => previewTargetsFor(props.editor.kind))
const belowPreviewWidth = useNarrowScreen('(max-width: 1279px)')
const previewOrigin = livePreviewOrigin()
const showPreviewPane = computed(() => Boolean(previewOrigin) && previewTargets.value.length > 0 && !belowPreviewWidth.value && !props.placeholder)
const previewTargetId = ref('')
watch(
  previewTargets,
  (targets) => {
    if (!targets.some((t) => t.id === previewTargetId.value)) previewTargetId.value = targets[0]?.id ?? ''
  },
  { immediate: true },
)
const currentTarget = computed(() => previewTargets.value.find((t) => t.id === previewTargetId.value) ?? previewTargets.value[0] ?? null)
const previewViewport = ref<PreviewViewport>(readPreviewViewport())
watch(previewViewport, rememberPreviewViewport)
// 這一階段預覽看的是上次儲存的草稿：換分頁換網址，存成新的一版（或換校區）就重新載入（之後換成即時預覽）。
const previewSrc = computed(() => (previewOrigin && currentTarget.value ? previewFrameUrl(previewOrigin, currentTarget.value.page, { live: false }) : ''))
const previewFrameKey = computed(() => `${props.editor.campusKey?.value ?? ''}|${latestRevisionId.value ?? ''}|${currentTarget.value?.page ?? ''}`)
// 別人先存或先發布了：表單照常可以看、可以複製，但儲存、送審、發布先停用，
// 等使用者看過差異、載入最新內容再說（DESIGN：版本衝突保留編輯，不自動丟棄）。
const conflict = computed(() => props.editor.conflict?.value ?? false)
const fieldErrors = computed(() => props.editor.fieldErrors?.value ?? [])
const stashedChanges = computed(() => props.editor.stashedChanges?.value ?? [])
const stashOverlap = computed(() => props.editor.stashOverlap?.value ?? [])
const changes = computed(() => props.editor.changes?.value ?? [])
// 動作列與目錄打點的清單：和官網那一版比（useContentItem.draftChanges）；舊的假 editor 沒給時用和上次儲存比。
const draftChangeList = computed(() => props.editor.draftChanges?.value ?? changes.value)
const baselineSource = computed(() => props.editor.draftBaseline?.value.source ?? 'saved')
// 正在讀官網那一版：基準還是 saved，動作列先不寫和官網比的結果（見 ContentEditorState.liveReading）。
const liveReading = computed(() => props.editor.liveReading?.value ?? false)
// 目錄打點：和動作列同一個基準（官網那一版；讀不到時和上次儲存比）。
const dirtySections = computed(() => {
  const keys = new Set(draftChangeList.value.map((c) => c.key))
  const base = props.editor.draftBaseline?.value.payload ?? null
  const current = (props.editor.form?.value ?? {}) as Record<string, unknown>
  return dirtySectionIds(navSections.value, keys, base, current)
})
const previewUrl = computed(() => props.editor.previewUrl?.value ?? '')
const publicUrl = computed(() => props.editor.publicUrl?.value ?? '')
// 同一個預覽頁用手機寬度開（預覽頁上也能再切換）。
const mobilePreviewUrl = computed(() => (previewUrl.value ? `${previewUrl.value}${previewUrl.value.includes('?') ? '&' : '?'}viewport=mobile` : ''))
const apiPath = computed(() => props.editor.apiPath?.value ?? '')
// 確認框標題帶上是哪一項內容（分校內容含校名），例如「發布「各校常見問題（明華）」
// 到官網？」，避免在錯的校區按下發布。名稱本身已有引號（首頁「關於常春藤」）就不再加。
const named = computed(() => {
  const label = props.editor.contextLabel?.value ?? ''
  return !label || label.includes('「') ? label : `「${label}」`
})
const approver = computed(() => props.editor.approver ?? '校區管理者')
const historyOpen = ref(false)
const { can } = usePermissions()
// 內容編輯只能送審；總管理者與分校管理者可以直接發布、排程、審核。
const canPublishRole = computed(() => can('content.publish'))
// 唯讀帳號（沒有 content.manage，或共用內容沒有授權）只能看：欄位停用，
// 不顯示儲存、送審、發布與還原。由 useContentItem 依內容範圍算好傳進來。
const readOnly = computed(() => props.editor.readOnly?.value ?? false)
const reviewStatus = computed(() => props.editor.reviewStatus?.value ?? 'draft')
const reviewNote = computed(() => props.editor.reviewNote?.value ?? null)
const pendingReview = computed(() => reviewStatus.value === 'pending_review' && !isDirty.value)
const scheduled = computed(() => (props.editor.schedules?.value ?? []).filter((j) => j.status === 'scheduled'))
// 最近一次到期的排程（清單依排程時間新到舊）；沒有發布（檢查不過）或略過
// （官網已是較新版本）時寫出原因。之後又成功排程發布、官網換過版本，或有人
// 按了「知道了」（後端 resolved，和總覽的待辦同一個定義）就不再提。
const lastUnpublished = computed(() => {
  const finished = (props.editor.schedules?.value ?? []).find((j) => j.status === 'done' || j.status === 'failed' || j.status === 'skipped')
  return finished && finished.status !== 'done' && !finished.resolved ? finished : null
})

// 分校內容頁的校區選單放在這個外殼的工具列：多校下拉也寫出「校區」。
provide(campusSelectLabelKey, '校區')

const acknowledging = ref(false)
async function acknowledge(jobId: string) {
  if (!props.editor.acknowledgeSchedule) return
  acknowledging.value = true
  try {
    await props.editor.acknowledgeSchedule(jobId)
  } finally {
    acknowledging.value = false
  }
}
// 排程清單跟著內容一起換：切校區、重新載入、存檔後都重讀一次。
watch(
  () => [apiPath.value, props.editor.loading.value] as const,
  ([path, isLoading]) => {
    if (path && !isLoading && !props.editor.loadError.value) void props.editor.loadSchedules?.()
  },
  { immediate: true },
)

// 排程列只講時間與「會發布哪一份」，不寫版本號或帳號。到期時官網已經是排定的
// 那一版或更新的內容就會略過（後端 skip_reason），所以先看官網再講草稿：
// 官網就是最新一版，或官網版本不比排定的舊，到時都會略過；排的是較早的草稿時
// 講明不含之後存的修改，不知道官網是哪一版就不斷言一定會發布。
function scheduleTarget(job: PublishJob): string {
  const isLatest = !latestRevisionId.value || job.revision_id === latestRevisionId.value
  const live = liveVersion.value
  if (isLatest && isPublished.value) return '這份內容，但官網已經是這一版，到時會略過。'
  if (live !== null && live === job.revision_version) return '較早儲存的草稿，但這份已經在官網上，到時會略過。'
  if (isPublished.value || (live !== null && live > job.revision_version)) {
    return '較早儲存的草稿，但官網已經是更新的內容，到時會略過。'
  }
  if (!isLatest) {
    return live === null && !neverPublished.value
      ? '較早儲存的草稿（不含之後存的修改）；到時官網若已經是更新的內容就會略過。'
      : '較早儲存的草稿，不含之後存的修改。'
  }
  if (isDirty.value) return '上次儲存的草稿，不含還沒儲存的修改。'
  return '這份草稿。'
}

const cancellingId = ref<string | null>(null)
async function cancelSchedule(job: PublishJob) {
  if (!props.editor.cancelSchedule || cancellingId.value) return
  try {
    await ElMessageBox.confirm(
      `取消後 ${formatDateTime(job.publish_at)} 不會自動發布，草稿仍會保留。`,
      named.value ? `取消${named.value}的排程？` : '取消這個排程？',
      { confirmButtonText: '取消排程', cancelButtonText: '先不要', type: 'warning' },
    )
  } catch {
    return
  }
  cancellingId.value = job.id
  try {
    await props.editor.cancelSchedule(job.id)
  } finally {
    cancellingId.value = null
  }
}

const scheduleOpen = ref(false)
const scheduleAt = ref<string | null>(null)
// 「明天 09:00」是最常排的時間，一鍵帶入。
const scheduleShortcuts = [
  {
    text: '明天 09:00',
    value: () => {
      const date = new Date()
      date.setDate(date.getDate() + 1)
      date.setHours(9, 0, 0, 0)
      return date
    },
  },
]

function disablePastDay(date: Date): boolean {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return date.getTime() < today.getTime()
}

// 日期選單只擋得住過去的日子；今天已經過去的時間在送出前先擋，不要等存完草稿才被後端退回。
// 「現在」在開對話框、改時間、按排程時各取一次：選好時間後停在對話框裡等到
// 時間過了，按下去也會顯示提示，不會沒反應。
const scheduleNow = ref(Date.now())
watch([scheduleOpen, scheduleAt], () => {
  scheduleNow.value = Date.now()
})
const scheduleInPast = computed(() => Boolean(scheduleAt.value) && new Date(scheduleAt.value!).getTime() <= scheduleNow.value)

async function submitSchedule() {
  scheduleNow.value = Date.now()
  if (!scheduleAt.value || !props.editor.schedule || scheduleInPast.value) return
  if (await props.editor.schedule(scheduleAt.value)) scheduleOpen.value = false
}

// 開確認框前讀官網版比對，這段時間發布鈕顯示處理中，避免連按；表單和儲存也
// 跟處理中一樣先鎖住（DESIGN：處理中鎖住表單及重複操作）。
const preparing = ref(false)
const locked = computed(() => busy.value || preparing.value)
const actionsBlocked = computed(() => locked.value || conflict.value)

interface ConfirmSummary {
  intro: string
  list: FieldChange[]
}

// 發布、核准是對外動作：按下去官網立刻換掉。確認框列出「官網現在 → 按下去之後」
// 哪些欄位會變、變成什麼（DESIGN 第四輪：列差異而不是時間戳），已存的草稿、
// 送審的版本和未儲存的修改都算進去。從沒發布過就說是第一次上線，不拿空白比。
// 讀不到官網版時退回：有未儲存修改列和上次儲存相比的差異，否則講官網現在是哪一版。
async function summarizeAgainstLive(verb: string): Promise<ConfirmSummary> {
  const comparison = props.editor.compareWithLive ? await props.editor.compareWithLive() : null
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
  if (!props.editor.review) return
  try {
    const result = await ElMessageBox.prompt('寫下要修改的地方，內容編輯打開這一頁就看得到。', `退回${named.value}這次送審？`, {
      confirmButtonText: '退回',
      cancelButtonText: '先不要',
      inputType: 'textarea',
      inputValidator: (v: string) => Boolean((v ?? '').trim()) || '請寫下退回原因',
    })
    await props.editor.review('reject', (result as { value: string }).value.trim())
  } catch {
    /* 取消 */
  }
}

// 核准者要看得到編輯改了什麼：列出送審的版本和官網的差異，另附草稿預覽。
async function approve() {
  if (!props.editor.review || preparing.value) return
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
  await props.editor.review('approve')
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
  await props.editor.saveAndPublish()
}

// 放棄修改沒辦法復原，先問；和離頁框用同一個詞，不和版本紀錄的「還原」混在一起。
async function discardEdits() {
  const count = changes.value.length
  try {
    await ElMessageBox.confirm(
      `${named.value || '這一頁'}還沒儲存的修改會清掉，回到上次儲存的內容，沒辦法復原。`,
      count ? `放棄 ${count} 個欄位的修改？` : '放棄這些修改？',
      { confirmButtonText: '放棄修改', cancelButtonText: '先不要', type: 'warning', confirmButtonClass: 'el-button--danger', autofocus: false },
    )
  } catch {
    return
  }
  props.editor.reset()
}

// 狀態列寫出最新草稿是誰存的（DESIGN 09-29：版本一律寫日期時間＋編輯者）。版本
// 摘要沒有編輯者，從版本紀錄列表找這一版；讀不到就只寫時間。
const latestEditor = ref('')
watch(
  () => [latestRevisionId.value, isPublished.value] as const,
  async ([id, published]) => {
    latestEditor.value = ''
    const history = props.editor.history
    if (!id || published || !history) return
    try {
      const list = await history.list()
      const revision = Array.isArray(list) ? list.find((r) => r.id === id) : undefined
      if (revision && latestRevisionId.value === id) latestEditor.value = staffLabel(staffOf(revision, 'created_by'), '')
    } catch {
      /* 讀不到版本紀錄：狀態列照舊只寫時間 */
    }
  },
  { immediate: true },
)
function draftSaved(): string {
  const at = formatDateTime(latestRevisionAt.value)
  return latestEditor.value ? `${latestEditor.value} 於 ${at} 存的草稿` : `草稿儲存於 ${at}`
}

type Tone = 'success' | 'warning' | 'info'

// 唯讀時只說現況，不寫「修改、送審、儲存」這類這個帳號做不到的動作指示。
// 內容編輯沒有發布鈕，說明改講送審（核准的人依內容範圍：校區管理者或總管理者）。
const status = computed<{ tone: Tone; label: string; detail: string }>(() => {
  if (!isDirty.value && reviewStatus.value === 'pending_review') {
    return {
      tone: 'warning',
      label: '已送審，等待核准',
      detail: readOnly.value
        ? '送審的版本核准後才會出現在官網。'
        : canPublishRole.value
          ? '內容編輯送上來的版本，檢查沒問題就核准發布，需要修改就退回並寫原因。'
          : `${approver.value}核准後才會出現在官網；這段期間可以繼續修改，改完要重新送審。`,
    }
  }
  if (!isDirty.value && reviewStatus.value === 'rejected') {
    const fallback = readOnly.value ? '這一版沒有發布到官網。' : '請修改後重新送審。'
    return { tone: 'warning', label: '被退回', detail: reviewNote.value ? `原因：${reviewNote.value}` : fallback }
  }
  if (isDirty.value) {
    return {
      tone: 'warning',
      label: '有未儲存的修改',
      detail: canPublishRole.value ? '儲存草稿後才會保留；發布時會自動先儲存。' : '儲存草稿後才會保留；送審時會自動先儲存。',
    }
  }
  if (!latestRevisionAt.value) {
    return {
      tone: 'info',
      label: '尚未建立內容',
      detail: readOnly.value
        ? '這份內容還沒有草稿。'
        : canPublishRole.value
          ? '填好後先儲存草稿；發布後，家長才會看到新內容。'
          : `填好後先儲存草稿再送審；${approver.value}核准後，家長才會看到新內容。`,
    }
  }
  if (isPublished.value) {
    return { tone: 'success', label: '官網顯示的是這一版', detail: `目前發布的版本儲存於 ${formatDateTime(latestRevisionAt.value)}。` }
  }
  if (!readOnly.value && !canPublishRole.value) {
    return {
      tone: 'warning',
      label: '草稿還沒送審',
      detail: `${draftSaved()}。按「送審」後${approver.value}才看得到，核准後才會出現在官網。`,
    }
  }
  return {
    tone: 'warning',
    label: '草稿尚未發布',
    detail: neverPublished.value
      ? `${draftSaved()}，官網仍顯示預設文字。`
      : `${draftSaved()}，官網仍是上一版。`,
  }
})
const statusLabelId = useId()

// 狀態列的工具：有未發布的草稿給預覽（表單有修改時講明預覽的是上次儲存的內容），
// 官網就是這一版時給「查看官網此頁」。
const showPreview = computed(() => Boolean(previewUrl.value && latestRevisionAt.value && !isPublished.value))
// 有修改時一鍵「存草稿並預覽」（2026-10-05 第九輪）：原本要先按儲存草稿，狀態列才出現預覽連結；
// 已上線的內容一改，狀態列只剩「查看官網此頁」，看不到改完的樣子。有修改時改給這一顆，
// 不再並列「預覽已存草稿」（那是改之前的內容，容易看錯）。
const showSavePreview = computed(() => Boolean(previewUrl.value && isDirty.value && !readOnly.value))
const savingPreview = ref(false)
async function saveAndPreview() {
  // 分頁要在點擊當下開：等存檔回來（await 之後）才開，會被瀏覽器當成彈出視窗擋掉。
  // 先開空白分頁、斷開 opener，存好再換成預覽頁；存不成功（欄位錯誤、版本衝突）就關掉，
  // 錯誤照一般存檔的方式顯示在這一頁。
  const tab = window.open('', '_blank')
  if (tab) tab.opener = null
  savingPreview.value = true
  try {
    if (!(await props.editor.save({ silent: true }))) {
      tab?.close()
      return
    }
  } finally {
    savingPreview.value = false
  }
  ElMessage.success('已儲存草稿，預覽在新分頁；官網尚未更新')
  if (tab) tab.location.href = previewUrl.value
  else window.open(previewUrl.value, '_blank', 'noopener')
}
const showLive = computed(() => Boolean(publicUrl.value && isPublished.value))
const showHistory = computed(() => Boolean(props.editor.history && latestRevisionAt.value))

// 最新一版被退回、又沒有修改：不能直接發布或排程那一版（後端發布與排程都回 409
// CONTENT_REVISION_REJECTED），要改過、存成新的一版才行。
const rejectedLatest = computed(() => reviewStatus.value === 'rejected' && !isDirty.value)
const canPublish = computed(() => isDirty.value || (Boolean(latestRevisionAt.value) && !isPublished.value && !rejectedLatest.value))
// 已上線而且沒有修改：送審的就是官網上那一版，沒有東西可審。
const publishedUnchanged = computed(() => isPublished.value && !isDirty.value)

// 動作列的主色給「真正的下一步」：有修改先存草稿；草稿存好了，能發布的人
// 下一步是發布、內容編輯是送審；已上線又沒修改就沒有主色鈕（按鈕保留、改一般
// 樣式，版面不跳動）。送審待核准時「核准並發布」本身是綠色實心。被退回的版本也沒有主色鈕。
const primaryAction = computed<'save' | 'publish' | 'submit' | null>(() => {
  if (isDirty.value) return 'save'
  if (!latestRevisionAt.value || isPublished.value || pendingReview.value) return null
  if (rejectedLatest.value && canPublishRole.value) return null
  return canPublishRole.value ? 'publish' : 'submit'
})
const actionNote = computed(() => {
  if (rejectedLatest.value && canPublishRole.value) return '這一版已被退回，請修改後重新儲存。'
  return canPublishRole.value ? '儲存草稿不會更動官網，發布後才會公開。' : '儲存草稿不會更動官網，送審核准後才會公開。'
})
// 動作列那一句。被退回又沒有修改時要講「請修改後重新儲存」，不寫摘要；官網版還在讀時
// 不寫和官網比的結果（避免「沒有修改」→「N 處修改」閃一下），有未儲存的修改只說有未儲存的修改。
const actionSummary = computed(() => {
  if (rejectedLatest.value && canPublishRole.value && !isDirty.value) return null
  if (liveReading.value) return draftSummary('saved', [], isDirty.value)
  return draftSummary(baselineSource.value, draftChangeList.value, isDirty.value, canPublishRole.value)
})

// 真的離開這一頁時多一顆「儲存草稿並離開」（存草稿不會動到官網）；唯讀、版本
// 衝突時存不了，維持兩個選項。版本衝突後「載入最新內容」讀取失敗、或載入了還沒套回時，
// 自己的修改只記在這個畫面（stashedChanges），離開一樣要問。
const { confirmLeave } = useUnsavedChanges(
  computed(() => !loading.value && ((!loadError.value && isDirty.value) || stashedChanges.value.length > 0)),
  busy,
  {
    saveDraft: () => props.editor.save(),
    canSaveDraft: computed(() => !readOnly.value && !conflict.value && !loadError.value && isDirty.value),
  },
)

// 讀取錯誤時的「重新載入」：有記著的修改（衝突後「載入最新內容」讀取失敗）就再走 reloadLatest，
// 讀到了再提供套回；直接 load 會把記著的修改清掉。其他讀取失敗（例如剛換校）照常 load，
// 不能把上一校表單裡的東西當成修改記下來。
function retryLoad() {
  if (stashedChanges.value.length && props.editor.reloadLatest) void props.editor.reloadLatest()
  else void props.editor.load()
}

// 存檔被擋下的欄位清單：點一條就展開那一則、捲過去並聚焦。
const bodyEl = useTemplateRef<HTMLElement>('body')
async function jumpToError(error: ContentFieldError) {
  const kind = props.editor.kind ?? props.editor.history?.kind
  await revealContentPath(bodyEl.value, error.path, contentPathFieldLabel(kind, error.path))
}

// 版本衝突：看對方改了什麼（和自己開始編輯時的內容比），或載入最新內容。
const otherChanges = ref<FieldChange[] | null>(null)
const inspecting = ref(false)
const inspectFailed = ref(false)
watch(conflict, (value) => {
  if (!value) {
    otherChanges.value = null
    inspectFailed.value = false
  }
})
async function inspectConflict() {
  if (!props.editor.inspectConflict) return
  inspecting.value = true
  try {
    otherChanges.value = await props.editor.inspectConflict()
    inspectFailed.value = otherChanges.value === null
  } finally {
    inspecting.value = false
  }
}

async function reloadLatest() {
  try {
    await ElMessageBox.confirm(
      '表單會換成最新的內容。你這次的修改會先記在這個畫面，載入後可以選擇套回；離開這一頁就不會保留。',
      '載入最新內容？',
      { confirmButtonText: '載入最新內容', cancelButtonText: '先不要', type: 'warning' },
    )
  } catch {
    return
  }
  await props.editor.reloadLatest?.()
}

async function discardStash() {
  try {
    await ElMessageBox.confirm('你剛才的修改會清掉，沒辦法復原。', '不套回你的修改？', {
      confirmButtonText: '清掉我的修改',
      cancelButtonText: '先不要',
      type: 'warning',
      confirmButtonClass: 'el-button--danger',
      autofocus: false,
    })
  } catch {
    return
  }
  props.editor.discardStash?.()
}

defineExpose({ confirmLeave })
</script>

<template>
  <div class="editor" :class="{ 'editor--wide': width === 'wide', 'editor--with-nav': hasNav, 'editor--preview': showPreviewPane }">
    <div v-if="$slots.lead" class="page-lead"><slot name="lead" /></div>

    <div v-if="$slots.toolbar" class="toolbar"><slot name="toolbar" /></div>

    <el-alert v-if="loadError" type="error" :closable="false" show-icon :title="loadError" class="editor__alert">
      <el-button size="small" @click="retryLoad">重新載入</el-button>
    </el-alert>

    <el-empty v-else-if="placeholder" :description="placeholder" />

    <el-skeleton v-else-if="loading" :rows="6" animated class="editor__skeleton" />

    <template v-else>
      <div class="editor__layout" :class="{ 'has-nav': hasNav, 'has-preview': showPreviewPane }">
      <div class="editor__top">
      <!-- 狀態列不是即時區（裡面有預覽、版本紀錄等工具）；狀態變了才由下面隱藏的 status 唸一次。 -->
      <div class="editor__status" :data-tone="status.tone" role="group" :aria-labelledby="statusLabelId">
        <span class="editor__dot" aria-hidden="true" />
        <div class="editor__status-text">
          <strong :id="statusLabelId">{{ status.label }}</strong>
          <span>{{ status.detail }}</span>
        </div>
        <div v-if="showPreview || showLive || showHistory || showSavePreview" class="editor__tools">
          <el-button
            v-if="showSavePreview"
            text
            size="small"
            class="editor__history editor__save-preview"
            :loading="savingPreview"
            :disabled="actionsBlocked"
            @click="saveAndPreview"
          >存草稿並預覽 ↗</el-button>
          <template v-if="showPreview && !showSavePreview">
            <a
              :href="previewUrl"
              target="_blank"
              rel="noopener"
              class="editor__tool"
            >預覽草稿 ↗</a>
            <a
              :href="mobilePreviewUrl"
              target="_blank"
              rel="noopener"
              class="editor__tool"
            >手機版 ↗</a>
          </template>
          <a v-else-if="showLive" :href="publicUrl" target="_blank" rel="noopener" class="editor__tool">查看官網此頁 ↗</a>
          <el-button
            v-if="showHistory"
            text
            size="small"
            class="editor__history"
            :disabled="locked"
            @click="historyOpen = true"
          >
            版本紀錄
          </el-button>
        </div>
      </div>
      <!-- 按下發布、送審之後到結果出來前，報讀「正在處理」，不要一片安靜。 -->
      <p class="visually-hidden" role="status">{{ busy ? '正在處理，請稍候…' : status.label }}</p>
      <div v-if="scheduled.length || lastUnpublished" class="editor__schedules">
        <p v-for="job in scheduled" :key="job.id" class="editor__schedule">
          <span>已排定 <strong class="num">{{ formatDateTime(job.publish_at) }}</strong> 自動發布{{ scheduleTarget(job) }}</span>
          <el-button
            v-if="canPublishRole && !readOnly && editor.cancelSchedule"
            text
            size="small"
            :loading="cancellingId === job.id"
            :disabled="cancellingId !== null"
            @click="cancelSchedule(job)"
          >
            取消排程
          </el-button>
        </p>
        <p v-if="lastUnpublished && !scheduled.length" :class="lastUnpublished.status === 'failed' ? 'is-failed' : 'is-skipped'">
          {{ formatDateTime(lastUnpublished.publish_at) }} 的排程{{ lastUnpublished.status === 'failed' ? '沒有發布' : '已略過' }}：{{ lastUnpublished.error }}
          <el-button
            v-if="canPublishRole && !readOnly && editor.acknowledgeSchedule"
            text
            size="small"
            :loading="acknowledging"
            @click="acknowledge(lastUnpublished.id)"
          >
            知道了
          </el-button>
        </p>
        <router-link to="/releases?tab=schedules" class="editor__schedules-all">查看全站排程</router-link>
      </div>
      <el-alert v-if="conflict" type="error" :closable="false" show-icon title="其他人已經更新這項內容" class="editor__alert editor__conflict">
        <p>你的修改還在畫面上、還沒存進去，儲存和發布先停用。可以先看對方改了什麼，再載入最新內容；載入後可以把你的修改套回。</p>
        <template v-if="otherChanges">
          <p v-if="!otherChanges.length">最新一版和你開始編輯時的內容一樣，可能是對方發布了同一份內容。</p>
          <ul v-else class="editor__change-list">
            <li v-for="change in otherChanges" :key="change.key">
              <strong>{{ change.label }}</strong>：{{ change.before }} → {{ change.after }}<span v-if="change.detail">（{{ change.detail }}）</span>
            </li>
          </ul>
        </template>
        <p v-else-if="inspectFailed">讀不到最新一版，請稍後再試，或直接載入最新內容。</p>
        <div class="editor__alert-actions">
          <el-button v-if="editor.inspectConflict && !otherChanges" size="small" :loading="inspecting" @click="inspectConflict">看對方改了什麼</el-button>
          <el-button size="small" type="primary" @click="reloadLatest">載入最新內容</el-button>
        </div>
      </el-alert>
      <el-alert
        v-if="stashedChanges.length"
        type="warning"
        :closable="false"
        show-icon
        title="已載入最新內容，你剛才的修改還沒套回"
        class="editor__alert"
      >
        <p>
          你改過：{{ stashedChanges.map((c) => c.label).join('、') }}。
          <template v-if="stashOverlap.length">其中「{{ stashOverlap.join('、') }}」對方也改過，套回會蓋掉對方在這幾欄的修改。</template>
          套回後還要按儲存才會保留。
        </p>
        <div class="editor__alert-actions">
          <el-button size="small" type="primary" @click="editor.restoreStash?.()">套回我的修改</el-button>
          <el-button size="small" @click="discardStash">不要了</el-button>
        </div>
      </el-alert>
      <div v-if="fieldErrors.length" class="editor__errors" role="alert">
        <p class="editor__errors-title">存檔沒有成功，有 {{ fieldErrors.length }} 個地方要修改{{ fieldErrors.some((e) => e.path.length) ? '（點一下就會跳到那一欄）' : '' }}：</p>
        <ul>
          <li v-for="(error, index) in fieldErrors" :key="index">
            <button v-if="error.path.length" type="button" class="editor__error-link" @click="jumpToError(error)">
              {{ error.label }}：{{ error.message }}
            </button>
            <span v-else>{{ error.message }}</span>
          </li>
        </ul>
      </div>
      <RevisionHistoryDrawer
        v-if="editor.history"
        v-model="historyOpen"
        :history="editor.history"
        :dirty="isDirty"
        :busy="busy"
        :can-publish="canPublishRole && !readOnly"
        :can-restore="!readOnly"
        :approver="approver"
      />

      <p v-if="readOnly" class="editor__readonly" role="note">唯讀：你的帳號只能查看這份內容，不能修改或送審。</p>
      </div>

        <!-- 目錄在表單外面：處理中表單 inert 時目錄仍可用來捲動。 -->
        <EditorSectionNav v-if="hasNav" :sections="navSections" :dirty-ids="dirtySections" class="editor__nav" />
        <div ref="body" class="editor__body panel" :inert="locked || undefined" :aria-busy="locked">
          <div class="panel__body">
            <!-- 唯讀時欄位由各頁的 el-form 綁 editor.readOnly 停用；表單外的新增、
                 刪除、拖曳等操作由頁面自己隱藏。 -->
            <slot />
          </div>
        </div>
        <LivePreviewPane
          v-if="showPreviewPane && currentTarget"
          v-model:target="previewTargetId"
          v-model:viewport="previewViewport"
          class="editor__preview"
          :targets="previewTargets"
          :src="previewSrc"
          state="saved"
          :frame-key="previewFrameKey"
        />
      </div>

      <div v-if="!readOnly" class="editor__actions" :class="{ 'is-dirty': isDirty, 'is-busy': busy, 'has-changes': Boolean(actionSummary) }">
        <!-- 「放棄修改」放在說明這一側，離儲存、發布遠一點（破壞性動作不與主動作相鄰）。 -->
        <div class="editor__actions-state">
          <p class="editor__actions-text" :title="actionSummary?.title || (isDirty ? actionNote : undefined)">
            <template v-if="busy">正在處理，請稍候…</template>
            <template v-else-if="actionSummary">
              <span class="editor__actions-count">{{ actionSummary.lead }}</span><span v-if="actionSummary.fields" class="editor__actions-fields">{{ actionSummary.fields }}</span>
            </template>
            <span v-else class="editor__actions-note">{{ actionNote }}</span>
          </p>
          <el-button v-if="isDirty" text class="editor__discard" :disabled="locked" @click="discardEdits">放棄修改</el-button>
        </div>
        <div class="editor__buttons">
          <el-button
            :type="primaryAction === 'save' ? 'primary' : 'default'"
            :loading="saving"
            :disabled="actionsBlocked || !isDirty"
            @click="editor.save()"
          >
            儲存草稿
          </el-button>
          <template v-if="!canPublishRole">
            <el-button
              :type="primaryAction === 'submit' ? 'primary' : 'default'"
              :loading="publishing"
              :disabled="busy || conflict || !latestRevisionAt && !isDirty || pendingReview || publishedUnchanged"
              class="editor__publish"
              @click="editor.submitForReview?.()"
            >
              {{ pendingReview ? '已送審' : isDirty ? '儲存並送審' : '送審' }}
            </el-button>
          </template>
          <template v-else-if="pendingReview">
            <el-button :disabled="busy || preparing || conflict" @click="rejectWithNote">退回</el-button>
            <el-button type="success" :loading="publishing || preparing" :disabled="busy || conflict" @click="approve">核准並發布</el-button>
          </template>
          <template v-else>
            <el-button v-if="editor.schedule" :disabled="busy || preparing || conflict || !canPublish" @click="scheduleOpen = true">排程發布</el-button>
            <el-button
              :type="primaryAction === 'publish' ? 'primary' : 'default'"
              :loading="publishing || preparing"
              :disabled="busy || conflict || !canPublish"
              class="editor__publish"
              :aria-label="isDirty ? '儲存並發布到官網' : '發布到官網'"
              @click="publishWithConfirm()"
            >{{ isDirty ? '儲存並發布' : '發布' }}<span class="editor__wide-only">到官網</span></el-button>
          </template>
        </div>
      </div>
    </template>

    <el-dialog v-model="scheduleOpen" title="排程發布" width="400px" append-to-body>
      <p class="hint">選一個時間，到時自動把{{ isDirty ? '儲存後的' : '目前最新的' }}這一版發布到官網。之後再改內容不會影響這次排程。</p>
      <el-date-picker
        v-model="scheduleAt"
        type="datetime"
        value-format="YYYY-MM-DDTHH:mm:ss+08:00"
        format="YYYY/MM/DD HH:mm"
        :disabled-date="disablePastDay"
        :default-time="new Date(2000, 0, 1, 9, 0, 0)"
        :shortcuts="scheduleShortcuts"
        placeholder="發布時間（台灣時間）"
        style="width: 100%"
      />
      <p v-if="scheduleInPast" class="editor__schedule-error" role="alert">這個時間已經過了，請選現在之後的時間。</p>
      <template #footer>
        <el-button @click="scheduleOpen = false">取消</el-button>
        <el-button type="primary" :loading="publishing" :disabled="!scheduleAt || scheduleInPast" @click="submitSchedule">{{ isDirty ? '儲存並排程' : '排程' }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.editor__schedules { margin: -12px 0 20px; font-size: var(--text-sm); color: var(--ink-2); }
.editor__readonly { margin: -8px 0 16px; font-size: var(--text-sm); color: var(--ink-2); }
.editor__schedules p { margin: 0; }
.editor__schedules .is-failed { color: var(--el-color-danger); }
.editor__schedules .is-skipped { color: var(--ink-2); }
.editor__schedules-all { display: inline-flex; align-items: center; min-height: 28px; font-size: var(--text-sm); }
.editor__schedule-error { margin: 8px 0 0; font-size: var(--text-sm); color: var(--el-color-danger); }
/* 取消排程接在句子後面；按鈕在觸控裝置是 44px 高，不撐開句子的行距。 */
.editor__schedules .editor__schedule { display: flex; flex-wrap: wrap; align-items: center; column-gap: 8px; }
/* --editor-actions-h：黏底動作列佔的高度，右側預覽欄的高度要扣掉它（LivePreviewPane）。
   動作列＝上框 1＋上下內距 16＋16＋按鈕（--control-h：滑鼠 38、觸控 44）；再加它和表單之間的 16 間距，
   預覽欄底端才不會貼著動作列。滑鼠 87、觸控 93。 */
.editor {
  max-width: 720px;
  --editor-actions-h: calc(var(--control-h) + 49px);
}

.editor--wide {
  max-width: 1200px;
}

/* 段落目錄（2026-10-06 方向 D）：1280 以上一律在左側一欄，狀態列與表單在右（表單仍是 720 寬）；
   較窄時目錄在狀態列與表單之間，是一排可以橫捲的膠囊。 */
@media (min-width: 1280px) {
  .editor--with-nav:not(.editor--wide):not(.editor--preview) { max-width: 928px; }
  .editor__layout.has-nav { display: grid; grid-template-columns: 184px minmax(0, 1fr); grid-template-areas: 'nav top' 'nav body'; column-gap: 24px; align-items: start; }
  .editor__layout.has-nav > .editor__top { grid-area: top; min-width: 0; }
  .editor__layout.has-nav > .editor__nav { grid-area: nav; }
  .editor__layout.has-nav > .editor__body { grid-area: body; min-width: 0; }

  /* 右側官網預覽（方向 D）：表單與預覽並排，主欄不再限 720。寬度：1280 時主欄 964＝152＋20＋452＋20＋320，
     1440 時 1124＝152＋20＋560＋20＋372；沒有目錄時表單 440–640、預覽至少 320。 */
  .editor--preview { max-width: none; }
  .editor--preview > .page-lead,
  .editor--preview > .toolbar,
  .editor--preview > .editor__alert,
  .editor--preview > .editor__skeleton { max-width: 720px; }
  .editor__layout.has-preview { display: grid; grid-template-columns: minmax(440px, 640px) minmax(320px, 1fr); grid-template-areas: 'top preview' 'body preview'; column-gap: 20px; align-items: start; }
  .editor__layout.has-nav.has-preview { grid-template-columns: 152px minmax(420px, 560px) minmax(320px, 1fr); grid-template-areas: 'nav top preview' 'nav body preview'; }
  .editor__layout.has-preview > .editor__top { grid-area: top; min-width: 0; }
  .editor__layout.has-preview > .editor__nav { grid-area: nav; }
  .editor__layout.has-preview > .editor__body { grid-area: body; min-width: 0; }
  .editor__layout.has-preview > .editor__preview { grid-area: preview; }
}

.editor__alert {
  margin-bottom: 16px;
}

.editor__alert p {
  margin: 4px 0 0;
}

.editor__alert-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 10px;
}

.editor__alert-actions .el-button + .el-button {
  margin-left: 0;
}

.editor__change-list {
  margin: 6px 0 0;
  padding-left: 18px;
}

/* 存檔被擋下的欄位：放在狀態列下方、表單上方，一條一個可以點的位置。 */
.editor__errors {
  margin: -8px 0 20px;
  padding: 12px 16px;
  border: 1px solid var(--el-color-danger-light-5);
  border-radius: var(--radius);
  background: var(--el-color-danger-light-9);
  font-size: var(--text-sm);
  color: var(--el-color-danger);
}

.editor__errors-title {
  margin: 0 0 6px;
  font-weight: 600;
}

.editor__errors ul {
  margin: 0;
  padding-left: 18px;
}

.editor__error-link {
  min-height: 28px;
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  text-decoration: underline;
  cursor: pointer;
}

.editor__status {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin-bottom: 20px;
  padding: 14px 16px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface-3);
  font-size: var(--text-sm);
  line-height: 1.45;
}

.editor__status-text {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
  min-width: 0;
}

.editor__tools {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
  white-space: nowrap;
}

.editor__tool {
  font-size: var(--text-sm);
  /* 狀態列是 surface-3 底：一般操作色只有 4.2:1（axe 抓到），連結用深一階。 */
  color: var(--admin-accent-hover);
}

/* 「存草稿並預覽」是有修改時最有用的一步：和預覽連結同樣的深藍，不用「版本紀錄」的灰。 */
.editor__tools .el-button.editor__save-preview {
  color: var(--admin-accent-hover);
}

.editor__status strong {
  color: var(--ink);
  font-weight: 600;
}

.editor__status-text span {
  color: var(--ink-3);
}

/* 狀態點依色調（09-22 定案的色彩語意）：綠＝官網就是這一版，暖黃＝草稿或
   待注意，灰＝還沒有內容。 */
.editor__dot {
  flex-shrink: 0;
  width: 8px;
  height: 8px;
  margin-top: 6px;
  border-radius: 50%;
  background: var(--ink-3);
}

.editor__status[data-tone='success'] .editor__dot {
  background: var(--status-live);
}

.editor__status[data-tone='warning'] .editor__dot {
  background: var(--brand-gold);
  box-shadow: 0 0 0 1px var(--brand-gold-ink);
}

.editor__skeleton {
  padding: 20px 24px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
}

.editor__actions {
  position: sticky;
  bottom: 0;
  z-index: 5;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 16px;
  padding: 16px 0 max(16px, env(safe-area-inset-bottom));
  background: var(--surface-2);
  border-top: 1px solid var(--line);
}

.editor__actions .el-button + .el-button {
  margin-left: 0;
}

/* flex-basis 要是 0%：用 auto 的話單行長文字的內容寬度會把 .editor__buttons 擠到第二列，省略號也不會生效。 */
.editor__actions-state { display: flex; align-items: center; flex: 1 1 0%; gap: 4px 12px; min-width: 0; font-size: var(--text-sm); color: var(--ink-3); }
.editor__actions-text { margin: 0; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.editor__actions-count { font-weight: 600; }
.editor__actions.is-dirty .editor__actions-state,
.editor__actions.has-changes .editor__actions-state { color: var(--brand-gold-ink); }
.editor__buttons { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-left: auto; }

/* 手機：狀態文字佔滿一行，預覽與版本紀錄換到下一行、做成 44px 的次要按鈕；
   黏底動作列只在有修改或處理中時顯示說明那一行，按鈕排成同一列。 */
@media (max-width: 720px) {
  .editor__status { flex-wrap: wrap; }
  .editor__tools { flex: 1 1 100%; flex-wrap: wrap; gap: 6px; margin-left: 18px; white-space: normal; }
  .editor__tool,
  .editor__tools .el-button {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    margin: 0;
    padding: 0 10px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
    font-size: var(--text-base);
  }
  .editor__actions {
    flex-direction: column;
    align-items: stretch;
    gap: 8px;
    padding: 12px 0 max(12px, env(safe-area-inset-bottom));
  }
  .editor__actions:not(.is-dirty):not(.is-busy):not(.has-changes) .editor__actions-state { display: none; }
  .editor__actions-state { flex-wrap: nowrap; justify-content: space-between; font-size: var(--text-base); }
  .editor__actions-note { display: none; }
  .editor__discard { flex-shrink: 0; min-height: 44px; }
  .editor__buttons { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); width: 100%; margin-left: 0; }
  .editor__buttons .el-button { min-width: 0; min-height: 44px; padding-inline: 8px; }
  /* 手機按鈕只寫「發布」，但報讀仍是「發布到官網」。報讀名稱另外用 aria-label 寫死：
     el-button 裡的 span 是 flex，「到官網」會被當成區塊，名稱會多一個空白（「發布 到官網」）。 */
  .editor__wide-only {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    padding: 0;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
    border: 0;
  }
}
</style>
