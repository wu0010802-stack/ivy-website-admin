<script setup lang="ts">
import { ref, watch } from 'vue'
import EnrolledImportCard from './EnrolledImportCard.vue'
import HistoryImportCard from './HistoryImportCard.vue'
import { getImportStatus } from '../../../api/admissions'
import type { ImportStatus } from '../../../api/types'
import { useRequestSequence } from '../../../composables/useRequestSequence'

// 資料匯入（2026-10-21 規格 §7）：總管理者在這裡上傳在籍清冊與歷年註冊統計表，預覽後整校取代，不再需要本機 CLI。
// 校區跟頁首，不分入學學年學期。讀「目前資料」的寫法同 PotentialTab：換校區先清空再讀、只採用最後一次的回應；
// active 為 false（不在這個子分頁）時換校區只記下要重讀，回來才讀。
// 卡片匯入或清除成功後 emit imported，這裡重讀狀態但不先清空：清空會卸載兩張卡片，另一張的預覽會跟著消失。
const props = withDefaults(defineProps<{ campusKey: string; active?: boolean }>(), { active: true })

const status = ref<ImportStatus | null>(null)
const failed = ref(false)
const requests = useRequestSequence()
let pending = false

async function load() {
  pending = false
  const request = requests.begin()
  failed.value = false
  if (!props.campusKey) {
    status.value = null
    return
  }
  try {
    const result = await getImportStatus(props.campusKey)
    if (requests.isCurrent(request)) status.value = result
  } catch {
    if (requests.isCurrent(request)) {
      status.value = null
      failed.value = true
    }
  }
}

function refresh() {
  requests.begin()
  status.value = null
  if (props.active) void load()
  else pending = true
}
watch(() => props.campusKey, refresh, { immediate: true })
watch(() => props.active, (active) => { if (active && pending) void load() })
</script>

<template>
  <section class="imports" aria-label="資料匯入">
    <el-alert v-if="failed" type="error" :closable="false" show-icon title="無法讀取目前的匯入資料，請重新載入。" class="inline-error">
      <el-button size="small" @click="load()">重新載入</el-button>
    </el-alert>
    <el-skeleton v-else-if="!status" :rows="5" animated />
    <div v-else class="imports-body">
      <EnrolledImportCard :campus-key="campusKey" :status="status" @imported="load()" />
      <HistoryImportCard :campus-key="campusKey" :status="status" @imported="load()" />
    </div>
  </section>
</template>

<style scoped>
.imports {
  min-width: 0;
}

.imports-body {
  display: grid;
  gap: 16px;
  max-width: 880px;
  min-width: 0;
}

/* 兩張卡片共用的版面（卡片、目前資料、預覽的「匯入到」大字、事實列、表格）；各卡片自己的細節寫在卡片裡。 */
.imports-body :deep(.import-card) {
  display: grid;
  gap: 14px;
  min-width: 0;
  padding: 16px 18px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
}

.imports-body :deep(.import-card__title) {
  margin: 0;
  color: var(--ink);
  font-size: var(--text-lg);
  font-weight: 600;
}

.imports-body :deep(.import-card__label) {
  margin: 0 0 6px;
  color: var(--ink-2);
  font-size: var(--text-sm);
  font-weight: 600;
}

.imports-body :deep(.import-facts) {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 8px 16px;
  margin: 0;
}

.imports-body :deep(.import-facts dt) {
  color: var(--ink-3);
  font-size: var(--text-xs);
}

.imports-body :deep(.import-facts dd) {
  margin: 0;
  color: var(--ink);
}

.imports-body :deep(.import-card__warn) {
  margin: 8px 0 0;
  color: var(--el-color-warning-dark-2);
  font-size: var(--text-sm);
}

.imports-body :deep(.import-card__pick) {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
}

.imports-body :deep(.import-card__pick .hint) {
  margin: 0;
}

.imports-body :deep(.import-card__alert) {
  margin: 0;
}

.imports-body :deep(.import-preview) {
  display: grid;
  gap: 10px;
  min-width: 0;
  padding: 14px 16px;
  border-radius: var(--radius);
  background: var(--surface-2);
}

/* 選錯校的防呆（規格 §7）：預覽與確認對話框都用大字寫「匯入到：〇〇」。 */
.imports-body :deep(.import-target) {
  margin: 0;
  color: var(--ink);
  font-size: var(--text-2xl);
  font-weight: 700;
}

.imports-body :deep(.import-preview p) {
  margin: 0;
}

.imports-body :deep(.import-preview__line) {
  color: var(--ink-2);
}

.imports-body :deep(.import-table) {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-sm);
}

.imports-body :deep(.import-table th),
.imports-body :deep(.import-table td) {
  padding: 6px 8px;
  border-bottom: 1px solid var(--line);
  text-align: left;
}

.imports-body :deep(.import-table thead th) {
  color: var(--ink-2);
  font-weight: 600;
}

.imports-body :deep(.import-preview__actions) {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
}

@media (max-width: 720px) {
  .imports-body :deep(.import-card) {
    padding: 14px;
  }

  .imports-body :deep(.import-preview) {
    padding: 12px;
  }

  .imports-body :deep(.import-target) {
    font-size: var(--text-xl);
  }
}
</style>
