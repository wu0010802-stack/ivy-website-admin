<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { api, ApiError } from '../api/client'
import type { ContentItemOut, HomeAboutPayload } from '../api/types'

const item = ref<ContentItemOut | null>(null)
const form = ref<HomeAboutPayload>({ title: '', since_label: '', body_text: '', caption: '' })
const saving = ref(false)
const publishing = ref(false)
const isPublished = ref(false)

async function load() {
  item.value = await api.get<ContentItemOut>('/admin/content-items/home-about')
  if (item.value.latest_revision) {
    form.value = { ...item.value.latest_revision.payload }
    isPublished.value = item.value.current_published_revision_id === item.value.latest_revision.id
  }
}

async function save() {
  if (!item.value) return
  saving.value = true
  try {
    item.value = await api.post<ContentItemOut>('/admin/content-items/home-about/revisions', {
      expected_version: item.value.latest_version,
      payload: form.value,
    })
    isPublished.value = false
    ElMessage.success('已儲存草稿')
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) {
      ElMessage.error('內容已被其他人更新，請重新載入後再試')
    } else if (err instanceof ApiError) {
      ElMessage.error(typeof err.detail === 'object' ? JSON.stringify(err.detail) : String(err.detail))
    } else {
      ElMessage.error('儲存失敗')
    }
  } finally {
    saving.value = false
  }
}

async function publish() {
  if (!item.value?.latest_revision) return
  publishing.value = true
  try {
    item.value = await api.post<ContentItemOut>('/admin/content-items/home-about/publish', {
      revision_id: item.value.latest_revision.id,
    })
    isPublished.value = true
    ElMessage.success('已發布到官網')
  } catch (err) {
    ElMessage.error('發布失敗')
  } finally {
    publishing.value = false
  }
}

onMounted(load)
</script>

<template>
  <div style="max-width: 640px">
    <h2>首頁「關於常春藤」文字</h2>
    <p style="color: var(--el-text-color-secondary)">
      階段 B 第一版只開放這一段內容做即時編輯／發布示範，其餘首頁內容仍由設計端 fixture 提供。
    </p>
    <el-tag v-if="isPublished" type="success">目前草稿已發布</el-tag>
    <el-tag v-else type="warning">尚有未發布的草稿</el-tag>

    <el-form label-position="top" style="margin-top: 1rem" @submit.prevent>
      <el-form-item label="標題">
        <el-input v-model="form.title" />
      </el-form-item>
      <el-form-item label="Since 標籤">
        <el-input v-model="form.since_label" />
      </el-form-item>
      <el-form-item label="內文">
        <el-input v-model="form.body_text" type="textarea" :rows="8" />
      </el-form-item>
      <el-form-item label="說明文字">
        <el-input v-model="form.caption" />
      </el-form-item>
      <el-form-item>
        <el-button type="primary" :loading="saving" @click="save">儲存草稿</el-button>
        <el-button
          type="success"
          :loading="publishing"
          :disabled="!item?.latest_revision"
          @click="publish"
        >
          發布到官網
        </el-button>
      </el-form-item>
    </el-form>
  </div>
</template>
