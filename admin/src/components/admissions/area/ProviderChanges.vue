<script setup lang="ts">
import { computed, useId } from 'vue'
import type { AreaChange, AreaChanges } from '../../../api/types'
import {
  campusNotLocatedReason, changeDateText, changeLabel, changesEmptyText, changesSubtitle, formatDistance, kindChangeText,
  providerLabel, shortName, babycareShortName, trackingNote,
} from './areaFormat'

// 附近園所的變化（2026-10-14 規格 7.3）：本校半徑內近 12 個月的新設、停辦、類型變動，幼兒園與托嬰都涵蓋，
// 後端已依日期新到舊排好。這一版列不可點（停辦的園所不在地圖上）。
// 幼兒園類型變動與托嬰異動從基準日才開始累積（幼兒園停辦有教育部名單回補，2026-10-15），底下小字老實說從哪天起記錄；
// 多數時候件數不多，空的也是正常的。
const props = defineProps<{ data: AreaChanges | null; failed: boolean; radiusKm: number }>()
const emit = defineEmits<{ retry: [] }>()

const headingId = useId()
const notLocated = computed(() => {
  const reason = props.data?.campus.locate_error
  return reason ? `${campusNotLocatedReason(reason) ?? '本校位置尚未確定'}，無法列出附近園所的變化。` : ''
})
const note = computed(() => (props.data ? trackingNote(props.data.tracking_since, props.data.window_months) : ''))
// 兩邊都還沒開始記錄時 items 必然是空的，不能再寫「沒有…」像是紀錄完整，只留「尚未開始記錄。」
const neverTracked = computed(() => !props.data?.tracking_since.kindergarten && !props.data?.tracking_since.babycare)
const nameOf = (item: AreaChange): string => (item.provider === 'babycare' ? babycareShortName(item.name) : shortName(item.name))
const metaOf = (item: AreaChange): string => {
  const kind = kindChangeText(item)
  return kind ? `${formatDistance(item.distance_m)}・${kind}` : formatDistance(item.distance_m)
}
const tagType = (change: string): 'success' | 'warning' | 'info' =>
  change === 'opened' ? 'success' : change === 'closed' ? 'warning' : 'info'
</script>

<template>
  <section class="changes" :aria-labelledby="headingId">
    <div class="changes__head">
      <h3 :id="headingId" class="changes__title">附近園所的變化</h3>
      <span class="hint">{{ changesSubtitle(radiusKm, data?.window_months ?? 12) }}</span>
    </div>

    <el-alert v-if="failed" type="error" :closable="false" show-icon title="無法讀取附近園所的變化。">
      <el-button size="small" @click="emit('retry')">重新載入</el-button>
    </el-alert>
    <el-skeleton v-else-if="!data" :rows="3" animated />
    <p v-else-if="notLocated" class="changes__empty">{{ notLocated }}</p>
    <template v-else>
      <ul v-if="data.items.length" class="changes__list">
        <li v-for="item in data.items" :key="`${item.provider}-${item.source_id}-${item.change}`" class="changes__item">
          <span class="changes__when num">{{ changeDateText(item) }}</span>
          <span class="changes__line">
            <el-tag size="small" :type="tagType(item.change)" effect="plain" round>{{ changeLabel(item.change) }}</el-tag>
            <el-tag size="small" type="info" effect="plain" round>{{ providerLabel(item.provider) }}</el-tag>
            <span class="changes__name">{{ nameOf(item) }}</span>
          </span>
          <span class="changes__meta num">{{ metaOf(item) }}</span>
        </li>
      </ul>
      <p v-else-if="!neverTracked" class="changes__empty">{{ changesEmptyText(data.radius_km, data.window_months) }}</p>
      <p v-if="note" class="hint changes__note">{{ note }}</p>
    </template>
  </section>
</template>

<style scoped>
.changes {
  display: grid;
  align-content: start;
  gap: 10px;
  min-width: 0;
}

.changes__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 4px 8px;
}

.changes__title {
  margin: 0;
  font-size: var(--text-md);
}

.changes__list {
  display: grid;
  margin: 0;
  padding: 0;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
  list-style: none;
}

.changes__item {
  display: grid;
  gap: 4px;
  padding: 10px 12px;
}

.changes__item + .changes__item {
  border-top: 1px solid var(--line);
}

.changes__when,
.changes__meta {
  color: var(--ink-2);
  font-size: var(--text-sm);
}

.changes__line {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.changes__name {
  font-weight: 600;
  overflow-wrap: anywhere;
}

.changes__empty,
.changes__note {
  margin: 0;
}

.changes__empty {
  color: var(--ink-2);
}
</style>
