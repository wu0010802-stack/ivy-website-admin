<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { ApiError } from '../../api/client'
import { apiErrorMessage } from '../../api/errors'
import { VISIT_EXCLUDE_REASON_LABELS } from '../../api/labels'
import { EXCLUDE_REASONS, excludeVisit, type ExcludeReason } from '../../api/visitExclusion'
import { injectVisitCase } from '../../composables/useVisitCase'
import { isAnonymizedCase } from '../../api/visitDetails'

// 排除入口（2026-10-15 規格 §3.4；計畫裁定 P7）：右欄最下方一列，所有狀態都有，只給 booking.manage。
const vc = injectVisitCase()
const open = ref(false)
const reason = ref<ExcludeReason>('test')
const note = ref('')
const submitting = ref(false)
const error = ref<string | null>(null)
const show = computed(() => Boolean(vc.detail) && vc.canManage && !vc.detail?.excluded_at)
// 另一個人先排除時（409）頁面重讀後 show 變 false；對話框還開著就先留著，讓錯誤訊息讀得到，關掉才收起。
const visible = computed(() => show.value || open.value)
// 預約正常、還沒到參觀時間：排除不釋出名額，提醒一併取消（E6）。
const holdsSeat = computed(() => vc.detail?.status === 'confirmed' && !vc.visitStarted)
// 已匿名化的案件後端一律不存說明（計畫裁定 P15）：不給「其他」與說明欄，免得寫了說明、看到成功、橫幅卻沒有。
const anonymized = computed(() => isAnonymizedCase(vc.detail))
const reasons = computed(() => (anonymized.value ? EXCLUDE_REASONS.filter((key) => key !== 'other') : EXCLUDE_REASONS))
// 選「其他」要寫說明（E3）；前兩者說明選填。
const canSubmit = computed(() => reason.value !== 'other' || note.value.trim() !== '')

function start() {
  reason.value = 'test'
  note.value = ''
  error.value = null
  open.value = true
}

async function submit() {
  if (!vc.detail || !canSubmit.value || submitting.value) return
  submitting.value = true
  error.value = null
  try {
    await excludeVisit(vc.detail.id, anonymized.value ? { reason: reason.value } : { reason: reason.value, note: note.value.trim() || null })
    open.value = false
    ElMessage.success('已排除，這筆不再算進待辦與預約結果')
    await vc.refreshDetail()
    // 入口這一列重讀後收起，被按的鈕消失、焦點會掉到頁面最上面（跳到主要內容）：移到剛出現的橫幅，橫幅有 role="status"。
    await nextTick()
    document.querySelector<HTMLElement>('.exclusion-banner')?.focus()
  } catch (err) {
    error.value = apiErrorMessage(err, '排除失敗，請稍後再試')
    // 409：另一個人已經先排除，重讀讓橫幅出現、入口收起。
    if (err instanceof ApiError && err.status === 409) await vc.refreshDetail()
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <section v-if="visible" v-show="show" class="panel exclusion-action">
    <el-button class="exclusion-action__start" link type="primary" @click="start">標記為排除（測試或重複）…</el-button>
    <el-dialog
      v-model="open"
      class="exclusion-dialog"
      title="標記為排除"
      width="min(480px, calc(100vw - 32px))"
      append-to-body
      :close-on-click-modal="false"
      :close-on-press-escape="!submitting"
      :show-close="!submitting"
    >
      <div class="exclusion-dialog__body">
        <el-alert v-if="error" type="error" :closable="false" show-icon :title="error" />
        <p class="hint">排除之後，這筆不算進總覽、參觀預約的結果與班別、預約全程與場次使用情況，也不寄參觀提醒；可以隨時取消排除。</p>
        <p v-if="holdsSeat" class="hint exclusion-dialog__seat">排除不會釋出名額；如果是測試預約，請一併取消。</p>
        <el-radio-group v-model="reason" aria-label="排除原因" :disabled="submitting">
          <el-radio v-for="key in reasons" :key="key" :value="key">{{ VISIT_EXCLUDE_REASON_LABELS[key] }}</el-radio>
        </el-radio-group>
        <p v-if="anonymized" class="hint exclusion-dialog__anonymized">這筆已匿名化：原因可選測試或重複，不保存說明。</p>
        <el-input
          v-else
          v-model="note"
          type="textarea"
          maxlength="200"
          show-word-limit
          :disabled="submitting"
          :autosize="{ minRows: 2, maxRows: 4 }"
          :placeholder="reason === 'other' ? '請寫說明（必填）' : '說明（選填）'"
          aria-label="排除說明"
        />
      </div>
      <template #footer>
        <div class="exclusion-dialog__buttons">
          <el-button :disabled="submitting" @click="open = false">取消</el-button>
          <el-button type="primary" :loading="submitting" :disabled="!canSubmit || !show" @click="submit">標記為排除</el-button>
        </div>
      </template>
    </el-dialog>
  </section>
</template>

<style scoped>
.exclusion-action {
  padding: 12px 20px;
}

.exclusion-dialog__body {
  display: grid;
  gap: 12px;
}

.exclusion-dialog__body .hint {
  margin: 0;
}

.exclusion-dialog__seat {
  color: var(--el-color-warning-dark-2);
}

.exclusion-dialog__buttons {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.exclusion-dialog__buttons .el-button + .el-button {
  margin-left: 0;
}
</style>
