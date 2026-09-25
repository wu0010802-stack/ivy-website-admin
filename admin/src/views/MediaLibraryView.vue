<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Upload } from '@element-plus/icons-vue'
import { api, ApiError, mediaFocusUrl, mediaPreviewUrl } from '../api/client'
import type { MediaAssetOut, MediaUploadLimitsOut } from '../api/types'
import { apiErrorMessage, isVersionConflict } from '../api/errors'
import { campusLabel, contentItemLabel, formatDate, formatDateTime, formatDuration, formatFileSize, mediaStatus } from '../api/labels'
import { useAuthStore } from '../stores/auth'
import { canEditSharedContent } from '../router/nav'
import { usePermissions } from '../composables/usePermissions'
import { useCampusScope } from '../composables/useCampusScope'
import { loadUploadLimits, uploadFormatHint, useMediaUploadQueue } from '../composables/mediaUpload'
import { CAMPUS_KEYS } from '../api/types'
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
const assets = ref<MediaAssetOut[]>([])
const loading = ref(false)
const listState = ref<ListState>('active')
const campusFilter = ref('')
const kindFilter = ref<'' | 'image' | 'video'>('')
const query = ref('')
const tagFilter = ref('')
const loadError = ref<string | null>(null)
const limits = ref<MediaUploadLimitsOut | null>(null)
const hasFilters = computed(() => Boolean(query.value.trim() || campusFilter.value || kindFilter.value || tagFilter.value))
function clearFilters() { query.value = ''; campusFilter.value = ''; kindFilter.value = ''; tagFilter.value = '' }

// 上傳、改說明、替換、封存、刪除要 media.manage（唯讀與櫃台只能看、只能選）。
const canManage = computed(() => can('media.manage'))
// 共用素材（不指定校區）只有能編全站共用內容的人可以上傳；其他人只能選自己的校區。
const canUploadShared = computed(() => canEditSharedContent(authStore.user))
const uploadCampusOptions = computed(() => visibleCampusKeys.value)
function canManageAsset(asset: MediaAssetOut) {
  return canManage.value && (asset.campus_key !== null || canUploadShared.value)
}

const visibleAssets = computed(() =>
  assets.value.filter(
    (a) =>
      (!campusFilter.value || a.campus_key === campusFilter.value || (campusFilter.value === '__shared' && a.campus_key === null)) &&
      (!kindFilter.value || a.kind === kindFilter.value) &&
      (!tagFilter.value || (a.tags ?? []).includes(tagFilter.value)) &&
      (!query.value.trim() || `${a.original_filename} ${a.alt_text ?? ''} ${a.caption ?? ''} ${(a.tags ?? []).join(' ')}`.toLocaleLowerCase().includes(query.value.trim().toLocaleLowerCase())),
  ),
)

// 篩選選單列出目前素材用過的所有標籤，依使用次數排序。
const allTags = computed(() => {
  const counts = new Map<string, number>()
  for (const a of assets.value) for (const t of a.tags ?? []) counts.set(t, (counts.get(t) ?? 0) + 1)
  return [...counts.entries()].sort((x, y) => y[1] - x[1]).map(([t]) => t)
})

const filterKeys = computed(() => ['__shared', ...CAMPUS_KEYS])
function filterLabel(key: string): string {
  return key === '__shared' ? '跨校共用' : campusLabel(key)
}

const purgeDays = computed(() => limits.value?.purge_delay_days ?? 7)

async function load() {
  loading.value = true
  loadError.value = null
  try {
    const suffix = listState.value === 'active' ? '' : `?state=${listState.value}`
    assets.value = await api.get<MediaAssetOut[]>(`/admin/media${suffix}`)
  } catch {
    loadError.value = '無法讀取素材庫，請重新載入。'
  } finally {
    loading.value = false
  }
}

watch(listState, load)

/** 「首頁最新消息、校園探索（義華）」；沒有草稿在用時回空字串。 */
function usedInText(asset: MediaAssetOut): string {
  return (asset.used_in ?? []).map((u) => contentItemLabel(u.kind, u.campus_key)).join('、')
}

function uploaderText(asset: MediaAssetOut): string {
  const who = asset.created_by_email ? asset.created_by_email.split('@')[0] : '已移除的帳號'
  return `${who}・${formatDate(asset.created_at)}`
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
  queue.reset()
  uploadAlt.value = ''
  uploadCampusKey.value = campusFilter.value && campusFilter.value !== '__shared' ? campusFilter.value : ''
  if (!uploadCampusKey.value && !canUploadShared.value) uploadCampusKey.value = uploadCampusOptions.value[0] ?? ''
  uploadDialogVisible.value = true
}

async function submitUpload() {
  if (!pendingCount.value) {
    ElMessage.warning('請先選擇檔案')
    return
  }
  const uploaded = await queue.start()
  const failed = queue.counts.value.failed
  if (uploaded.length) {
    if (listState.value !== 'active') listState.value = 'active'
    else await load()
  }
  if (failed) {
    ElMessage.warning(`${uploaded.length} 個上傳完成、${failed} 個失敗，失敗原因列在清單裡`)
  } else {
    ElMessage.success(`已上傳 ${uploaded.length} 個檔案`)
    uploadDialogVisible.value = false
  }
}

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
  editDialogVisible.value = true
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
    await load()
  } catch (err) {
    if (isVersionConflict(err)) await reloadEditing(err)
    else ElMessage.error(apiErrorMessage(err, '儲存失敗'))
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
    ElMessage.error(apiErrorMessage(loadErr, '重新載入失敗'))
  }
  await load()
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

async function setArchived(asset: MediaAssetOut, archived: boolean) {
  try {
    await api.post(`/admin/media/${asset.id}/${archived ? 'archive' : 'unarchive'}`)
    ElMessage.success(archived ? '已封存，可以在「已封存」找回來' : '已取消封存')
    await load()
  } catch (err) {
    const detail = errorDetail(err)
    ElMessage.error(detail.message ?? (archived ? '封存失敗' : '取消封存失敗'))
    if (detail.code === 'MEDIA_IN_USE') openUsages(asset)
  }
}

async function removeAsset(asset: MediaAssetOut) {
  try {
    await ElMessageBox.confirm(
      `刪除後會先移到「待清理」，${purgeDays.value} 天內都可以復原，之後檔案會永久刪除。`,
      `刪除「${asset.original_filename}」？`,
      { confirmButtonText: '刪除', cancelButtonText: '先不要', type: 'warning', confirmButtonClass: 'el-button--danger' },
    )
  } catch {
    return
  }
  try {
    await api.delete(`/admin/media/${asset.id}`)
    ElMessage.success(`已移到待清理，${purgeDays.value} 天內可以復原`)
    await load()
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
    ElMessage.error(detail.message ?? '刪除失敗')
    if (detail.code === 'MEDIA_IN_USE' || detail.code === 'MEDIA_IN_HISTORY') openUsages(asset)
  }
}

async function restoreAsset(asset: MediaAssetOut) {
  try {
    await api.post(`/admin/media/${asset.id}/restore`)
    ElMessage.success('已復原')
    await load()
  } catch (err) {
    ElMessage.error(errorDetail(err).message ?? '復原失敗')
  }
}

onMounted(async () => {
  await load()
  limits.value = await loadUploadLimits()
})
</script>

<template>
  <div class="page">
    <PageHeader lead="官網用的照片與影片。標記了校區的素材只有該校內容能選，跨校共用的每一校都能用。還在用的素材不能刪除；不想再看到可以封存，刪除後也會先保留一段時間可以復原。">
      <template #actions>
        <el-button v-if="canManage" type="primary" :icon="Upload" @click="openUpload">上傳素材</el-button>
      </template>
    </PageHeader>

    <div class="toolbar">
      <el-radio-group v-model="listState" aria-label="素材狀態">
        <el-radio-button value="active">素材</el-radio-button>
        <el-radio-button value="archived">已封存</el-radio-button>
        <el-radio-button value="deleted">待清理</el-radio-button>
      </el-radio-group>
      <el-input v-model="query" aria-label="搜尋素材" placeholder="搜尋檔名、圖片說明、圖說或標籤" clearable class="media-search" />
      <el-select v-if="allTags.length" v-model="tagFilter" placeholder="全部標籤" clearable filterable aria-label="標籤" style="width: 140px">
        <el-option v-for="t in allTags" :key="t" :label="t" :value="t" />
      </el-select>
      <el-select v-model="campusFilter" placeholder="全部校區" clearable aria-label="校區">
        <el-option v-for="key in filterKeys" :key="key" :label="filterLabel(key)" :value="key" />
      </el-select>
      <el-radio-group v-model="kindFilter" aria-label="素材類型">
        <el-radio-button value="">全部</el-radio-button>
        <el-radio-button value="image">圖片</el-radio-button>
        <el-radio-button value="video">影片</el-radio-button>
      </el-radio-group>
      <el-button v-if="hasFilters" text @click="clearFilters">清除篩選</el-button>
      <span class="toolbar__spacer" />
      <span class="hint" role="status">{{ loading ? '載入中…' : `${visibleAssets.length} 個素材` }}</span>
    </div>
    <p v-if="listState === 'deleted'" class="hint state-hint">刪除的素材保留 {{ purgeDays }} 天，時間到了由系統永久刪除檔案；這段期間可以復原。</p>
    <p v-else-if="listState === 'archived'" class="hint state-hint">封存的素材不會出現在選圖器，檔案與舊版本的引用都保留，隨時可以取消封存。</p>

    <el-alert v-if="loadError" :title="loadError" type="error" show-icon :closable="false"><el-button @click="load">重新載入</el-button></el-alert>
    <div v-else v-loading="loading" class="media-grid" :class="{ 'is-empty': !loading && visibleAssets.length === 0 }" :aria-busy="loading">
      <el-empty
        v-if="!loading && visibleAssets.length === 0"
        :description="hasFilters ? '沒有符合條件的素材' : listState === 'archived' ? '沒有封存的素材' : listState === 'deleted' ? '沒有待清理的素材' : '素材庫還是空的，先上傳第一張照片'"
      >
        <el-button v-if="hasFilters" @click="clearFilters">清除篩選</el-button>
        <el-button v-else-if="canManage && listState === 'active'" type="primary" @click="openUpload">上傳素材</el-button>
      </el-empty>

      <article v-for="asset in visibleAssets" :key="asset.id" class="media" :data-media-id="asset.id">
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
          <span class="media__sub" :title="asset.created_by_email ?? ''">上傳：{{ uploaderText(asset) }}</span>
          <span v-if="usedInText(asset)" class="media__sub media__used">用在：{{ usedInText(asset) }}</span>
          <span v-if="asset.deleted_at" class="media__warn">{{ formatDateTime(asset.purge_after) }} 後永久刪除</span>
          <span v-else-if="!asset.alt_text" class="media__warn">{{ asset.kind === 'image' ? '未填替代文字' : '未填影片說明' }}</span>
          <span v-if="asset.tags?.length" class="media__tags">
            <button v-for="t in asset.tags" :key="t" type="button" class="media__tag" @click="tagFilter = t">{{ t }}</button>
          </span>
        </div>
        <div class="media__actions">
          <el-button v-if="!asset.deleted_at" size="small" text @click="openUsages(asset)">用在哪裡</el-button>
          <template v-if="canManageAsset(asset)">
            <template v-if="asset.deleted_at">
              <el-button size="small" text type="primary" @click="restoreAsset(asset)">復原</el-button>
            </template>
            <template v-else>
              <el-button v-if="asset.status === 'ready'" size="small" text @click="openEditDialog(asset)">編輯</el-button>
              <el-button v-if="asset.status === 'ready' && !asset.archived_at" size="small" text @click="openReplace(asset)">替換</el-button>
              <el-button v-if="asset.archived_at" size="small" text @click="setArchived(asset, false)">取消封存</el-button>
              <el-button v-else size="small" text @click="setArchived(asset, true)">封存</el-button>
              <el-button size="small" text type="danger" @click="removeAsset(asset)">刪除</el-button>
            </template>
          </template>
        </div>
      </article>
    </div>

    <el-dialog v-model="uploadDialogVisible" title="上傳素材" width="min(520px, 100%)" :close-on-click-modal="!queue.running.value">
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
            <strong>{{ queue.items.value.length ? '再加入檔案' : '拖曳檔案到這裡，或點擊選擇（可一次選多個）' }}</strong>
            <span class="hint">{{ uploadFormatHint(limits) }}</span>
          </label>
          <MediaUploadList :items="queue.items.value" :running="queue.running.value" @remove="queue.remove" />
        </el-form-item>
        <el-form-item label="校區">
          <el-select v-model="uploadCampusKey" :placeholder="canUploadShared ? '不指定（每一校都能用）' : '請選擇校區'" :clearable="canUploadShared" :disabled="queue.running.value" style="width: 100%">
            <el-option v-for="key in uploadCampusOptions" :key="key" :label="campusLabel(key)" :value="key" />
          </el-select>
          <span class="field-help">{{ canUploadShared ? '留空代表每一校的內容都能選用。' : '共用素材需要「全站共用內容」權限，請選擇你負責的校區。' }}</span>
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
        >{{ queue.running.value ? `上傳中（${queue.counts.value.done + queue.counts.value.failed}／${queue.items.value.length}）` : `上傳 ${pendingCount} 個檔案` }}</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="editDialogVisible" :title="editingAsset?.kind === 'video' ? '編輯影片說明' : '編輯素材'" width="min(520px, 100%)">
      <el-form v-if="editingAsset" label-position="top">
        <el-form-item v-if="editingAsset.kind === 'image'" label="預設裁切焦點">
          <FocusPicker v-model="editFocus" :src="mediaFocusUrl(editingAsset)" label="預設裁切焦點" reset-label="清除（置中）" />
          <span class="field-help">
            點照片上最重要的位置（也可以用方向鍵）。首屏、關於、孩子的一天、分校封面與消息封面把照片裁成不同比例時，
            沒有另外設定焦點的版位以這一點為中心；各版位可以在內容頁自己調整，不受這裡影響。校園探索的場景照片不裁切（熱點要對齊整張照片），不套用。
          </span>
        </el-form-item>
        <p v-else class="field-help">
          {{ formatDuration(editingAsset.duration_seconds) }}<template v-if="editingAsset.width && editingAsset.height">・{{ editingAsset.width }}×{{ editingAsset.height }}</template>・{{ formatFileSize(editingAsset.size_bytes) }}
        </p>
        <el-form-item :label="editingAsset.kind === 'image' ? '圖片說明' : '影片說明'">
          <el-input v-model="editAltText" maxlength="500" :placeholder="editingAsset.kind === 'image' ? '簡短描述照片內容，例如：孩子在戶外沙坑玩耍' : '簡短描述影片內容，例如：孩子在菜園澆水'" />
          <span class="field-help">給看不見畫面的家長與搜尋引擎用，也是素材庫搜尋的依據。</span>
        </el-form-item>
        <el-form-item label="圖說">
          <el-input v-model="editCaption" maxlength="500" placeholder="顯示在照片或影片旁的說明文字（選填）" />
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
        <el-button @click="editDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submitEdit">儲存</el-button>
      </template>
    </el-dialog>

    <MediaUsagesDrawer v-model="usagesVisible" :asset="usagesAsset" />
    <MediaReplaceDialog v-model="replaceVisible" :asset="replaceAsset" @done="load" />
  </div>
</template>

<style scoped>
.media__tags { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
.media__tag { all: unset; cursor: pointer; padding: 0 6px; border-radius: 999px; font-size: 11px; line-height: 18px; background: var(--surface-3); color: var(--ink-2); }
.media__tag:focus-visible { outline: 2px solid var(--el-color-primary); }
.media-search { flex: 1 1 220px; max-width: 340px; }
.media-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 16px;
  min-height: 160px;
}

.media-grid.is-empty {
  display: block;
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
  font-size: 13px;
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
  font-size: 11px;
}

.media__meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 12px 6px;
  min-width: 0;
}

.media__name {
  font-size: 14px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.media__sub {
  font-size: 12px;
  color: var(--ink-3);
}

.media__warn {
  font-size: 12px;
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

.drop.has-file {
  border-style: solid;
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
  font-size: 12px;
}
</style>
