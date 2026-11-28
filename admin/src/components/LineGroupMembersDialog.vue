<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { api } from '../api/client'
import { lineToolError } from '../api/lineTools'
import type { LineGroupMembersOut } from '../api/types'
import { useRequestSequence } from '../composables/useRequestSequence'

// 群組成員（2026-11-28，docs/specs/2026-11-28-line-apis-design.md §5.1）：開啟時才向 LINE 查，
// 只顯示人數與顯示名稱，不放任何 LINE 代碼。
const props = defineProps<{ modelValue: boolean; targetId: string | null; groupName: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()

const data = ref<LineGroupMembersOut | null>(null)
const loading = ref(false)
const failure = ref<string | null>(null)
const requests = useRequestSequence()

async function load() {
  if (!props.targetId) return
  const request = requests.begin()
  data.value = null
  failure.value = null
  loading.value = true
  try {
    const result = await api.get<LineGroupMembersOut>(`/admin/line/groups/${encodeURIComponent(props.targetId)}/members`)
    if (requests.isCurrent(request)) data.value = result
  } catch (err) {
    if (requests.isCurrent(request)) failure.value = lineToolError(err, '暫時拿不到名單，請稍後再試。', '查太多次了，請稍後再試。')
  } finally {
    if (requests.isCurrent(request)) loading.value = false
  }
}

watch(
  () => [props.modelValue, props.targetId] as const,
  ([open]) => {
    if (open) void load()
  },
  { immediate: true },
)

// LINE 的名單只含用手機版 LINE 的成員，名稱也可能有幾位查不到：人數比名單多時說一聲，免得以為少了誰。
const unlisted = computed(() => {
  const value = data.value
  if (!value || !value.names || value.count === null || value.count === undefined || value.truncated) return 0
  return Math.max(value.count - value.names.length, 0)
})

const notice = computed(() => {
  if (!data.value) return null
  if (data.value.names_unavailable === 'unverified') return '這個官方帳號不是認證帳號，LINE 只提供人數，不提供名單。'
  if (data.value.names_unavailable === 'error') return '暫時拿不到名單，請稍後再試。'
  return null
})
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    :title="`${groupName}的成員`"
    width="420px"
    class="members-dialog"
    data-test="line-members-dialog"
    @update:model-value="(value: boolean) => emit('update:modelValue', value)"
  >
    <div role="status" aria-live="polite" :aria-busy="loading">
      <el-skeleton v-if="loading" animated :rows="3" aria-label="正在向 LINE 查成員" />
      <p v-else-if="failure" class="members__notice" data-test="line-members-error">{{ failure }}</p>
      <template v-else-if="data">
        <p v-if="data.count !== null && data.count !== undefined" class="members__count" data-test="line-members-count">{{ data.count }} 位成員（不含官方帳號）</p>
        <p v-if="notice" class="members__notice" data-test="line-members-notice">{{ notice }}</p>
        <ul v-if="data.names && data.names.length" class="members__names" data-test="line-members-names">
          <li v-for="(name, index) in data.names" :key="`${index}-${name}`">{{ name }}</li>
        </ul>
        <p v-if="data.truncated" class="members__hint" data-test="line-members-truncated">只列出前 200 位</p>
        <p v-else-if="unlisted" class="members__hint" data-test="line-members-unlisted">另有 {{ unlisted }} 位沒有列出：LINE 只提供使用手機版 LINE 的成員名稱。</p>
      </template>
    </div>
  </el-dialog>
</template>

<style scoped>
.members__count {
  margin: 0 0 8px;
  font-weight: 600;
}

.members__notice,
.members__hint {
  margin: 0 0 8px;
  color: var(--ink-2);
  font-size: var(--text-sm);
}

.members__names {
  margin: 0 0 8px;
  padding: 0;
  list-style: none;
  max-height: 50vh;
  overflow-y: auto;
}

.members__names li {
  padding: 6px 0;
  border-bottom: 1px solid var(--line);
  overflow-wrap: anywhere;
}

.members__names li:last-child {
  border-bottom: 0;
}
</style>
