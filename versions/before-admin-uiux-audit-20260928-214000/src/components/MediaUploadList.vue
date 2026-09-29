<script setup lang="ts">
import { formatFileSize } from '../api/labels'
import type { StatusMeta } from '../api/labels'
import { UPLOAD_STATUS_LABELS, type UploadItem, type UploadStatus } from '../composables/mediaUpload'
import StatusTag from './StatusTag.vue'

defineProps<{ items: UploadItem[]; running: boolean }>()
defineEmits<{ remove: [id: number] }>()

const TONES: Record<UploadStatus, StatusMeta['tone']> = {
  queued: 'info',
  uploading: 'warning',
  done: 'success',
  failed: 'danger',
}

function meta(status: UploadStatus): StatusMeta {
  return { label: UPLOAD_STATUS_LABELS[status], tone: TONES[status] }
}
</script>

<template>
  <ul v-if="items.length" class="uploads" aria-label="上傳清單">
    <li v-for="item in items" :key="item.id" class="uploads__row" :data-status="item.status">
      <span class="uploads__name" :title="item.file.name">{{ item.file.name }}</span>
      <span class="uploads__size">{{ formatFileSize(item.file.size) }}</span>
      <StatusTag :meta="meta(item.status)" size="small" />
      <el-button
        v-if="item.status === 'queued' || item.status === 'failed'"
        size="small"
        text
        :disabled="running"
        :aria-label="`移除 ${item.file.name}`"
        @click="$emit('remove', item.id)"
      >移除</el-button>
      <span v-if="item.error" class="uploads__error" role="alert">{{ item.error }}</span>
    </li>
  </ul>
</template>

<style scoped>
.uploads {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 240px;
  margin: 8px 0 0;
  padding: 0;
  overflow-y: auto;
  list-style: none;
}

.uploads__row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 8px;
  padding: 6px 8px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
  font-size: 13px;
}

.uploads__name {
  flex: 1 1 140px;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.uploads__size {
  color: var(--ink-3);
  font-size: 12px;
}

.uploads__error {
  flex-basis: 100%;
  color: var(--el-color-danger);
  font-size: 12px;
}
</style>
