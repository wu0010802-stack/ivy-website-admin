<script setup lang="ts">
import { formatDateTime } from '../../api/labels'
import type { FamilyNote } from '../../admissions/family'

// 家庭版面的聯絡紀錄（2026-10-05 家庭頁規格 5.4）：參觀前（預約）與參觀後（招生）合在一起，
// 順序由父層 familyNotes() 決定。新增一律用處理區的「記錄聯絡」，這裡沒有輸入框。
defineProps<{ notes: readonly FamilyNote[]; logsFailed: boolean }>()
const emit = defineEmits<{ reload: [] }>()
</script>

<template>
  <section class="family-notes">
    <div class="section__title">
      <h2>聯絡紀錄</h2>
      <span class="hint">參觀前記在預約、參觀後記在招生，這裡一起列</span>
    </div>
    <p v-if="logsFailed" class="hint family-notes__error">
      參觀後的聯絡紀錄讀不到。
      <el-button link type="primary" @click="emit('reload')">重新載入</el-button>
    </p>
    <ol v-if="notes.length" class="family-notes__list">
      <li v-for="item in notes" :key="item.key" class="family-notes__item" :data-phase="item.phase">
        <span class="family-notes__meta">
          <el-tag size="small" :type="item.phase === 'after' ? 'primary' : 'info'" effect="plain" round>
            {{ item.phase === 'after' ? '參觀後' : '參觀前' }}
          </el-tag>
          <strong v-if="item.headline" class="family-notes__headline">{{ item.headline }}</strong>
          <time class="family-notes__time num">{{ formatDateTime(item.at) }}</time>
          <span v-if="item.author" class="family-notes__author">{{ item.author }}</span>
        </span>
        <p v-if="item.note" class="family-notes__text">{{ item.note }}</p>
        <p v-if="item.nextFollowUpAt" class="family-notes__next num">排下次聯絡 {{ formatDateTime(item.nextFollowUpAt) }}</p>
      </li>
    </ol>
    <p v-else class="hint">還沒有聯絡紀錄。每次致電或傳訊後用「記錄聯絡」記一筆，同事接手時才知道談到哪裡。</p>
  </section>
</template>

<style scoped>
/* 同預約明細原本聯絡紀錄的排法（VisitDetailView 的 .notes），子元件拿不到父層 scoped 樣式，這裡另寫一份。 */
.family-notes__error {
  margin: 0 0 8px;
}

.family-notes__list {
  list-style: none;
  margin: 0 0 16px;
  padding: 0;
}

.family-notes__item {
  padding: 10px 0;
  border-top: 1px solid var(--line);
}

.family-notes__item:first-child {
  border-top: 0;
  padding-top: 0;
}

.family-notes__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 10px;
  margin-bottom: 2px;
  font-size: var(--text-xs);
}

.family-notes__headline {
  color: var(--ink);
  font-size: var(--text-sm);
}

.family-notes__time {
  color: var(--ink-3);
}

.family-notes__author {
  color: var(--ink-2);
}

.family-notes__text {
  margin: 4px 0 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.family-notes__next {
  margin: 2px 0 0;
  color: var(--ink-3);
  font-size: var(--text-xs);
}
</style>
