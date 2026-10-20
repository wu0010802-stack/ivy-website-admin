<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { getAreaKindergartenRecords } from '../../../api/admissions'
import type { AreaKindergarten, AreaKindergartenRecords } from '../../../api/types'
import { NO_VALUE } from '../../../admissions/statsFormat'
import { useRequestSequence } from '../../../composables/useRequestSequence'
import { NO_RECORDS, punishmentText, slashDate, subjectText } from './kindergartenRecordsFormat'

// 展開一所附近幼兒園時的裁罰與評鑑明細（2026-10-20 規格 C11）：展開才讀 /area/kindergartens/{id}/records。
// 清單的摘要已經說了有沒有紀錄：沒有裁罰也沒有評鑑就不打 API，直接寫「無公開紀錄」。
// 裁罰對象只有類別（園方／教保人員個人），沒有姓名；3 年前的列用淡色。
// 放在展開詳情（dl）的下面，裁罰、評鑑各一個區塊，標題在上、內容在下，窄螢幕不橫向溢出。
const props = defineProps<{ campusKey: string; item: AreaKindergarten; penaltiesImported: boolean; evaluationsImported: boolean }>()

const requests = useRequestSequence()
const records = ref<AreaKindergartenRecords | null>(null)
const failed = ref(false)

const hasPenalties = computed(() => props.penaltiesImported && props.item.penalty_latest_on !== null && props.item.penalty_latest_on !== undefined)
const hasEvaluations = computed(() => props.evaluationsImported && (props.item.evaluation_latest ?? null) !== null)
const needsRecords = computed(() => hasPenalties.value || hasEvaluations.value)
// 讀取失敗的提示放在第一個需要明細的區塊，只出現一次。
const alertIn = computed<'penalties' | 'evaluations' | null>(() => {
  if (!failed.value) return null
  return hasPenalties.value ? 'penalties' : 'evaluations'
})

async function load() {
  const request = requests.begin()
  records.value = null
  failed.value = false
  try {
    const result = await getAreaKindergartenRecords(props.campusKey, props.item.source_id)
    if (requests.isCurrent(request)) records.value = result
  } catch {
    if (requests.isCurrent(request)) failed.value = true
  }
}
onMounted(() => {
  if (needsRecords.value) void load()
})
</script>

<template>
  <div class="records">
    <section class="records__section">
      <h4 class="records__title">裁罰</h4>
      <p v-if="!penaltiesImported" class="records__text">裁罰資料尚未匯入。</p>
      <p v-else-if="!hasPenalties" class="records__text">{{ NO_RECORDS }}</p>
      <el-alert v-else-if="alertIn === 'penalties'" type="error" :closable="false" show-icon title="無法讀取裁罰與評鑑。">
        <el-button size="small" @click="load">重新載入</el-button>
      </el-alert>
      <el-skeleton v-else-if="!records" :rows="2" animated />
      <ul v-else-if="records.penalties.length" class="records__list" aria-label="裁罰明細">
        <li v-for="(row, index) in records.penalties" :key="index" class="records__item" :class="{ 'is-old': !row.recent }">
          <span class="records__head num">
            <span class="records__date">{{ slashDate(row.occurred_on) }}</span>
            <span>{{ punishmentText(row) }}</span>
            <span class="records__subject">{{ subjectText(row.subject) }}</span>
          </span>
          <span class="records__content">{{ row.content || row.law || NO_VALUE }}</span>
        </li>
      </ul>
      <p v-else class="records__text">{{ NO_RECORDS }}</p>
    </section>
    <section class="records__section">
      <h4 class="records__title">評鑑</h4>
      <p v-if="!evaluationsImported" class="records__text">評鑑資料尚未匯入。</p>
      <p v-else-if="!hasEvaluations" class="records__text">{{ NO_RECORDS }}</p>
      <el-alert v-else-if="alertIn === 'evaluations'" type="error" :closable="false" show-icon title="無法讀取裁罰與評鑑。">
        <el-button size="small" @click="load">重新載入</el-button>
      </el-alert>
      <el-skeleton v-else-if="!records" :rows="2" animated />
      <ul v-else-if="records.evaluations.length" class="records__list" aria-label="評鑑結果">
        <li v-for="(row, index) in records.evaluations" :key="index" class="records__item">
          <span class="records__head num">
            <span class="records__date">{{ row.school_year }} 學年</span>
            <span>{{ slashDate(row.completed_on) }}</span>
          </span>
          <span class="records__content">{{ row.result }}</span>
        </li>
      </ul>
      <p v-else class="records__text">{{ NO_RECORDS }}</p>
    </section>
  </div>
</template>

<style scoped>
.records {
  display: grid;
  gap: 10px;
  padding: 0 12px 10px;
  font-size: var(--text-sm);
}

.records__section {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.records__title {
  margin: 0;
  color: var(--ink-3);
  font-size: var(--text-sm);
  font-weight: 400;
}

.records__text {
  margin: 0;
}

.records__list {
  display: grid;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.records__item {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.records__head {
  display: flex;
  flex-wrap: wrap;
  gap: 2px 10px;
}

.records__date {
  font-weight: 600;
}

.records__subject,
.records__content {
  color: var(--ink-2);
}

.records__content {
  overflow-wrap: anywhere;
}

/* 3 年前的裁罰用淡色，和清單上的「3 年前有裁罰」標籤同一個意思。 */
.records__item.is-old,
.records__item.is-old .records__subject,
.records__item.is-old .records__content {
  color: var(--ink-3);
}
</style>
