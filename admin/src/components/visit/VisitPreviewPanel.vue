<script setup lang="ts">
import { computed, ref, toRef, watch } from 'vue'
import { useRouter, type RouteLocationRaw } from 'vue-router'
import { ElMessage } from 'element-plus'
import { ArrowDown } from '@element-plus/icons-vue'
import { provideVisitCase, useVisitCase } from '../../composables/useVisitCase'
import { useUnsavedChanges } from '../../composables/useUnsavedChanges'
import FamilyActions from './FamilyActions.vue'
import VisitCaseDialogs from './VisitCaseDialogs.vue'
import VisitCaseFacts from './VisitCaseFacts.vue'
import VisitCaseHero from './VisitCaseHero.vue'
import VisitCaseSettings from './VisitCaseSettings.vue'
import VisitCaseTimeline from './VisitCaseTimeline.vue'

// 參觀案件列表右側的預覽（2026-10-06 方向 B，1280 以上）：和案件明細同一份資料層與同一組元件，
// 一頁處理完不必來回跳頁；完整案件頁仍在（深連結、看全部紀錄）。按鈕一律淺色：列表頁的實心主鈕是「補登案件」。
const props = defineProps<{ id: string; fullTo: RouteLocationRaw; hasNext: boolean }>()
const emit = defineEmits<{ next: []; changed: [] }>()
const router = useRouter()

const vc = useVisitCase(toRef(props, 'id'), {
  onChanged: () => emit('changed'),
  onRebooked: async (created) => {
    const failure = await router.push(`/visit-requests/${created.id}`)
    // 紀錄框還有沒新增的紀錄、使用者選擇留在這頁：新案件已經建好，列表要看得到，也告訴他之後去哪裡開。
    if (failure) {
      emit('changed')
      ElMessage.info('新案件已建立，記完這筆紀錄後可以到參觀案件列表開啟')
    }
  },
})
provideVisitCase(vc)
// 打了一半的聯絡紀錄：換一筆或離開列表前先問（同明細）；列表選下一列前呼叫 confirmLeave。
const { confirmLeave } = useUnsavedChanges(computed(() => vc.noteDirty), computed(() => vc.busy))
const fullPath = computed(() => router.resolve(props.fullTo).fullPath)

// 鍵盤：點列（或按 Enter）打開預覽後焦點移進面板，鍵盤與報讀軟體才知道內容出現在哪裡；
// 「下一筆」按到最後一筆會變成停用，焦點也回到面板，不留在失效的按鈕上。
const root = ref<HTMLElement | null>(null)
const nextButton = ref<{ ref?: HTMLElement | null } | null>(null)
function focus() {
  root.value?.focus()
}
watch(() => props.hasNext, (has) => {
  if (!has && nextButton.value?.ref && document.activeElement === nextButton.value.ref) focus()
})
defineExpose({ confirmLeave, focus })
</script>

<template>
  <aside ref="root" class="visit-preview panel" aria-label="案件預覽" tabindex="-1" :aria-busy="vc.loading">
    <!-- 按「下一筆」只換內容、焦點不動：用不顯示的狀態列讓報讀軟體唸出現在看的是誰。 -->
    <p class="visually-hidden" role="status">{{ vc.detail ? `正在看 ${vc.detail.parent_name}` : '' }}</p>
    <el-alert v-if="vc.error" type="error" :closable="false" show-icon :title="vc.error" />
    <el-skeleton v-else-if="vc.loading" animated :rows="6" class="visit-preview__skeleton" />
    <template v-else-if="vc.detail">
      <VisitCaseHero compact />
      <el-skeleton v-if="vc.familyPending" animated :rows="4" class="visit-preview__skeleton" />
      <template v-else>
        <div v-if="vc.familyVisit" class="visit-preview__section">
          <FamilyActions
            :visit="vc.familyVisit"
            :staff="vc.familyStaff"
            :latest="vc.latestFamilyContact"
            :rebookable="vc.canHandle"
            :primary="false"
            @changed="vc.onFamilyChanged"
            @stale="vc.family.reload()"
            @rebook="vc.rebookOpen = true"
          />
        </div>
        <VisitCaseFacts compact />
        <VisitCaseTimeline :limit="3" :full-path="fullPath" />
      </template>
      <VisitCaseSettings />
      <VisitCaseDialogs />
    </template>
    <footer class="visit-preview__foot">
      <router-link :to="fullTo" class="visit-preview__open">打開完整案件頁 →</router-link>
      <el-button ref="nextButton" text :disabled="!hasNext" @click="emit('next')">下一筆<el-icon class="el-icon--right"><ArrowDown /></el-icon></el-button>
    </footer>
  </aside>
</template>

<style scoped>
/* 黏在視窗右側、內容自己捲；裡面的資料表、時間線、設定列不再各自一張卡，改成分隔線。 */
.visit-preview {
  position: sticky;
  top: calc(var(--top-h) + 16px);
  display: flex;
  flex-direction: column;
  max-height: calc(100vh - var(--top-h) - 32px);
  padding: 0;
  overflow: auto;
}

/* 焦點是程式移進來的：用鍵盤時畫出框，滑鼠點列時不畫。 */
.visit-preview:focus {
  outline: none;
}

.visit-preview:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: -2px;
}

.visit-preview :deep(.case-facts),
.visit-preview :deep(.case-timeline),
.visit-preview :deep(.case-settings) {
  margin-top: 0;
  border: 0;
  border-top: 1px solid var(--line);
  border-radius: 0;
  box-shadow: none;
}

.visit-preview__section {
  padding: 14px 20px;
  border-top: 1px solid var(--line);
}

.visit-preview__skeleton {
  padding: 20px;
}

.visit-preview__foot {
  position: sticky;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: auto;
  padding: 8px 20px;
  border-top: 1px solid var(--line);
  background: var(--surface);
  font-size: var(--text-sm);
}
</style>
