<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { apiErrorMessage } from '../../api/errors'
import { formatDate, VISIT_EXCLUDE_REASON_LABELS } from '../../api/labels'
import { includeVisit } from '../../api/visitExclusion'
import { visitEventActor } from '../../api/visitHistory'
import { injectVisitCase } from '../../composables/useVisitCase'
import { notifyError } from '../../composables/notify'

// 已排除的橫幅（2026-10-15 規格 §3.4）：頁首下方一條灰色橫幅；有關聯的招生訪視時加一句（E10）。
const vc = injectVisitCase()
const busy = ref(false)
const detail = computed(() => vc.detail)
// 最近一次「標記為排除」的歷程事件：誰、什麼時候標的（取消再標記時以最新的為準）。
const marker = computed(() => [...(detail.value?.history ?? [])].reverse().find((event) => event.event_type === 'excluded'))
const reasonText = computed(() => VISIT_EXCLUDE_REASON_LABELS[detail.value?.exclude_reason ?? ''] ?? '其他')
const byText = computed(() => {
  const parts = [marker.value ? visitEventActor(marker.value) : '', detail.value?.excluded_at ? `${formatDate(detail.value.excluded_at)} 標記` : '']
  return parts.filter(Boolean).join(' ')
})

async function include() {
  if (!detail.value || busy.value) return
  busy.value = true
  try {
    await includeVisit(detail.value.id)
    ElMessage.success('已取消排除')
    await vc.refreshDetail()
  } catch (err) {
    notifyError(apiErrorMessage(err, '取消排除失敗，請稍後再試'))
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div v-if="detail?.excluded_at" class="exclusion-banner" role="status">
    <p>
      <strong>已排除：{{ reasonText }}</strong><span v-if="byText">（{{ byText }}）</span>
      <span v-if="detail.exclude_note">・{{ detail.exclude_note }}</span>
      <el-button v-if="vc.canManage" link type="primary" :loading="busy" @click="include">取消排除</el-button>
    </p>
    <p v-if="vc.familyVisit" class="hint">這筆預約已排除，但招生訪視仍會算進招生統計；如果是測試資料，請到招生入學刪除訪視。</p>
  </div>
</template>

<style scoped>
/* 頁首下面有 24px 外距；橫幅往上貼近頁首，下面補回同樣的間距給兩欄。 */
.exclusion-banner {
  margin: -8px 0 24px;
  padding: 10px 14px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--surface-3);
  color: var(--ink);
}

.exclusion-banner p {
  margin: 0;
}

.exclusion-banner p + p {
  margin-top: 4px;
}
</style>
