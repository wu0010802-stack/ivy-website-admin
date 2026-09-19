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
      <el-table-column label="操作">
        <template #default="{ row }: { row: MediaAssetOut }">
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
  </div>
</template>
