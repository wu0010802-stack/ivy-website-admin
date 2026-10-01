<script setup lang="ts">
import type { AdmissionsTab, Semester } from '../../admissions/useAdmissionsFilters'

// 統計分頁在階段 C（C3）完成；在那之前給一個可用的空狀態，不顯示假的 0。
defineProps<{ campusKey: string; schoolYear: number | null; semester: Semester | null }>()
const emit = defineEmits<{ go: [tab: AdmissionsTab] }>()
</script>

<template>
  <section class="panel stats-pending">
    <div class="panel__head"><h2>統計分析</h2></div>
    <div class="panel__body">
      <el-empty description="統計分析還在準備中。各階段數量先看「漏斗看板」，各年級名額看「名額規劃」。">
        <el-button type="primary" @click="emit('go', 'funnel')">看漏斗看板</el-button>
        <el-button @click="emit('go', 'intake')">看名額規劃</el-button>
      </el-empty>
    </div>
  </section>
</template>
