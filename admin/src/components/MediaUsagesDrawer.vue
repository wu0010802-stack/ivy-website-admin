<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { api } from '../api/client'
import type { MediaAssetOut, MediaReferenceOut, MediaUsagesOut } from '../api/types'
import {
  contentEditorPath,
  contentItemLabel,
  formatDateTime,
  mediaFieldPathLabel,
  mediaReferenceState,
} from '../api/labels'
import StatusTag from './StatusTag.vue'

// 素材「用在哪裡」：草稿、官網、排程各是哪個內容的哪一版、哪個位置，另列
// 只剩舊版本在用的內容（刪掉會讓那些版本無法還原）。

const props = defineProps<{ modelValue: boolean; asset: MediaAssetOut | null }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()

const visible = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
})

const usages = ref<MediaUsagesOut | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)

interface ItemGroup {
  key: string
  kind: string
  campusKey: string | null
  refs: MediaReferenceOut[]
}

// 同一內容項的多處引用（例如封面與內文都用同一張）收在一起。
const groups = computed<ItemGroup[]>(() => {
  const map = new Map<string, ItemGroup>()
  for (const ref of usages.value?.references ?? []) {
    const group = map.get(ref.content_item_id) ?? {
      key: ref.content_item_id,
      kind: ref.kind,
      campusKey: ref.campus_key,
      refs: [],
    }
    group.refs.push(ref)
    map.set(ref.content_item_id, group)
  }
  return [...map.values()]
})

async function load() {
  if (!props.asset) return
  loading.value = true
  error.value = null
  try {
    usages.value = await api.get<MediaUsagesOut>(`/admin/media/${props.asset.id}/usages`)
  } catch {
    error.value = '無法讀取引用清單，請重新載入。'
  } finally {
    loading.value = false
  }
}

watch(
  () => (visible.value ? props.asset?.id : null),
  (id) => {
    if (id) {
      usages.value = null
      load()
    }
  },
  { immediate: true },
)

defineExpose({ load })
</script>

<template>
  <el-drawer v-model="visible" :title="asset ? `「${asset.original_filename}」用在哪裡` : '用在哪裡'" size="min(480px, 100%)">
    <div v-loading="loading" class="usages" :aria-busy="loading">
      <el-alert v-if="error" :title="error" type="error" show-icon :closable="false"><el-button @click="load">重新載入</el-button></el-alert>
      <template v-else-if="usages">
        <p v-if="!groups.length && !usages.history.length && !usages.untracked_usages" class="hint">
          目前沒有任何內容用到這個素材，可以封存或刪除。
        </p>

        <section v-if="groups.length" class="usages__section">
          <h3 class="usages__heading">使用中</h3>
          <article v-for="group in groups" :key="group.key" class="usages__item">
            <div class="usages__item-head">
              <strong>{{ contentItemLabel(group.kind, group.campusKey) }}</strong>
              <router-link :to="contentEditorPath(group.kind, group.campusKey)" class="usages__link">前往編輯</router-link>
            </div>
            <ul class="usages__refs">
              <li v-for="ref in group.refs" :key="`${ref.revision_id}:${ref.field_path}`" class="usages__ref">
                <span>{{ mediaFieldPathLabel(ref.field_path) }}<template v-if="ref.label">（{{ ref.label }}）</template></span>
                <span class="usages__meta">
                  第 {{ ref.version }} 版
                  <StatusTag v-for="state in ref.states" :key="state" :meta="mediaReferenceState(state)" size="small" />
                  <template v-if="ref.publish_at">・{{ formatDateTime(ref.publish_at) }} 上線</template>
                </span>
              </li>
            </ul>
          </article>
        </section>

        <section v-if="usages.history.length" class="usages__section">
          <h3 class="usages__heading">只在舊版本</h3>
          <p class="hint">這些舊版本還能還原，所以素材不能刪除；不想再看到它可以封存。</p>
          <ul class="usages__refs">
            <li v-for="row in usages.history" :key="row.content_item_id" class="usages__ref">
              <span>{{ contentItemLabel(row.kind, row.campus_key) }}</span>
              <span class="usages__meta">第 {{ row.versions.join('、') }} 版</span>
            </li>
          </ul>
        </section>

        <p v-if="usages.untracked_usages" class="hint">另有 {{ usages.untracked_usages }} 處引用找不到對應的內容版本，一樣視為使用中。</p>
      </template>
    </div>
  </el-drawer>
</template>

<style scoped>
.usages {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-height: 120px;
}

.usages__section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.usages__heading {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}

.usages__item {
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
}

.usages__item-head {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 4px 12px;
}

.usages__link {
  color: var(--el-color-primary);
  font-size: 13px;
}

.usages__refs {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 6px 0 0;
  padding: 0;
  list-style: none;
}

.usages__ref {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 13px;
}

.usages__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  color: var(--ink-3);
  font-size: 12px;
}
</style>
