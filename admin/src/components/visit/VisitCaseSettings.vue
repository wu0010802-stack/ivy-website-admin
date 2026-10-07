<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { groupSlotsByDay, slotChoiceTime } from '../../utils/sessions'
import { injectVisitCase } from '../../composables/useVisitCase'
import ParentAccessLinkPanel from '../ParentAccessLinkPanel.vue'

// 設定列（2026-10-06 方向 C）：改場次、家長管理連結收成一列一列，取消預約在最底、分隔線之後（第四輪）。
// 只有預約正常的案件有這些事可做；已到場、未到場、已取消整塊不出現（重新預約在頁首）。
const vc = injectVisitCase()
const confirmed = computed(() => vc.detail?.status === 'confirmed')

const rescheduleSelect = ref<{ focus: () => void } | null>(null)
const rescheduleTitle = ref<HTMLElement | null>(null)

// 手動改期表單一律先收成一個連結，要用再展開（2026-10-05 第九輪）：改期不是每筆都要做的事。
// 展開時，按下的連結會被表單換掉；把焦點移進表單（能選時段就放在時段選單，沒有時段可選就放在標題），
// 鍵盤與報讀軟體才知道表單出現在哪裡。
async function openManualReschedule() {
  vc.manualRescheduleOpen = true
  await nextTick()
  if (vc.rescheduleSlots.length > 0 && rescheduleSelect.value) rescheduleSelect.value.focus()
  else rescheduleTitle.value?.focus()
}
</script>

<template>
  <section v-if="vc.detail && confirmed" class="panel case-settings">
    <h2 class="visually-hidden">場次、家長管理連結與取消</h2>
    <div v-if="vc.canHandle" class="settings-row detail__actions">
      <p class="settings-row__label">場次</p>
      <div v-if="vc.manualRescheduleOpen" class="reschedule" role="group" aria-labelledby="visit-reschedule-title">
        <p id="visit-reschedule-title" ref="rescheduleTitle" class="reschedule__title" tabindex="-1">改期（換場次）</p>
        <el-select ref="rescheduleSelect" v-model="vc.rescheduleSlotId" placeholder="選擇新的參觀場次" filterable :disabled="vc.rescheduleSlots.length === 0" aria-label="改期的新場次" style="width: 100%">
          <el-option-group v-for="group in groupSlotsByDay(vc.rescheduleSlots)" :key="group.day" :label="group.label">
            <el-option v-for="slot in group.slots" :key="slot.id" :label="vc.slotLabel(slot)" :value="slot.id">{{ slotChoiceTime(slot) }}</el-option>
          </el-option-group>
        </el-select>
        <p v-if="vc.chosenSlotText(vc.rescheduleSlots, vc.rescheduleSlotId)" class="hint slot-chosen">已選：{{ vc.chosenSlotText(vc.rescheduleSlots, vc.rescheduleSlotId) }}</p>
        <p v-if="vc.rescheduleSlots.length === 0" class="hint">
          <template v-if="vc.canManage">未來 60 天沒有其他可用場次。先到 <router-link to="/visit-calendar">參觀場次</router-link> 新增。</template>
          <template v-else>未來 60 天沒有其他可用場次，請校區管理者到「參觀場次」新增。</template>
        </p>
        <el-input v-model="vc.rescheduleReason" maxlength="500" placeholder="改期原因（選填）" aria-label="改期原因" />
        <el-button :loading="vc.pendingAction === 'reschedule'" :disabled="!vc.rescheduleSlotId || vc.busy" style="width: 100%; margin-left: 0" @click="vc.reschedule()">改到這一場</el-button>
        <p class="hint">改好後原場次的名額會空出來；新場次剛好額滿的話不會改。</p>
      </div>
      <template v-else>
        <div class="reschedule reschedule--collapsed">
          <el-button link type="primary" class="reschedule__toggle" aria-expanded="false" @click="openManualReschedule">{{ vc.detail.pending_reschedule ? '不照申請，改到其他場次…' : '改到其他場次…' }}</el-button>
        </div>
        <!-- 說明接在收合的連結後面，不放進連結那一格，那一格只有連結。 -->
        <p class="hint">改好後原場次的名額會空出來。</p>
      </template>
    </div>
    <ParentAccessLinkPanel
      v-if="vc.linkApplicable"
      class="settings-row"
      :visit-id="vc.detail.id"
      :access-link="vc.detail.access_link"
      :can-handle="vc.canHandle"
      :status="vc.detail.status"
      :email="vc.detail.email ?? null"
      :email-enabled="vc.emailEnabled"
      :deadline-hours="vc.detail.parent_change_deadline_hours"
      @changed="vc.refreshDetail()"
    />
    <div v-if="vc.canHandle" class="detail__danger">
      <span class="hint">{{ vc.attendanceDue ? '家長沒來請用上方的「沒來」' : '家長不來了？' }}</span>
      <el-button text type="danger" :loading="vc.pendingAction === 'cancel'" :disabled="vc.busy" class="detail__cancel" @click="vc.cancel()">取消預約</el-button>
    </div>
  </section>
</template>

<style scoped>
.case-settings {
  padding: 0;
}

.settings-row {
  display: grid;
  gap: 6px;
  padding: 14px 20px;
  border-top: 1px solid var(--line);
}

.settings-row:first-of-type {
  border-top: 0;
}

/* 家長管理連結的列標籤在 ParentAccessLinkPanel 裡，用 :deep 套同一個樣式。 */
:deep(.settings-row__label) {
  margin: 0;
  color: var(--ink-3);
  font-size: var(--text-sm);
}

.settings-row > .hint {
  margin: 0;
}

.reschedule {
  display: grid;
  gap: 8px;
}

.reschedule--collapsed {
  justify-items: start;
}

.slot-chosen {
  margin: -4px 0 0;
}

.reschedule__title {
  margin: 0;
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--ink);
}

/* 取消預約與上面的設定隔開，並用分隔線宣告它是另一類動作，減少誤觸。 */
.detail__danger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 12px 20px;
  border-top: 1px solid var(--line);
}

.detail__cancel {
  margin-right: -8px;
}

@media (max-width: 720px) {
  .settings-row,
  .detail__danger {
    padding-left: 16px;
    padding-right: 16px;
  }
}
</style>
