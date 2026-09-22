<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { api } from '../api/client'
import { useCampusScope } from '../composables/useCampusScope'
import { useRequestSequence } from '../composables/useRequestSequence'
import PageHeader from '../components/PageHeader.vue'
import CampusSelect from '../components/CampusSelect.vue'

const { visibleCampusKeys, selected: campusKey } = useCampusScope()
const funnel = ref<Record<string, number> | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)
const requests = useRequestSequence()

async function load() {
  const request = requests.begin()
  funnel.value = null
  if (!campusKey.value) { loading.value = false; return }
  loading.value = true
  error.value = null
  try {
    const result = await api.get<Record<string, number>>(`/admin/analytics/funnel?campus_key=${campusKey.value}`)
    if (requests.isCurrent(request)) funnel.value = result
  } catch {
    if (requests.isCurrent(request)) error.value = '無法讀取統計，請重新載入。'
  } finally {
    if (requests.isCurrent(request)) loading.value = false
  }
}

watch(campusKey, load, { immediate: true })

const clicks = computed(() => [
  { label: 'LINE', value: funnel.value?.cta_click_line ?? 0 },
  { label: '電話', value: funnel.value?.cta_click_phone ?? 0 },
  { label: '外部網站', value: funnel.value?.cta_click_external ?? 0 },
])

const stages = computed(() => {
  const created = funnel.value?.request_created ?? 0
  const confirmed = funnel.value?.visit_confirmed ?? 0
  const completed = funnel.value?.visit_completed ?? 0
  const max = Math.max(created, confirmed, completed, 1)
  return [
    { label: '已送出需求', value: created, ratio: created / max, note: '家長在官網填表' },
    { label: '已確認預約', value: confirmed, ratio: confirmed / max, note: created ? `${Math.round((confirmed / created) * 100)}% 的需求` : '' },
    { label: '已完成參觀', value: completed, ratio: completed / max, note: confirmed ? `${Math.round((completed / confirmed) * 100)}% 的確認` : '' },
  ]
})
</script>

<template>
  <div class="page page--narrow">
    <PageHeader lead="各校參觀需求、預約確認與完成參觀的累計紀錄，協助掌握家長從詢問到到訪的情況。" />

    <div class="filter-bar">
      <label class="filter-field"><span>查看校區</span><CampusSelect v-model="campusKey" :keys="visibleCampusKeys" /></label>
      <el-button :loading="loading" :disabled="!campusKey" @click="load">重新整理</el-button>
    </div>

    <el-empty v-if="!visibleCampusKeys.length" description="你的帳號沒有可查看的校區" />
    <el-alert v-else-if="error" type="error" :closable="false" show-icon :title="error"><el-button @click="load">重新載入</el-button></el-alert>
    <el-skeleton v-else-if="loading" animated :rows="5" aria-label="正在讀取統計" />

    <template v-else-if="funnel">
      <section class="panel">
        <div class="panel__head"><h2>預約流程</h2></div>
        <ol class="funnel">
          <li v-for="s in stages" :key="s.label" class="funnel__row">
            <span class="funnel__label">{{ s.label }}</span>
            <span class="funnel__track" aria-hidden="true"><span class="funnel__bar" :style="{ width: `${s.ratio * 100}%` }" /></span>
            <span class="funnel__value num">{{ s.value }}</span>
            <span class="funnel__note">{{ s.note }}</span>
          </li>
        </ol>
      </section>

      <section class="panel">
        <div class="panel__head"><h2>預約鈕點擊</h2></div>
        <div class="panel__body stat-list">
          <div v-for="c in clicks" :key="c.label" class="click">
            <span class="stat__label">{{ c.label }}</span>
            <span class="stat__value">{{ c.value }}</span>
          </div>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.funnel {
  list-style: none;
  margin: 0;
  padding: 8px 24px 16px;
}

.funnel__row {
  display: grid;
  grid-template-columns: 110px minmax(0, 1fr) 56px minmax(0, 1fr);
  align-items: center;
  gap: 12px;
  padding: 10px 0;
}

.funnel__row + .funnel__row {
  border-top: 1px solid var(--line);
}

.funnel__label {
  color: var(--ink-2);
}

.funnel__track {
  height: 10px;
  border-radius: 999px;
  background: var(--surface-3);
  overflow: hidden;
}

.funnel__bar {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: var(--el-color-primary);
  transition: width 300ms var(--ease-out);
}

.funnel__value {
  text-align: right;
  font-weight: 600;
  font-size: 16px;
}

.funnel__note {
  font-size: 12px;
  color: var(--ink-3);
}

.click {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

@media (max-width: 600px) {
  .funnel__row {
    grid-template-columns: 90px minmax(0, 1fr) 48px;
  }

  .funnel__note {
    grid-column: 2 / -1;
  }
}
</style>
