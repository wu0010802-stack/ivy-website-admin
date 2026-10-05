<script setup lang="ts">
import { computed, ref } from 'vue'
import type { AdmissionsOptions, RecruitmentVisit } from '../../api/types'
import { termLabel } from '../../admissions/academic'
import { ANONYMIZED_CONFLICT_TEXT, MISSING_CHILD_NAME } from '../../admissions/constants'
import { useNarrowScreen } from '../../composables/useNarrowScreen'
import RecordDialog from '../admissions/RecordDialog.vue'

// 家庭版面的招生資料（2026-10-05 家庭頁規格 5.3）：園方維護的那份。固定列一律列（沒填寫「—」），
// 依階段或有值才列的放後面；欄位與文字同「招生訪視照紙本補欄位」之後的 RecordDialog。
const props = defineProps<{ visit: RecruitmentVisit; options: AdmissionsOptions | null; editable: boolean }>()
const emit = defineEmits<{ saved: [visit: RecruitmentVisit]; stale: [] }>()

const narrow = useNarrowScreen()
const editOpen = ref(false)
const canEdit = computed(() => props.editable && !props.visit.anonymized_at)
const missingName = computed(() => props.visit.child_name === MISSING_CHILD_NAME)

interface Row { label: string; value: string; href?: string }

const rows = computed<Row[]>(() => {
  const v = props.visit
  const dash = (value: string | null | undefined) => value || '—'
  const category = v.source_category ? (props.options?.source_categories?.[v.source_category] ?? v.source_category) : '未選'
  const fixed: Row[] = [
    { label: '幼生姓名', value: missingName.value ? '' : v.child_name },
    { label: '英文名字', value: dash(v.english_name) },
    { label: '生日', value: dash(v.birthday) },
    { label: '適讀班級', value: dash(v.grade) },
    { label: '聯絡人', value: dash(v.contact_name) },
    { label: '電話', value: dash(v.phone), href: v.phone && !v.anonymized_at ? `tel:${v.phone}` : undefined },
    { label: '入學學期', value: termLabel(v.target_school_year, v.target_semester) },
    { label: '搭娃娃車', value: v.rides_bus ? '要搭' : '不搭' },
    { label: '帶參觀老師', value: dash(v.tour_guide_name) },
    { label: '來源分類', value: category },
    { label: '來源備註', value: dash(v.source) },
    { label: '介紹者', value: dash(v.referrer) },
  ]
  const optional: [string, string | null | undefined][] = [
    ['收預繳人員', v.has_deposit ? v.deposit_collector : null],
    ['未預繳原因', v.stage === 'visited' ? [v.no_deposit_reason, v.no_deposit_reason_detail].filter(Boolean).join('：') : null],
    ['退出原因', v.stage === 'withdrawn' ? v.withdraw_reason : null],
    ['地址', v.address || v.district],
    ['父親職業', v.father_occupation],
    ['母親職業', v.mother_occupation],
    ['備註', v.notes],
    ['電訪回應', v.parent_response],
  ]
  return [...fixed, ...optional.filter(([, value]) => Boolean(value)).map(([label, value]) => ({ label, value: value as string }))]
})
</script>

<template>
  <section class="panel family-data">
    <div class="panel__head">
      <h2>招生資料</h2>
      <el-button v-if="canEdit" size="small" @click="editOpen = true">編輯</el-button>
    </div>
    <p v-if="visit.anonymized_at" class="hint family-data__anonymized">{{ ANONYMIZED_CONFLICT_TEXT }}。</p>
    <el-descriptions :column="narrow ? 1 : 2" border label-width="104" class="family-data__desc">
      <el-descriptions-item v-for="row in rows" :key="row.label" :label="row.label">
        <el-tag v-if="row.label === '幼生姓名' && missingName" size="small" type="warning" effect="plain" round>待補</el-tag>
        <a v-else-if="row.href" :href="row.href" class="num family-data__link">{{ row.value }}</a>
        <template v-else>{{ row.value }}</template>
      </el-descriptions-item>
    </el-descriptions>
    <RecordDialog
      v-if="canEdit"
      v-model="editOpen"
      mode="edit"
      :campus-key="visit.campus_key"
      :record="visit"
      :options="options"
      @saved="(saved: RecruitmentVisit) => emit('saved', saved)"
      @stale="emit('stale')"
    />
  </section>
</template>

<style scoped>
.family-data__anonymized {
  margin: 0;
  padding: 10px 18px 0;
}

.family-data__desc {
  padding: 12px 18px 16px;
}

.family-data__link {
  color: var(--el-color-primary);
  text-decoration: none;
}
</style>
