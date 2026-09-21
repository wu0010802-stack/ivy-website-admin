<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api, ApiError, mediaFileUrl } from '../api/client'
import { CAMPUS_KEYS } from '../api/types'
import type { MediaAssetOut } from '../api/types'
import { useAuthStore } from '../stores/auth'

const authStore = useAuthStore()
const assets = ref<MediaAssetOut[]>([])
const loading = ref(false)

const uploadDialogVisible = ref(false)
const uploadFile = ref<File | null>(null)
const uploadKind = ref<'image' | 'video'>('image')
const uploadCampusKey = ref<string | ''>('')
const uploadAlt = ref('')
const uploading = ref(false)

async function load() {
  loading.value = true
  try {
    assets.value = await api.get<MediaAssetOut[]>('/admin/media')
  } finally {
    loading.value = false
  }
}

function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  uploadFile.value = input.files?.[0] ?? null
}

async function submitUpload() {
  if (!uploadFile.value) {
    ElMessage.error('請先選擇檔案')
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
    uploadFile.value = null
    uploadAlt.value = ''
    uploadCampusKey.value = ''
    await load()
  } catch (err) {
    if (err instanceof ApiError) {
      const detail = err.detail as { message?: string } | string
      const message = typeof detail === 'object' ? detail.message : detail
      ElMessage.error(message ?? '上傳失敗')
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
const editCropFocusX = ref(0.5)
const editCropFocusY = ref(0.5)
const saving = ref(false)
const focusStageRef = ref<HTMLDivElement | null>(null)

function openEditDialog(asset: MediaAssetOut) {
  editingAsset.value = asset
  editAltText.value = asset.alt_text ?? ''
  editSourceAttribution.value = asset.source_attribution ?? ''
  editCropFocusX.value = asset.crop_focus_x ?? 0.5
  editCropFocusY.value = asset.crop_focus_y ?? 0.5
  editDialogVisible.value = true
}

function pickFocusFromClick(event: MouseEvent) {
  const stage = focusStageRef.value
  if (!stage) return
  const rect = stage.getBoundingClientRect()
  const x = (event.clientX - rect.left) / rect.width
  const y = (event.clientY - rect.top) / rect.height
  editCropFocusX.value = Math.min(1, Math.max(0, x))
  editCropFocusY.value = Math.min(1, Math.max(0, y))
}

async function submitEdit() {
  if (!editingAsset.value) return
  saving.value = true
  try {
    await api.patch(`/admin/media/${editingAsset.value.id}`, {
      alt_text: editAltText.value || null,
      source_attribution: editSourceAttribution.value || null,
      crop_focus_x: editCropFocusX.value,
      crop_focus_y: editCropFocusY.value
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
    await ElMessageBox.confirm(`確定要刪除「${asset.original_filename}」嗎？`, '刪除素材', {
      type: 'warning',
    })
  } catch {
    return
  }
  try {
    await api.delete(`/admin/media/${asset.id}`)
    ElMessage.success('已刪除')
    await load()
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) {
      ElMessage.error('此素材仍被引用，無法刪除')
    } else {
      ElMessage.error('刪除失敗')
    }
  }
}

const canManage = computed(
  () => authStore.user?.role === 'super_admin' || authStore.user?.role === 'campus_admin'
)

onMounted(load)
</script>

<template>
  <div>
    <div style="display: flex; justify-content: space-between; align-items: center">
      <h2>素材庫</h2>
      <el-button v-if="canManage" type="primary" @click="uploadDialogVisible = true">
        上傳素材
      </el-button>
    </div>

    <el-table :data="assets" v-loading="loading" style="margin-top: 1rem">
      <el-table-column label="預覽" width="100">
        <template #default="{ row }: { row: MediaAssetOut }">
          <img
            v-if="row.kind === 'image' && row.status === 'ready'"
            :src="mediaFileUrl(row.id)"
            style="width: 64px; height: 64px; object-fit: cover"
          />
          <el-tag v-else-if="row.kind === 'video'" size="small">影片</el-tag>
          <el-tag v-else type="info" size="small">{{ row.status }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="original_filename" label="檔名" />
      <el-table-column label="校區">
        <template #default="{ row }: { row: MediaAssetOut }">
          {{ row.campus_key ?? '共用' }}
        </template>
      </el-table-column>
      <el-table-column label="狀態">
        <template #default="{ row }: { row: MediaAssetOut }">
          <el-tag :type="row.status === 'ready' ? 'success' : row.status === 'failed' ? 'danger' : 'info'">
            {{ row.status }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="引用數">
        <template #default="{ row }: { row: MediaAssetOut }">
          <el-tag v-if="row.usage_count > 0" type="warning">{{ row.usage_count }}</el-tag>
          <span v-else>0</span>
        </template>
      </el-table-column>
      <el-table-column label="大小">
        <template #default="{ row }: { row: MediaAssetOut }">
          {{ Math.round(row.size_bytes / 1024) }} KB
        </template>
      </el-table-column>
      <el-table-column label="操作" width="160">
        <template #default="{ row }: { row: MediaAssetOut }">
          <el-button
            v-if="canManage && row.kind === 'image' && row.status === 'ready'"
            size="small"
            @click="openEditDialog(row)"
          >
            編輯焦點
          </el-button>
          <el-button
            v-if="canManage"
            size="small"
            type="danger"
            :disabled="row.usage_count > 0"
            @click="removeAsset(row)"
          >
            刪除
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="uploadDialogVisible" title="上傳素材">
      <el-form label-position="top">
        <el-form-item label="檔案">
          <input type="file" accept="image/*,video/mp4" @change="onFileChange" />
        </el-form-item>
        <el-form-item label="種類">
          <el-select v-model="uploadKind">
            <el-option label="圖片" value="image" />
            <el-option label="影片" value="video" />
          </el-select>
        </el-form-item>
        <el-form-item label="校區（留空代表跨校共用）">
          <el-select v-model="uploadCampusKey" clearable>
            <el-option v-for="key in CAMPUS_KEYS" :key="key" :label="key" :value="key" />
          </el-select>
        </el-form-item>
        <el-form-item label="Alt 文字">
          <el-input v-model="uploadAlt" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="uploadDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="uploading" @click="submitUpload">上傳</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="editDialogVisible" title="編輯素材" width="480px">
      <el-form v-if="editingAsset" label-position="top">
        <el-form-item label="裁切焦點（點圖片指定畫面該保留的重點；影響裁切時的置中位置）">
          <div
            ref="focusStageRef"
            style="position: relative; width: 100%; aspect-ratio: 4 / 3; cursor: crosshair; overflow: hidden; border: 1px solid var(--el-border-color)"
            @click="pickFocusFromClick"
          >
            <img
              :src="mediaFileUrl(editingAsset.id)"
              style="width: 100%; height: 100%; object-fit: cover; display: block; pointer-events: none"
            />
            <div
              :style="{
                position: 'absolute',
                left: `${editCropFocusX * 100}%`,
                top: `${editCropFocusY * 100}%`,
                transform: 'translate(-50%, -50%)',
                width: '16px',
                height: '16px',
                borderRadius: '50%',
                border: '2px solid #fff',
                boxShadow: '0 0 0 1px rgba(0,0,0,0.6), 0 0 4px rgba(0,0,0,0.6)',
                background: 'rgba(255, 61, 61, 0.85)',
                pointerEvents: 'none'
              }"
            />
          </div>
          <small style="color: var(--el-text-color-secondary)">
            目前焦點：x={{ editCropFocusX.toFixed(2) }}，y={{ editCropFocusY.toFixed(2) }}（0～1，左上為原點）
          </small>
        </el-form-item>
        <el-form-item label="Alt 文字">
          <el-input v-model="editAltText" />
        </el-form-item>
        <el-form-item label="來源標註">
          <el-input v-model="editSourceAttribution" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submitEdit">儲存</el-button>
      </template>
    </el-dialog>
  </div>
</template>
