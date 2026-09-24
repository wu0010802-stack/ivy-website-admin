<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Upload } from '@element-plus/icons-vue'
import { api, ApiError, mediaFileUrl } from '../api/client'
import { CAMPUS_KEYS } from '../api/types'
import type { MediaAssetOut } from '../api/types'
import { campusLabel, formatFileSize, mediaStatus } from '../api/labels'
import { useAuthStore } from '../stores/auth'
import { canEditSharedContent } from '../router/nav'
import PageHeader from '../components/PageHeader.vue'
import StatusTag from '../components/StatusTag.vue'

const authStore = useAuthStore()
const assets = ref<MediaAssetOut[]>([])
const loading = ref(false)
const campusFilter = ref('')
const kindFilter = ref<'' | 'image' | 'video'>('')
const query = ref('')
const tagFilter = ref('')
const loadError = ref<string | null>(null)
const hasFilters = computed(() => Boolean(query.value.trim() || campusFilter.value || kindFilter.value || tagFilter.value))
function clearFilters() { query.value = ''; campusFilter.value = ''; kindFilter.value = ''; tagFilter.value = '' }

const uploadDialogVisible = ref(false)
const uploadFile = ref<File | null>(null)
const uploadKind = ref<'image' | 'video'>('image')
const uploadCampusKey = ref('')
const uploadAlt = ref('')
const uploading = ref(false)
const dragOver = ref(false)

const canManage = computed(() => ['super_admin', 'campus_admin', 'editor'].includes(authStore.user?.role ?? ''))
// 共用素材（不指定校區）只有能編全站共用內容的人可以上傳；其他人只能選自己的校區。
const canUploadShared = computed(() => canEditSharedContent(authStore.user))
const uploadCampusOptions = computed(() =>
  authStore.user?.role === 'super_admin' ? [...CAMPUS_KEYS] : (authStore.user?.campus_keys ?? []),
)

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

async function load() {
  loading.value = true
  loadError.value = null
  try {
    assets.value = await api.get<MediaAssetOut[]>('/admin/media')
  } catch {
    loadError.value = '無法讀取素材庫，請重新載入。'
  } finally {
    loading.value = false
  }
}

function acceptFile(file: File | null) {
  uploadFile.value = file
  if (file) uploadKind.value = file.type.startsWith('video/') ? 'video' : 'image'
}

function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  acceptFile(input.files?.[0] ?? null)
}

function onDrop(event: DragEvent) {
  dragOver.value = false
  acceptFile(event.dataTransfer?.files?.[0] ?? null)
}

function openUpload() {
  uploadFile.value = null
  uploadAlt.value = ''
  uploadCampusKey.value = campusFilter.value && campusFilter.value !== '__shared' ? campusFilter.value : ''
  if (!uploadCampusKey.value && !canUploadShared.value) uploadCampusKey.value = uploadCampusOptions.value[0] ?? ''
  uploadDialogVisible.value = true
}

async function submitUpload() {
  if (!uploadFile.value) {
    ElMessage.warning('請先選擇檔案')
    return
  }
  const formData = new FormData()
  formData.append('file', uploadFile.value)
  formData.append('kind', uploadKind.value)
  if (uploadCampusKey.value) formData.append('campus_key', uploadCampusKey.value)
  if (uploadAlt.value) formData.append('alt_text', uploadAlt.value)

  uploading.value = true
  try {
    await api.upload<MediaAssetOut>('/admin/media', formData)
    ElMessage.success('已上傳')
    uploadDialogVisible.value = false
    await load()
  } catch (err) {
    if (err instanceof ApiError) {
      const detail = err.detail as { message?: string } | string
      ElMessage.error((typeof detail === 'object' ? detail.message : detail) ?? '上傳失敗')
    } else {
      ElMessage.error('上傳失敗')
    }
  } finally {
    uploading.value = false
  }
}

const editDialogVisible = ref(false)
const editingAsset = ref<MediaAssetOut | null>(null)
const editAltText = ref('')
const editSourceAttribution = ref('')
const editCaption = ref('')
const editLicense = ref('')
const editTags = ref<string[]>([])
const editCropFocusX = ref(0.5)
const editCropFocusY = ref(0.5)
const saving = ref(false)
const focusStageRef = ref<HTMLDivElement | null>(null)

function openEditDialog(asset: MediaAssetOut) {
  editingAsset.value = asset
  editAltText.value = asset.alt_text ?? ''
  editSourceAttribution.value = asset.source_attribution ?? ''
  editCaption.value = asset.caption ?? ''
  editLicense.value = asset.license_note ?? ''
  editTags.value = [...(asset.tags ?? [])]
  editCropFocusX.value = asset.crop_focus_x ?? 0.5
  editCropFocusY.value = asset.crop_focus_y ?? 0.5
  editDialogVisible.value = true
}

function pickFocusFromClick(event: MouseEvent) {
  const stage = focusStageRef.value
  if (!stage) return
  const rect = stage.getBoundingClientRect()
  editCropFocusX.value = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
  editCropFocusY.value = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height))
}

async function submitEdit() {
  if (!editingAsset.value) return
  saving.value = true
  try {
    await api.patch(`/admin/media/${editingAsset.value.id}`, {
      alt_text: editAltText.value || null,
      source_attribution: editSourceAttribution.value || null,
      caption: editCaption.value || null,
      license_note: editLicense.value || null,
      tags: editTags.value,
      crop_focus_x: editCropFocusX.value,
      crop_focus_y: editCropFocusY.value,
    })
    ElMessage.success('已儲存')
    editDialogVisible.value = false
    await load()
  } catch {
    ElMessage.error('儲存失敗')
  } finally {
    saving.value = false
  }
}

async function removeAsset(asset: MediaAssetOut) {
  try {
    await ElMessageBox.confirm(`刪除後無法復原。`, `刪除「${asset.original_filename}」？`, {
      confirmButtonText: '刪除',
      cancelButtonText: '先不要',
      type: 'warning',
      confirmButtonClass: 'el-button--danger',
    })
  } catch {
    return
  }
  try {
    await api.delete(`/admin/media/${asset.id}`)
    ElMessage.success('已刪除')
    await load()
  } catch (err) {
    ElMessage.error(err instanceof ApiError && err.status === 409 ? '這個素材仍在官網使用中，先在內容頁換掉才能刪除' : '刪除失敗')
  }
}

onMounted(load)
</script>

<template>
  <div class="page">
    <PageHeader lead="官網用的照片與影片。標記了校區的素材只有該校內容能選，跨校共用的每一校都能用；被引用中的素材無法刪除。">
      <template #actions>
        <el-button v-if="canManage" type="primary" :icon="Upload" @click="openUpload">上傳素材</el-button>
      </template>
    </PageHeader>

    <div class="toolbar">
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

    <el-alert v-if="loadError" :title="loadError" type="error" show-icon :closable="false"><el-button @click="load">重新載入</el-button></el-alert>
    <div v-else v-loading="loading" class="media-grid" :class="{ 'is-empty': !loading && visibleAssets.length === 0 }" :aria-busy="loading">
      <el-empty v-if="!loading && visibleAssets.length === 0" :description="hasFilters ? '沒有符合條件的素材' : '素材庫還是空的，先上傳第一張照片'">
        <el-button v-if="hasFilters" @click="clearFilters">清除篩選</el-button>
        <el-button v-else-if="canManage" type="primary" @click="openUpload">上傳素材</el-button>
      </el-empty>

      <article v-for="asset in visibleAssets" :key="asset.id" class="media">
        <div class="media__thumb">
          <img v-if="asset.kind === 'image' && asset.status === 'ready'" :src="mediaFileUrl(asset.id)" :alt="asset.alt_text ?? ''" loading="lazy" />
          <div v-else class="media__placeholder">
            <span>{{ asset.kind === 'video' ? '影片' : mediaStatus(asset.status).label }}</span>
          </div>
          <StatusTag v-if="asset.status !== 'ready'" :meta="mediaStatus(asset.status)" size="small" class="media__status" />
          <span v-if="asset.usage_count > 0" class="media__usage" :title="`被 ${asset.usage_count} 處內容引用`">使用中 {{ asset.usage_count }}</span>
        </div>
        <div class="media__meta">
          <strong class="media__name" :title="asset.original_filename">{{ asset.original_filename }}</strong>
          <span class="media__sub">
            {{ asset.campus_key ? campusLabel(asset.campus_key) : '跨校共用' }}・{{ formatFileSize(asset.size_bytes) }}<template v-if="asset.width && asset.height">・{{ asset.width }}×{{ asset.height }}</template>
          </span>
          <span v-if="!asset.alt_text && asset.kind === 'image'" class="media__warn">未填替代文字</span>
          <span v-if="asset.tags?.length" class="media__tags">
            <button v-for="t in asset.tags" :key="t" type="button" class="media__tag" @click="tagFilter = t">{{ t }}</button>
          </span>
        </div>
        <div v-if="canManage && (asset.campus_key || canUploadShared)" class="media__actions">
          <el-button v-if="asset.kind === 'image' && asset.status === 'ready'" size="small" text @click="openEditDialog(asset)">編輯</el-button>
          <el-tooltip :content="asset.usage_count > 0 ? '仍在使用中，無法刪除' : '刪除'" placement="top">
            <span>
              <el-button size="small" text type="danger" :disabled="asset.usage_count > 0" @click="removeAsset(asset)">刪除</el-button>
            </span>
          </el-tooltip>
        </div>
      </article>
    </div>

    <el-dialog v-model="uploadDialogVisible" title="上傳素材" width="480px">
      <el-form label-position="top" @submit.prevent="submitUpload">
        <el-form-item label="檔案">
          <label
            class="drop"
            :class="{ 'is-over': dragOver, 'has-file': uploadFile }"
            @dragover.prevent="dragOver = true"
            @dragleave="dragOver = false"
            @drop.prevent="onDrop"
          >
            <input type="file" accept="image/*,video/mp4" class="drop__input" @change="onFileChange" />
            <template v-if="uploadFile">
              <strong>{{ uploadFile.name }}</strong>
              <span class="hint">{{ formatFileSize(uploadFile.size) }}・點擊可更換</span>
            </template>
            <template v-else>
              <strong>拖曳檔案到這裡，或點擊選擇</strong>
              <span class="hint">JPG、PNG、WebP 或 MP4</span>
            </template>
          </label>
        </el-form-item>
        <el-form-item label="校區">
          <el-select v-model="uploadCampusKey" :placeholder="canUploadShared ? '不指定（每一校都能用）' : '請選擇校區'" :clearable="canUploadShared" style="width: 100%">
            <el-option v-for="key in uploadCampusOptions" :key="key" :label="campusLabel(key)" :value="key" />
          </el-select>
          <span class="field-help">{{ canUploadShared ? '留空代表每一校的內容都能選用。' : '共用素材需要「全站共用內容」權限，請選擇你負責的校區。' }}</span>
        </el-form-item>
        <el-form-item v-if="uploadKind === 'image'" label="圖片說明">
          <el-input v-model="uploadAlt" placeholder="簡短描述照片內容，例如：孩子在戶外沙坑玩耍" />
          <span class="field-help">給看不見圖片的家長與搜尋引擎用，建議填寫。</span>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="uploadDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="uploading" :disabled="!uploadFile || (!uploadCampusKey && !canUploadShared)" @click="submitUpload">上傳</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="editDialogVisible" title="編輯素材" width="520px">
      <el-form v-if="editingAsset" label-position="top">
        <el-form-item label="裁切焦點">
          <div ref="focusStageRef" class="focus" @click="pickFocusFromClick">
            <img :src="mediaFileUrl(editingAsset.id)" alt="" />
            <span class="focus__pin" :style="{ left: `${editCropFocusX * 100}%`, top: `${editCropFocusY * 100}%` }" />
          </div>
          <span class="field-help">點照片上最重要的位置。官網把照片裁成不同比例時，會盡量保留這一點。</span>
        </el-form-item>
        <el-form-item label="圖片說明">
          <el-input v-model="editAltText" placeholder="簡短描述照片內容，例如：孩子在戶外沙坑玩耍" />
          <span class="field-help">給看不見圖片的家長與搜尋引擎用，也是素材庫搜尋的依據。</span>
        </el-form-item>
        <el-form-item label="圖說">
          <el-input v-model="editCaption" maxlength="500" placeholder="顯示在照片旁的說明文字（選填）" />
        </el-form-item>
        <el-form-item label="標籤">
          <el-select v-model="editTags" multiple filterable allow-create default-first-option :reserve-keyword="false" placeholder="輸入後按 Enter，例如：戶外、畢業典禮" style="width: 100%">
            <el-option v-for="t in allTags" :key="t" :label="t" :value="t" />
          </el-select>
          <span class="field-help">方便在素材庫與選圖時找照片，最多 20 個、每個 30 字內。</span>
        </el-form-item>
        <el-form-item label="來源標註">
          <el-input v-model="editSourceAttribution" placeholder="例如：義華校 2026 春季攝影" />
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
  justify-content: flex-end;
  padding: 0 8px 8px;
}

.drop {
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

.focus {
  position: relative;
  width: 100%;
  aspect-ratio: 4 / 3;
  overflow: hidden;
  border-radius: var(--radius);
  cursor: crosshair;
}

.focus img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  pointer-events: none;
}

.focus__pin {
  position: absolute;
  width: 18px;
  height: 18px;
  transform: translate(-50%, -50%);
  border: 2px solid var(--on-photo);
  border-radius: 50%;
  background: var(--brand-gold);
  box-shadow: 0 0 0 1px var(--on-photo-shadow-strong), 0 0 6px var(--on-photo-shadow-strong);
  pointer-events: none;
}
</style>
