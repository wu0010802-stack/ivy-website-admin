<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { notifyError, notifyWarning } from '../composables/notify'
import { ArrowDown, Upload } from '@element-plus/icons-vue'
import { api, ApiError, mediaFocusUrl, mediaPreviewUrl } from '../api/client'
import type { MediaAssetOut, MediaAssetPageOut, MediaUploadLimitsOut } from '../api/types'
import { apiErrorMessage, isVersionConflict } from '../api/errors'
import { campusLabel, contentItemLabel, formatDate, formatDateTime, formatDuration, formatFileSize, mediaStatus, staffEmail, staffLabel, staffOf } from '../api/labels'
import { useAuthStore } from '../stores/auth'
import { canEditSharedContent } from '../router/nav'
import { usePermissions } from '../composables/usePermissions'
import { useCampusScope } from '../composables/useCampusScope'
import { useRequestSequence } from '../composables/useRequestSequence'
import { canRetryProcessing, processingNote, useProcessingPoll } from '../composables/mediaProcessing'
import { loadUploadLimits, uploadKindHint, useMediaUploadQueue } from '../composables/mediaUpload'
import PageHeader from '../components/PageHeader.vue'
import StatusTag from '../components/StatusTag.vue'
import MediaUploadList from '../components/MediaUploadList.vue'
import MediaUsagesDrawer from '../components/MediaUsagesDrawer.vue'
import MediaReplaceDialog from '../components/MediaReplaceDialog.vue'
import FocusPicker from '../components/FocusPicker.vue'

type ListState = 'active' | 'archived' | 'deleted'

const authStore = useAuthStore()
const { can } = usePermissions()
const { visibleCampusKeys } = useCampusScope({ autoSelect: false })
// 篩選與分頁都在後端做，這裡只放目前這一頁。
const PAGE_SIZE = 60
const assets = ref<MediaAssetOut[]>([])
const page = ref(1)
// 符合篩選的總數、目前這一類（素材／已封存／待清理）的總數，給「顯示 X / N 個素材」。
const total = ref(0)
const stateTotal = ref(0)
// 目前這一類素材用過的標籤，依使用次數排序（後端算，不受其他篩選影響）。
const allTags = ref<string[]>([])
const loading = ref(false)
const listState = ref<ListState>('active')
const campusFilter = ref('')
const kindFilter = ref<'' | 'image' | 'video'>('')
const query = ref('')
// 實際送出的關鍵字：停止輸入 300ms 後才更新（同參觀案件列表）。
const keyword = ref('')
const tagFilter = ref('')
const loadError = ref<string | null>(null)
const limits = ref<MediaUploadLimitsOut | null>(null)
const hasFilters = computed(() => Boolean(query.value.trim() || campusFilter.value || kindFilter.value || tagFilter.value))
function clearFilters() {
  query.value = ''
  clearTimeout(searchTimer)
  keyword.value = ''
  campusFilter.value = ''
  kindFilter.value = ''
  tagFilter.value = ''
}

// 上傳、改說明、替換、封存、刪除要 media.manage（唯讀與櫃台只能看、只能選）。
const canManage = computed(() => can('media.manage'))
// 共用素材（不指定校區）只有能編全站共用內容的人可以上傳；其他人只能選自己的校區。
const canUploadShared = computed(() => canEditSharedContent(authStore.user))
const uploadCampusOptions = computed(() => visibleCampusKeys.value)
function canManageAsset(asset: MediaAssetOut) {
  return canManage.value && (asset.campus_key !== null || canUploadShared.value)
}

// 只列這個帳號看得到的校區（加跨校共用）：列出別校，篩了也是空的，上傳時還會被預選成
// 沒有權限的校區、送出才被後端擋下。
const filterKeys = computed(() => ['__shared', ...visibleCampusKeys.value])
function filterLabel(key: string): string {
  return key === '__shared' ? '跨校共用' : campusLabel(key)
}

const purgeDays = computed(() => limits.value?.purge_delay_days ?? 7)

const listSummary = computed(() => {
  if (loading.value) return '正在讀取素材…'
  if (loadError.value) return '素材尚未載入'
  return hasFilters.value ? `顯示 ${total.value} / ${stateTotal.value} 個素材` : `${stateTotal.value} 個素材`
})

// 快速切換「素材／已封存／待清理」或篩選時，只採用最後一次讀取的回應，
// 先發出、較晚回來的舊清單不能蓋掉目前的清單。
const requests = useRequestSequence()

function listPath(): string {
  const params = new URLSearchParams()
  if (listState.value !== 'active') params.set('state', listState.value)
  if (campusFilter.value) params.set('campus', campusFilter.value)
  if (kindFilter.value) params.set('kind', kindFilter.value)
  if (tagFilter.value) params.set('tag', tagFilter.value)
  if (keyword.value) params.set('q', keyword.value)
  params.set('page', String(page.value))
  params.set('page_size', String(PAGE_SIZE))
  return `/admin/media?${params}`
}

async function load() {
  const request = requests.begin()
  loading.value = true
  loadError.value = null
  try {
    const result = await api.get<MediaAssetPageOut>(listPath())
    if (!requests.isCurrent(request)) return
    assets.value = result.items
    total.value = result.total
    stateTotal.value = result.state_total
    allTags.value = result.tags
  } catch {
    if (requests.isCurrent(request)) loadError.value = '無法讀取素材庫，請重新載入。'
  } finally {
    if (requests.isCurrent(request)) loading.value = false
  }
}

// 封存、刪除、復原、改說明、替換之後重抓目前這一頁（卡片可能離開目前的篩選）；
// 這一頁因此空了就退回上一頁。
async function reloadPage() {
  await load()
  if (!loadError.value && assets.value.length === 0 && page.value > 1) {
    page.value = Math.max(1, Math.min(page.value - 1, Math.ceil(total.value / PAGE_SIZE)))
  }
}

// 邊打字邊查會連發請求，停下來再送。
let searchTimer: ReturnType<typeof setTimeout> | undefined
watch(query, (value) => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => { keyword.value = value.trim() }, 300)
})
onBeforeUnmount(() => clearTimeout(searchTimer))

// 換篩選或切換素材／已封存／待清理都回第 1 頁；已經在第 1 頁就直接重讀（同一次變動不讀兩次）。
const filterKey = computed(() => JSON.stringify([listState.value, campusFilter.value, kindFilter.value, tagFilter.value, keyword.value]))
watch(filterKey, () => {
  if (page.value !== 1) page.value = 1
  else void load()
})
watch(page, () => void load())

// 換頁後回到清單開頭（筆數列），不停在上一頁的底部。
const summaryEl = ref<HTMLElement | null>(null)
function setPage(value: number) {
  page.value = value
  summaryEl.value?.scrollIntoView?.({ block: 'start' })
}

function replaceListed(fresh: MediaAssetOut) {
  const index = assets.value.findIndex((a) => a.id === fresh.id)
  if (index >= 0) assets.value.splice(index, 1, fresh)
}

// 影片轉檔中的卡片自己更新，不必重新整理頁面。
useProcessingPoll(() => assets.value, replaceListed)

// 卡片上的復原、取消封存（封存）、重新處理：請求還沒回來時停用這張卡的按鈕，
// 連按不會送出兩次（第二次常是 409，或重複排入轉檔）。
const pendingIds = reactive(new Set<string>())
async function withPending(asset: MediaAssetOut, action: () => Promise<void>) {
  if (pendingIds.has(asset.id)) return
  pendingIds.add(asset.id)
  try {
    await action()
  } finally {
    pendingIds.delete(asset.id)
  }
}

function retryProcessing(asset: MediaAssetOut) {
  return withPending(asset, async () => {
    try {
      replaceListed(await api.post<MediaAssetOut>(`/admin/media/${asset.id}/retry`))
      ElMessage.success('已重新排入轉檔')
    } catch (err) {
      notifyError(apiErrorMessage(err, '重新處理失敗，請稍後再試'))
    }
  })
}

/** 「首頁最新消息、校園探索（義華）」；沒有草稿在用時回空字串。 */
function usedInText(asset: MediaAssetOut): string {
  return (asset.used_in ?? []).map((u) => contentItemLabel(u.kind, u.campus_key)).join('、')
}

function uploaderText(asset: MediaAssetOut): string {
  return `${staffLabel(staffOf(asset, 'created_by'))}・${formatDate(asset.created_at)}`
}

// ---- 上傳（可一次多檔，逐檔送出，同時最多兩個） ----
const uploadDialogVisible = ref(false)
const uploadCampusKey = ref('')
const uploadAlt = ref('')
const dragOver = ref(false)
const queue = useMediaUploadQueue({ campusKey: () => uploadCampusKey.value, altText: () => uploadAlt.value })
const pendingCount = computed(() => queue.counts.value.queued)
const singleImage = computed(() => queue.items.value.length === 1 && queue.items.value[0]!.kind === 'image')

function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  queue.add(input.files)
  input.value = ''
}

function onDrop(event: DragEvent) {
  dragOver.value = false
  queue.add(event.dataTransfer?.files)
}

function openUpload() {
  // 還在上傳（對話框理應關不掉，這裡是保險）：只把對話框打開，不重設校區與說明，
  // 否則剩下的檔案會用新的校區送出。
  if (queue.running.value) {
    uploadDialogVisible.value = true
    return
  }
  queue.reset()
  uploadAlt.value = ''
  // 照目前的校區篩選預選，但只預選可以上傳的校區。
  uploadCampusKey.value = uploadCampusOptions.value.includes(campusFilter.value) ? campusFilter.value : ''
  if (!uploadCampusKey.value && !canUploadShared.value) uploadCampusKey.value = uploadCampusOptions.value[0] ?? ''
  uploadDialogVisible.value = true
}

async function submitUpload() {
  if (!pendingCount.value) {
    notifyWarning('請先選擇檔案')
    return
  }
  const uploaded = await queue.start()
  const failed = queue.counts.value.failed
  // 新上傳的排在最前面：回到「素材」分頁的第 1 頁。
  if (uploaded.length) {
    if (listState.value !== 'active') listState.value = 'active'
    else if (page.value !== 1) page.value = 1
    else await load()
  }
  if (failed) {
    notifyWarning(`${uploaded.length} 個上傳完成、${failed} 個失敗，失敗原因列在清單裡`)
  } else {
    ElMessage.success(`已上傳 ${uploaded.length} 個檔案`)
    uploadDialogVisible.value = false
  }
}

// 上傳中關分頁或重新整理，剩下的檔案會中斷：交給瀏覽器問一次。
// （在後台裡換頁不會中斷，上傳中對話框也關不掉。）
function warnUploadInterrupted(event: BeforeUnloadEvent) {
  if (!queue.running.value) return
  event.preventDefault()
  event.returnValue = ''
}
onMounted(() => window.addEventListener('beforeunload', warnUploadInterrupted))
onBeforeUnmount(() => window.removeEventListener('beforeunload', warnUploadInterrupted))

// ---- 編輯說明（圖片與影片都可以） ----
const editDialogVisible = ref(false)
const editingAsset = ref<MediaAssetOut | null>(null)
const editAltText = ref('')
const editSourceAttribution = ref('')
const editCaption = ref('')
const editLicense = ref('')
const editTags = ref<string[]>([])
// 素材預設焦點（後端存 0–1；FocusPicker 用 0–100）。null＝沒設，官網置中。
const editFocus = ref<{ x: number; y: number } | null>(null)
const saving = ref(false)
// 打開時的內容；點到背景、按 Esc、X 或「取消」時比對，有改過就先問，不直接丟掉剛打的字。
let editSnapshot = ''
const editState = () =>
  JSON.stringify([editAltText.value, editSourceAttribution.value, editCaption.value, editLicense.value, editTags.value, editFocus.value])

function openEditDialog(asset: MediaAssetOut) {
  editingAsset.value = asset
  editAltText.value = asset.alt_text ?? ''
  editSourceAttribution.value = asset.source_attribution ?? ''
  editCaption.value = asset.caption ?? ''
  editLicense.value = asset.license_note ?? ''
  editTags.value = [...(asset.tags ?? [])]
  editFocus.value =
    asset.crop_focus_x != null && asset.crop_focus_y != null
      ? { x: Math.round(asset.crop_focus_x * 100), y: Math.round(asset.crop_focus_y * 100) }
      : null
  editSnapshot = editState()
  editDialogVisible.value = true
}

async function beforeCloseEdit(done: () => void) {
  if (saving.value) return
  if (editState() !== editSnapshot) {
    try {
      await ElMessageBox.confirm('剛才修改的說明、標籤或焦點還沒儲存，關掉後會遺失。', '放棄這次的修改？', {
        confirmButtonText: '放棄修改',
        cancelButtonText: '先不要',
        type: 'warning',
        confirmButtonClass: 'el-button--danger',
        autofocus: false,
      })
    } catch {
      return
    }
  }
  done()
}

function cancelEdit() {
  void beforeCloseEdit(() => { editDialogVisible.value = false })
}

async function submitEdit() {
  if (!editingAsset.value) return
  saving.value = true
  const isImage = editingAsset.value.kind === 'image'
  try {
    await api.patch(`/admin/media/${editingAsset.value.id}`, {
      expected_version: editingAsset.value.version,
      alt_text: editAltText.value || null,
      source_attribution: editSourceAttribution.value || null,
      caption: editCaption.value || null,
      license_note: editLicense.value || null,
      tags: editTags.value,
      ...(isImage
        ? { crop_focus_x: editFocus.value ? editFocus.value.x / 100 : null, crop_focus_y: editFocus.value ? editFocus.value.y / 100 : null }
        : {}),
    })
    ElMessage.success('已儲存')
    editDialogVisible.value = false
    await reloadPage()
  } catch (err) {
    if (isVersionConflict(err)) await reloadEditing(err)
    else notifyError(apiErrorMessage(err, '儲存失敗'))
  } finally {
    saving.value = false
  }
}

// 別人先改了這個素材的說明：不蓋掉對方，問使用者要不要載入最新的內容重新編輯。
async function reloadEditing(err: unknown) {
  const current = editingAsset.value
  if (!current) return
  try {
    await ElMessageBox.confirm(
      `${apiErrorMessage(err, '這個素材的說明剛被其他人修改')}。重新載入會顯示最新的說明與標籤，你這次的修改會捨棄。`,
      '素材已被更新',
      { confirmButtonText: '重新載入', cancelButtonText: '先不要', type: 'warning' },
    )
  } catch {
    return
  }
  try {
    openEditDialog(await api.get<MediaAssetOut>(`/admin/media/${current.id}`))
  } catch (loadErr) {
    notifyError(apiErrorMessage(loadErr, '重新載入失敗'))
  }
  await reloadPage()
}

// ---- 用在哪裡、替換 ----
const usagesAsset = ref<MediaAssetOut | null>(null)
const usagesVisible = ref(false)
function openUsages(asset: MediaAssetOut) {
  usagesAsset.value = asset
  usagesVisible.value = true
}

const replaceAsset = ref<MediaAssetOut | null>(null)
const replaceVisible = ref(false)
function openReplace(asset: MediaAssetOut) {
  replaceAsset.value = asset
  replaceVisible.value = true
}

// ---- 封存、刪除（標記待清理）、復原 ----
function errorDetail(err: unknown): { code?: string; message?: string } {
  return err instanceof ApiError && err.detail && typeof err.detail === 'object'
    ? (err.detail as { code?: string; message?: string })
    : {}
}

// 卡片已經知道有草稿在用（usage_count 只算各內容的最新草稿），這時封存或刪除
// 一定會被擋：不送出、也不先跳刪除確認，直接說原因並打開「用在哪裡」。
// usage_count 為 0 但線上版、排程或舊版本還在用的情況，照舊交給後端判斷。
function blockedByDraftUsage(asset: MediaAssetOut, action: '封存' | '刪除'): boolean {
  if (asset.usage_count <= 0) return false
  ElMessage.info(`還有內容的草稿在用這個素材，先到內容頁換掉才能${action}。`)
  openUsages(asset)
  return true
}

// 取消封存直接放在卡片上，不在「更多」裡。
type MoreCommand = 'edit' | 'replace' | 'archive' | 'delete'
function onMoreCommand(asset: MediaAssetOut, command: MoreCommand) {
  if (command === 'edit') openEditDialog(asset)
  else if (command === 'replace') openReplace(asset)
  else if (command === 'archive') void setArchived(asset, true)
  else void removeAsset(asset)
}

async function setArchived(asset: MediaAssetOut, archived: boolean) {
  if (archived && blockedByDraftUsage(asset, '封存')) return
  await withPending(asset, async () => {
    try {
      await api.post(`/admin/media/${asset.id}/${archived ? 'archive' : 'unarchive'}`)
      ElMessage.success(archived ? '已封存，可以在「已封存」找回來' : '已取消封存')
      await reloadPage()
    } catch (err) {
      const detail = errorDetail(err)
      notifyError(detail.message ?? (archived ? '封存失敗' : '取消封存失敗'))
      if (detail.code === 'MEDIA_IN_USE') openUsages(asset)
    }
  })
}

async function removeAsset(asset: MediaAssetOut) {
  if (blockedByDraftUsage(asset, '刪除')) return
  try {
    await ElMessageBox.confirm(
      `刪除後會先移到「待清理」，${purgeDays.value} 天內都可以復原，之後檔案會永久刪除。`,
      `刪除「${asset.original_filename}」？`,
      { confirmButtonText: '刪除', cancelButtonText: '先不要', type: 'warning', confirmButtonClass: 'el-button--danger', autofocus: false },
    )
  } catch {
    return
  }
  try {
    await api.delete(`/admin/media/${asset.id}`)
    ElMessage.success(`已移到待清理，${purgeDays.value} 天內可以復原`)
    await reloadPage()
  } catch (err) {
    const detail = errorDetail(err)
    if (detail.code === 'MEDIA_IN_HISTORY' && !asset.archived_at) {
      try {
        await ElMessageBox.confirm(detail.message ?? '', '舊版本還用到這個素材', {
          confirmButtonText: '改為封存',
          cancelButtonText: '先不要',
          type: 'info',
        })
      } catch {
        return
      }
      await setArchived(asset, true)
      return
    }
    notifyError(detail.message ?? '刪除失敗')
    if (detail.code === 'MEDIA_IN_USE' || detail.code === 'MEDIA_IN_HISTORY') openUsages(asset)
  }
}

async function restoreAsset(asset: MediaAssetOut) {
  await withPending(asset, async () => {
    try {
      await api.post(`/admin/media/${asset.id}/restore`)
      ElMessage.success('已復原')
      await reloadPage()
    } catch (err) {
      notifyError(errorDetail(err).message ?? '復原失敗')
    }
  })
}

onMounted(async () => {
  await load()
  limits.value = await loadUploadLimits()
})
</script>

<template>
  <div class="page">
    <PageHeader lead="官網用的照片與影片。" more="標記了校區的素材只有該校內容能選，跨校共用的每一校都能用。還在用的素材不能刪除；不想再看到可以封存，刪除後也會先保留一段時間可以復原。">
      <template #actions>
        <el-button v-if="canManage" type="primary" :icon="Upload" @click="openUpload">上傳素材</el-button>
      </template>
    </PageHeader>

    <!-- 分頁（切換要看哪一批素材）放在篩選面板上方，和下面的篩選分開。 -->
    <el-radio-group v-model="listState" class="media-tabs" aria-label="要看的素材">
      <el-radio-button value="active">素材</el-radio-button>
      <el-radio-button value="archived">已封存</el-radio-button>
      <el-radio-button value="deleted">待清理</el-radio-button>
    </el-radio-group>
    <p v-if="listState === 'deleted'" class="hint state-hint">刪除的素材保留 {{ purgeDays }} 天，時間到了由系統永久刪除檔案；這段期間可以復原。</p>
    <p v-else-if="listState === 'archived'" class="hint state-hint">封存的素材不會出現在選圖器，檔案與舊版本的引用都保留，隨時可以取消封存。</p>

    <div class="filter-bar">
      <label class="filter-field filter-search"><span>搜尋素材</span><el-input v-model="query" placeholder="檔名、圖片說明、內部備註或標籤" clearable /></label>
      <!-- 可清除的下拉選單不能包在 label 裡：按 × 清除後，label 會再點一次選單，清單又自己打開。 -->
      <div class="filter-field"><span>校區</span>
        <el-select v-model="campusFilter" placeholder="全部校區" clearable aria-label="校區">
          <el-option v-for="key in filterKeys" :key="key" :label="filterLabel(key)" :value="key" />
        </el-select>
      </div>
      <div v-if="allTags.length" class="filter-field"><span>標籤</span>
        <el-select v-model="tagFilter" placeholder="全部標籤" clearable filterable aria-label="標籤">
          <el-option v-for="t in allTags" :key="t" :label="t" :value="t" />
        </el-select>
      </div>
      <!-- 一組單選鈕也不能包在 label 裡（點標題會選到第一個），由單選鈕組本身指向可見標題。 -->
      <div class="filter-field">
        <span id="media-kind-label">類型</span>
        <el-radio-group v-model="kindFilter" class="media-kind" aria-labelledby="media-kind-label">
          <el-radio-button value="">全部</el-radio-button>
          <el-radio-button value="image">圖片</el-radio-button>
          <el-radio-button value="video">影片</el-radio-button>
        </el-radio-group>
      </div>
      <el-button v-if="hasFilters" text @click="clearFilters">清除篩選</el-button>
    </div>
    <div ref="summaryEl" class="list-summary" role="status"><span>{{ listSummary }}</span><el-button text :loading="loading" @click="load">重新整理</el-button></div>

    <el-alert v-if="loadError" :title="loadError" type="error" show-icon :closable="false"><el-button @click="load">重新載入</el-button></el-alert>
    <div v-else v-loading="loading" class="media-grid" :class="{ 'is-empty': !loading && assets.length === 0 }" :aria-busy="loading">
      <el-empty
        v-if="!loading && assets.length === 0"
        :description="hasFilters ? '沒有符合條件的素材' : listState === 'archived' ? '沒有封存的素材' : listState === 'deleted' ? '沒有待清理的素材' : '素材庫還是空的，先上傳第一張照片'"
      >
        <el-button v-if="hasFilters" @click="clearFilters">清除篩選</el-button>
        <el-button v-else-if="canManage && listState === 'active'" type="primary" @click="openUpload">上傳素材</el-button>
      </el-empty>

      <article v-for="asset in assets" :key="asset.id" class="media" :data-media-id="asset.id">
        <div class="media__thumb">
          <!-- 列表一律用縮圖（圖片長邊 480、影片自動擷取的畫面），不載原檔。 -->
          <img v-if="asset.status === 'ready' && mediaPreviewUrl(asset)" :src="mediaPreviewUrl(asset)" :alt="asset.alt_text ?? ''" loading="lazy" />
          <div v-else class="media__placeholder">
            <span>{{ asset.kind === 'video' ? `影片・${formatDuration(asset.duration_seconds)}` : mediaStatus(asset.status).label }}</span>
          </div>
          <span v-if="asset.kind === 'video' && asset.status === 'ready' && mediaPreviewUrl(asset)" class="media__duration">影片・{{ formatDuration(asset.duration_seconds) }}</span>
          <StatusTag v-if="asset.status !== 'ready'" :meta="mediaStatus(asset.status)" size="small" class="media__status" />
          <span v-if="asset.usage_count > 0" class="media__usage" :title="usedInText(asset)">使用中 {{ asset.usage_count }}</span>
        </div>
        <div class="media__meta">
          <strong class="media__name" :title="asset.original_filename">{{ asset.original_filename }}</strong>
          <span class="media__sub">
            {{ asset.campus_key ? campusLabel(asset.campus_key) : '跨校共用' }}・{{ formatFileSize(asset.size_bytes) }}<template v-if="asset.width && asset.height">・{{ asset.width }}×{{ asset.height }}</template>
          </span>
          <span class="media__sub" :title="staffEmail(staffOf(asset, 'created_by')) || undefined">上傳：{{ uploaderText(asset) }}</span>
          <span v-if="usedInText(asset)" class="media__sub media__used">用在：{{ usedInText(asset) }}</span>
          <span v-if="asset.deleted_at" class="media__warn">{{ formatDateTime(asset.purge_after) }} 後永久刪除</span>
          <span v-else-if="!asset.alt_text" class="media__warn">{{ asset.kind === 'image' ? '未填圖片說明' : '未填影片說明' }}</span>
          <span v-if="asset.status !== 'ready' && !asset.deleted_at" class="media__warn">{{ processingNote(asset) }}</span>
          <span v-if="asset.tags?.length" class="media__tags">
            <button v-for="t in asset.tags" :key="t" type="button" class="media__tag" :title="`只看標籤「${t}」的素材`" @click="tagFilter = t"><span>{{ t }}</span></button>
          </span>
        </div>
        <!-- 常用的編輯、用在哪裡直接放；替換、封存、刪除收進「更多」，刪除放最後、和封存隔開。 -->
        <div class="media__actions">
          <template v-if="asset.deleted_at">
            <el-button v-if="canManageAsset(asset)" size="small" text type="primary" :loading="pendingIds.has(asset.id)" :disabled="pendingIds.has(asset.id)" @click="restoreAsset(asset)">復原</el-button>
          </template>
          <template v-else>
            <template v-if="canManageAsset(asset)">
              <el-button v-if="asset.archived_at" size="small" text :loading="pendingIds.has(asset.id)" :disabled="pendingIds.has(asset.id)" @click="setArchived(asset, false)">取消封存</el-button>
              <!-- 轉檔中也能補說明（選影片上傳後的提示叫人來按「編輯」）；處理失敗的改放重新處理。 -->
              <el-button v-else-if="asset.status !== 'failed'" size="small" text @click="openEditDialog(asset)">編輯</el-button>
              <el-button v-else-if="canRetryProcessing(asset)" size="small" text type="primary" :loading="pendingIds.has(asset.id)" :disabled="pendingIds.has(asset.id)" @click="retryProcessing(asset)">重新處理</el-button>
            </template>
            <el-button size="small" text @click="openUsages(asset)">用在哪裡</el-button>
            <el-dropdown
              v-if="canManageAsset(asset)"
              trigger="click"
              placement="bottom-end"
              :persistent="false"
              popper-class="media-more-menu"
              @command="(command: MoreCommand) => onMoreCommand(asset, command)"
            >
              <el-button size="small" text class="media__more" :disabled="pendingIds.has(asset.id)" :aria-label="`「${asset.original_filename}」的更多動作`">
                更多<el-icon class="el-icon--right"><ArrowDown /></el-icon>
              </el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item v-if="asset.archived_at && asset.status !== 'failed'" command="edit">編輯</el-dropdown-item>
                  <el-dropdown-item v-if="!asset.archived_at && asset.status === 'ready'" command="replace">替換</el-dropdown-item>
                  <el-dropdown-item v-if="!asset.archived_at" command="archive">封存</el-dropdown-item>
                  <el-dropdown-item command="delete" :divided="asset.status !== 'failed' || !asset.archived_at" class="media-more__danger">刪除</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </template>
        </div>
      </article>
    </div>

    <div v-if="!loadError && total > PAGE_SIZE" class="media-pager">
      <span class="hint">共 {{ total }} 個素材</span>
      <el-pagination :current-page="page" :page-size="PAGE_SIZE" :total="total" layout="prev, pager, next" @current-change="setPage" />
    </div>

    <!-- 上傳中 Esc、X、點背景都關不掉（進度要看得到）；選好的檔案也不會因為點到背景就不見。 -->
    <el-dialog
      v-model="uploadDialogVisible"
      title="上傳素材"
      width="min(520px, 100%)"
      :close-on-click-modal="false"
      :close-on-press-escape="!queue.running.value"
      :show-close="!queue.running.value"
    >
      <el-form label-position="top" @submit.prevent="submitUpload">
        <el-form-item label="檔案">
          <label
            class="drop"
            :class="{ 'is-over': dragOver, 'has-file': queue.items.value.length }"
            @dragover.prevent="dragOver = true"
            @dragleave="dragOver = false"
            @drop.prevent="onDrop"
          >
            <input type="file" multiple accept="image/jpeg,image/png,image/webp,video/mp4" class="drop__input" :disabled="queue.running.value" @change="onFileChange" />
            <strong>{{ queue.items.value.length ? '再加入檔案' : '拖曳檔案到這裡，或點擊選擇' }}</strong>
            <span class="hint">可一次選多個</span>
            <!-- 照片與影片各自成一段換行，手機上不會把「（15 MB 內）」拆到兩行。 -->
            <span class="hint drop__formats">
              <span>照片：{{ uploadKindHint(limits, 'image') }}</span>
              <span>影片：{{ uploadKindHint(limits, 'video') }}</span>
            </span>
          </label>
          <MediaUploadList :items="queue.items.value" :running="queue.running.value" @remove="queue.remove" />
        </el-form-item>
        <el-form-item label="校區">
          <el-select v-model="uploadCampusKey" :placeholder="canUploadShared ? '跨校共用（每一校都能用）' : '請選擇校區'" :clearable="canUploadShared" :disabled="queue.running.value" style="width: 100%">
            <el-option v-for="key in uploadCampusOptions" :key="key" :label="campusLabel(key)" :value="key" />
          </el-select>
          <span class="field-help">{{ canUploadShared ? '留空就是跨校共用，每一校的內容都能選用。' : '跨校共用素材需要「全站共用內容」權限，請選擇你負責的校區。' }}</span>
        </el-form-item>
        <el-form-item v-if="singleImage" label="圖片說明">
          <el-input v-model="uploadAlt" maxlength="500" placeholder="簡短描述照片內容，例如：孩子在戶外沙坑玩耍" />
          <span class="field-help">給看不見圖片的家長與搜尋引擎用，建議填寫。</span>
        </el-form-item>
        <p v-else-if="queue.items.value.length > 1" class="field-help">一次上傳多個檔案時，圖片說明請在上傳後按「編輯」各自補上。</p>
      </el-form>
      <template #footer>
        <el-button :disabled="queue.running.value" @click="uploadDialogVisible = false">{{ queue.counts.value.done ? '關閉' : '取消' }}</el-button>
        <el-button
          type="primary"
          :loading="queue.running.value"
          :disabled="!pendingCount || (!uploadCampusKey && !canUploadShared)"
          @click="submitUpload"
        >{{ queue.running.value ? `上傳中（${queue.counts.value.done + queue.counts.value.failed}／${queue.items.value.length}）` : pendingCount ? `上傳 ${pendingCount} 個檔案` : '選擇檔案後上傳' }}</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="editDialogVisible"
      :title="editingAsset?.kind === 'video' ? '編輯影片說明' : '編輯素材'"
      width="min(520px, 100%)"
      :before-close="beforeCloseEdit"
    >
      <el-form v-if="editingAsset" label-position="top">
        <el-form-item v-if="editingAsset.kind === 'image'" label="預設裁切焦點">
          <FocusPicker v-model="editFocus" :src="mediaFocusUrl(editingAsset)" label="預設裁切焦點" reset-label="清除（置中）" />
          <span class="field-help">
            點照片上最重要的位置（也可以用方向鍵）。首屏、關於、孩子的一天、分校封面與消息封面把照片裁成不同比例時，
            沒有另外設定焦點的版位以這一點為中心；各版位可以在內容頁自己調整，不受這裡影響。校園探索的場景照片在官網照原比例整張顯示、不裁切，不套用。
          </span>
        </el-form-item>
        <p v-else class="field-help">
          {{ formatDuration(editingAsset.duration_seconds) }}<template v-if="editingAsset.width && editingAsset.height">・{{ editingAsset.width }}×{{ editingAsset.height }}</template>・{{ formatFileSize(editingAsset.size_bytes) }}
        </p>
        <el-form-item :label="editingAsset.kind === 'image' ? '圖片說明' : '影片說明'">
          <el-input v-model="editAltText" maxlength="500" :placeholder="editingAsset.kind === 'image' ? '簡短描述照片內容，例如：孩子在戶外沙坑玩耍' : '簡短描述影片內容，例如：孩子在菜園澆水'" />
          <span class="field-help">給看不見畫面的家長與搜尋引擎用，也是素材庫搜尋的依據。</span>
        </el-form-item>
        <el-form-item label="內部備註（不會顯示在官網）">
          <el-input v-model="editCaption" maxlength="500" placeholder="方便搜尋，例如：2025 畢業典禮大合照" />
          <span class="field-help">只給後台搜尋用。照片下方要顯示的字，在各內容頁的「照片下方文字」填。</span>
        </el-form-item>
        <el-form-item label="標籤">
          <el-select v-model="editTags" multiple filterable allow-create default-first-option :reserve-keyword="false" placeholder="輸入後按 Enter，例如：戶外、畢業典禮" style="width: 100%">
            <el-option v-for="t in allTags" :key="t" :label="t" :value="t" />
          </el-select>
          <span class="field-help">方便在素材庫與選圖時找照片，最多 20 個、每個 30 字內。</span>
        </el-form-item>
        <el-form-item label="來源標註">
          <el-input v-model="editSourceAttribution" maxlength="255" placeholder="例如：義華校 2026 春季攝影" />
        </el-form-item>
        <el-form-item label="授權註記">
          <el-input v-model="editLicense" maxlength="255" placeholder="例如：園方自攝，已取得家長公開同意" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button :disabled="saving" @click="cancelEdit">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submitEdit">儲存</el-button>
      </template>
    </el-dialog>

    <MediaUsagesDrawer v-model="usagesVisible" :asset="usagesAsset" />
    <MediaReplaceDialog v-model="replaceVisible" :asset="replaceAsset" @done="reloadPage" />
  </div>
</template>

<style scoped>
.media-tabs { margin-bottom: 12px; }
/* 類型分段鈕和旁邊的輸入框一樣高，標籤才會對齊。 */
.media-kind :deep(.el-radio-button__inner) { display: inline-flex; align-items: center; min-height: var(--control-h); }
.media__tags { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
/* 按鈕本身是點擊範圍，裡面的 span 才是看得到的膠囊；手機把點擊範圍撐到 44px 高。 */
.media__tag { all: unset; cursor: pointer; display: inline-flex; align-items: center; border-radius: 999px; }
.media__tag > span { padding: 0 6px; border-radius: 999px; font-size: var(--text-xs); line-height: 18px; background: var(--surface-3); color: var(--ink-2); }
.media__tag:hover > span { color: var(--ink); }
.media__tag:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: 1px; }
@media (pointer: coarse), (max-width: 720px) {
  .media__tags { gap: 0 8px; margin-top: 0; }
  .media__tag { min-height: 44px; }
  .media__tag > span { padding: 3px 12px; font-size: var(--text-sm); line-height: 20px; }
}
.media-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 16px;
  min-height: 160px;
}

.media-grid.is-empty {
  display: block;
}

.media-pager {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 8px 12px;
  margin-top: 16px;
}

.media {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  background: var(--surface);
  overflow: hidden;
}

.media__thumb {
  position: relative;
  aspect-ratio: 4 / 3;
  background: var(--surface-3);
}

.media__thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.media__placeholder {
  display: grid;
  place-items: center;
  height: 100%;
  color: var(--ink-3);
  font-size: var(--text-sm);
}

.media__status {
  position: absolute;
  top: 8px;
  left: 8px;
}

.media__usage {
  position: absolute;
  right: 8px;
  bottom: 8px;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--photo-caption-bg);
  color: var(--photo-caption-ink);
  font-size: var(--text-xs);
}

.media__meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 12px 6px;
  min-width: 0;
}

.media__name {
  font-size: var(--text-base);
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.media__sub {
  font-size: var(--text-xs);
  color: var(--ink-3);
}

.media__warn {
  font-size: var(--text-xs);
  color: var(--brand-gold-ink);
}

.media__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 2px 4px;
  margin-top: auto;
  padding: 0 8px 8px;
}

.media__actions .el-button + .el-button {
  margin-left: 0;
}

/* 「更多」選單掛在 body 底下，scoped 樣式碰不到，用 popper-class 限定範圍。 */
:global(.media-more-menu .el-dropdown-menu__item.media-more__danger) {
  color: var(--el-color-danger);
}

:global(.media-more-menu .el-dropdown-menu__item.media-more__danger:not(.is-disabled):hover),
:global(.media-more-menu .el-dropdown-menu__item.media-more__danger:not(.is-disabled):focus) {
  background: var(--el-color-danger-light-9);
  color: var(--el-color-danger);
}

@media (pointer: coarse), (max-width: 720px) {
  :global(.media-more-menu .el-dropdown-menu__item) {
    min-height: 44px;
    min-width: 128px;
    font-size: var(--text-md);
  }
}

.media__used {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.state-hint {
  margin: -4px 0 12px;
}

.drop {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  width: 100%;
  padding: 24px 16px;
  border: 1px dashed var(--line-strong);
  border-radius: var(--radius);
  background: var(--surface-2);
  text-align: center;
  cursor: pointer;
  transition: border-color 150ms var(--ease-out), background-color 150ms var(--ease-out);
}

.drop.is-over,
.drop:hover {
  border-color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
}

/* 選檔的 input 是透明的，鍵盤移到這裡時要看得出焦點。
   只看鍵盤焦點：用滑鼠點開選檔視窗再關掉，焦點會留在 input 上，不該一直框著。 */
.drop:has(.drop__input:focus-visible) {
  border-color: var(--el-color-primary);
  outline: 2px solid var(--el-color-primary);
  outline-offset: 2px;
}

.drop.has-file {
  border-style: solid;
}

.drop__formats {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0 12px;
}

.drop__input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
}

.media__duration {
  position: absolute;
  left: 8px;
  bottom: 8px;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--surface);
  color: var(--ink-2);
  font-size: var(--text-xs);
}
</style>
