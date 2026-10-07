<script setup lang="ts">
import { computed } from 'vue'
import { ARRIVAL_FORM_CANCEL_TEXT } from '../../composables/useArrivalAdmissionsForm'
import { useCampusScope } from '../../composables/useCampusScope'
import { injectVisitCase } from '../../composables/useVisitCase'
import ManualVisitDialog from '../ManualVisitDialog.vue'
import RecordDialog from '../admissions/RecordDialog.vue'

// 案件的兩個對話框：重新預約（另建新案）與招生資料表單（標記到場後自動打開、或頁首「填招生資料」）。
// RecordDialog 一直掛著：它在打開的那一刻（open 變 true）才把 record 帶進表單。
const vc = injectVisitCase()
const { visibleCampusKeys } = useCampusScope({ autoSelect: false })
// 剛標記到場才有說明，取消鈕寫「之後再填」；從「填招生資料」打開的維持「取消」。
const cancelText = computed(() => (vc.arrivalLead ? ARRIVAL_FORM_CANCEL_TEXT : undefined))
</script>

<template>
  <template v-if="vc.detail">
    <ManualVisitDialog v-model="vc.rebookOpen" :campus-keys="visibleCampusKeys" :related-from="vc.detail" @created="vc.onRebooked" />
    <RecordDialog
      v-if="vc.canCreateAdmissions"
      v-model="vc.arrivalOpen"
      mode="edit"
      :campus-key="vc.detail.campus_key"
      :record="vc.admissionsVisit"
      :options="vc.familyOptions"
      :lead="vc.arrivalLead"
      :cancel-text="cancelText"
      @saved="vc.family.replaceVisit"
      @stale="vc.family.reload()"
    />
  </template>
</template>
