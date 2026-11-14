<script setup lang="ts">
import type { RosterSnapshot } from '../../../api/roster'
import { GRADE_ORDER, rocDate, taipeiStamp } from '../../../admissions/roster'

// 結算紀錄（2026-11-15，規格 §6.6）：存下來的是當時的數字，之後改名單不會改到它。
// 在籍人數只是各校獎金用的「完成註冊並繳月費」人數的近似值，所以畫面不寫「註冊人數」。
defineProps<{ snapshots: RosterSnapshot[] }>()
</script>

<template>
  <div class="roster-snaps">
    <h3>結算紀錄</h3>
    <table v-if="snapshots.length">
      <thead>
        <tr>
          <th>結算日</th>
          <th v-for="grade in GRADE_ORDER" :key="grade">{{ grade }}</th>
          <th>在籍合計</th>
          <th>這學期預估</th>
          <th>存檔時間</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="snapshot in snapshots" :key="snapshot.id">
          <td>{{ rocDate(snapshot.as_of) }}</td>
          <td v-for="grade in GRADE_ORDER" :key="grade">{{ snapshot.enrolled[grade] ?? 0 }}</td>
          <td><b>{{ snapshot.total_enrolled }}</b></td>
          <td>{{ snapshot.estimate_total }}</td>
          <td class="roster-snaps__at">{{ taipeiStamp(snapshot.created_at) }}</td>
        </tr>
      </tbody>
    </table>
    <p v-else class="roster-snaps__empty">還沒有結算紀錄。</p>
  </div>
</template>

<style scoped>
.roster-snaps {
  padding: 0 16px 16px;
}

.roster-snaps h3 {
  margin: 14px 0 6px;
  font-size: var(--text-base);
}

.roster-snaps table {
  border-collapse: collapse;
  font-size: var(--text-sm);
}

.roster-snaps th,
.roster-snaps td {
  padding: 5px 14px 5px 0;
  border-bottom: 1px solid var(--line);
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.roster-snaps th:first-child,
.roster-snaps td:first-child {
  text-align: left;
}

.roster-snaps__at,
.roster-snaps__empty {
  color: var(--ink-3);
}

.roster-snaps__empty {
  margin: 0;
  font-size: var(--text-sm);
}
</style>
