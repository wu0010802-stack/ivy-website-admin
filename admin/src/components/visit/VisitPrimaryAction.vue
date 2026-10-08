<script setup lang="ts">
import { computed } from 'vue'
import { injectVisitCase } from '../../composables/useVisitCase'
import { useNarrowScreen } from '../../composables/useNarrowScreen'
import { caseStage } from '../../composables/visitCaseStage'

// 頁首的主動作（2026-10-06 方向 C）：依階段只給一顆實心主鈕；改場次、家長連結、取消在設定列。
// plain：預覽面板裡（列表頁的實心主鈕是「補登案件」），所有按鈕改淺色。
const props = withDefaults(defineProps<{ plain?: boolean }>(), { plain: false })
const vc = injectVisitCase()

// 窄螢幕與預覽面板排法相同（按鈕整排撐滿），都由 stacked 這個 class 決定，樣式只寫一份。
const narrow = useNarrowScreen('(max-width: 900px)')
const stacked = computed(() => props.plain || narrow.value)

const stage = computed(() => {
  const d = vc.detail
  return caseStage({
    status: d?.status ?? '',
    canHandle: vc.canHandle,
    visitStarted: vc.visitStarted,
    familyPending: vc.familyPending,
    isFamily: Boolean(vc.familyVisit),
    canReadAdmissions: vc.canReadAdmissions,
    canCreateAdmissions: vc.canCreateAdmissions,
    admissionsAvailable: vc.admissionsAvailable,
    lookupFailed: vc.lookupFailed,
  })
})
const solid = (primaryHere: boolean) => primaryHere && !props.plain
const familyEditable = computed(() => vc.canCreateAdmissions && !vc.familyVisit?.anonymized_at)
// 家庭版面但不能改招生資料（只有 admissions.read、或招生訪視已匿名化）時沒有任何按鈕也沒有提示：
// 整個容器不渲染，免得頁首（案件頁與預覽面板）在狀態與撥號之間留一塊空白與一段 gap。
const hasContent = computed(() => !(stage.value === 'family' && !familyEditable.value))
const rebookSecondary = computed(() => vc.canHandle && ['admissions-retry', 'admissions-create', 'admissions-ask'].includes(stage.value))
</script>

<template>
  <div v-if="hasContent" class="case-hero__actions" :class="{ 'case-hero__actions--stacked': stacked }" :data-stage="stage">
    <el-skeleton v-if="stage === 'loading'" animated :rows="1" />
    <div v-else-if="stage === 'attendance'" class="detail__attendance" role="group" aria-labelledby="visit-attendance-title">
      <p id="visit-attendance-title" class="visually-hidden">家長到了嗎？</p>
      <div class="case-hero__buttons">
        <el-button type="primary" :plain="!solid(true)" :loading="vc.pendingAction === 'complete'" :disabled="vc.busy" @click="vc.markCompleted()">家長到了</el-button>
        <el-button :loading="vc.pendingAction === 'no_show'" :disabled="vc.busy" @click="vc.markNoShow()">沒來</el-button>
      </div>
      <p v-if="vc.opensForm" class="hint case-hero__note">標記到場會接著開招生資料表單</p>
    </div>

    <p v-if="stage === 'upcoming'" class="hint case-hero__note">參觀場次開始後可以標記已到場或未到場；家長事先說不來，請用下方的「取消預約」。</p>
    <p v-else-if="stage === 'readonly'" class="hint case-hero__note">你的帳號只能查看案件，狀態由負責處理案件的同事更新。</p>
    <el-button v-else-if="stage === 'family' && familyEditable" type="primary" :plain="!solid(true)" @click="vc.openAdmissionsForm()">填招生資料</el-button>
    <div v-else-if="stage === 'admissions-retry' || stage === 'admissions-create' || stage === 'admissions-ask'" class="detail__admissions">
      <template v-if="stage === 'admissions-retry'">
        <span class="hint">招生資料讀不到。</span>
        <el-button type="primary" :plain="!solid(true)" :disabled="vc.busy" @click="vc.family.lookup()">重新載入</el-button>
      </template>
      <template v-else-if="stage === 'admissions-create'">
        <span class="hint">已到場，但還沒有招生訪視。</span>
        <el-button type="primary" :plain="!solid(true)" :loading="vc.creatingAdmissions" :disabled="vc.busy" @click="vc.family.create()">建立招生訪視</el-button>
      </template>
      <span v-else class="hint">已到場，但還沒有招生訪視；請有招生權限的同事建立。</span>
    </div>
    <template v-else-if="stage === 'closed'">
      <el-button type="primary" :plain="!solid(true)" :disabled="vc.busy" @click="vc.rebookOpen = true">重新預約（另建新案）</el-button>
      <p class="hint case-hero__note">這筆案件已結案。家長想再約，請另建新案，舊案會保留原紀錄。</p>
    </template>
    <el-button v-if="rebookSecondary" :disabled="vc.busy" @click="vc.rebookOpen = true">重新預約（另建新案）</el-button>
  </div>
</template>

<style scoped>
.case-hero__actions {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 10px;
  max-width: 420px;
}

.case-hero__buttons {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}

.case-hero__buttons .el-button + .el-button,
.case-hero__actions > .el-button + .el-button {
  margin-left: 0;
}

.case-hero__note {
  margin: 0;
  font-size: var(--text-xs);
  text-align: right;
}

.detail__attendance {
  display: grid;
  justify-items: end;
  gap: 6px;
}

.detail__admissions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 6px 12px;
  font-size: var(--text-sm);
  color: var(--ink-2);
}

/* 窄螢幕與預覽面板（stacked）：按鈕整排撐滿，到了／沒來各占一半。 */
.case-hero__actions--stacked,
.case-hero__actions--stacked .detail__attendance {
  align-items: stretch;
  justify-items: stretch;
  max-width: none;
}

.case-hero__actions--stacked .case-hero__buttons {
  display: grid;
  grid-template-columns: 1fr 1fr;
}

.case-hero__actions--stacked .case-hero__note,
.case-hero__actions--stacked .detail__admissions {
  justify-content: flex-start;
  text-align: left;
}

/* 觸控的 44px 只給窄螢幕（預覽面板在桌機，維持一般高度）。 */
@media (max-width: 900px) {
  .case-hero__buttons .el-button,
  .case-hero__actions > .el-button {
    min-height: 44px;
  }
}
</style>
