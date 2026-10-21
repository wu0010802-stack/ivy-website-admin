<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  HISTORY_SENDS_TEXT, NOT_IMPORTED_TEXT, NO_CHANGE_TEXT, REMOVED_ACK_TEXT, changeText, historyCompareText, historyStatusRange, historyTable,
  importConfirmMessage, isStalePreview, termText, workbookHeaders, workbookHeadersText, type WorkbookHeader,
} from './importFormat'
import { applyHistoryImport, previewHistoryImport } from '../../../api/admissions'
import { apiErrorMessage } from '../../../api/errors'
import { campusLabel, formatDateTime } from '../../../api/labels'
import type { HistoryPreview, ImportStatus } from '../../../api/types'
import { GRADES } from '../../../admissions/constants'
import { HistoryFileError, readHistoryWorkbook, type HistorySheetGrid } from '../../../admissions/imports/historyWorkbook'
import { NO_VALUE } from '../../../admissions/statsFormat'
import { notifyError } from '../../../composables/notify'
import { useRequestSequence } from '../../../composables/useRequestSequence'
import { formatCount } from '../area/areaFormat'

// 歷年註冊（規格 §6 做法 C、§7）：園方「目標執行統計表」在瀏覽器只擷取表頭與年級列的數字送出，伺服器用和 CLI
// 相同的規則解析；預覽回來的 payload 原樣送回確認匯入、整校取代。資料庫有、新檔沒有的學期要多勾一次才能確認。
// 表看不懂時列出伺服器回的遮罩表頭（第 0 欄只留年級），讓業主不用跑 CLI 也能交給開發者核對。
// 換校區、確認回 409 或校區不符：清掉預覽與選檔，請使用者重新預覽。
const props = defineProps<{ campusKey: string; status: ImportStatus | null }>()
const emit = defineEmits<{ imported: [] }>()

const READ_FAILED = '無法讀取這個檔案，請確認是園方的目標執行統計表（.xls）'

const fileInput = ref<HTMLInputElement | null>(null)
const preview = ref<HistoryPreview | null>(null)
const error = ref('')
const headers = ref<WorkbookHeader[]>([])
const acknowledged = ref(false)
const previewing = ref(false)
const applying = ref(false)
// 確認對話框開著時擋住第二次點擊（對話框關掉後 applying 才接手）。
let confirming = false
const previews = useRequestSequence()

const titleId = useId()
const target = computed(() => `匯入到：${campusLabel(props.campusKey)}`)
const current = computed(() => props.status?.history ?? null)
const table = computed(() => (preview.value ? historyTable(preview.value.payload.rows) : []))
const removedText = computed(() => preview.value?.removed_terms.map(termText).join('、') ?? '')
const canConfirm = computed(() => Boolean(preview.value) && (!preview.value!.removed_terms.length || acknowledged.value))

function clearPreview() {
  previews.begin()
  preview.value = null
  error.value = ''
  headers.value = []
  acknowledged.value = false
  previewing.value = false
}
function reset() {
  clearPreview()
  if (fileInput.value) fileInput.value.value = ''
}
watch(() => props.campusKey, reset)

function chooseFile() {
  if (previewing.value || applying.value || !fileInput.value) return
  // 先清掉上一次的選擇，同一個檔案再選一次也會觸發 change。
  fileInput.value.value = ''
  fileInput.value.click()
}

async function onFileChange() {
  const file = fileInput.value?.files?.[0]
  if (!file) return
  clearPreview()
  const request = previews.begin()
  previewing.value = true
  try {
    let sheets: HistorySheetGrid[]
    try {
      sheets = await readHistoryWorkbook(await file.arrayBuffer())
    } catch (err) {
      if (previews.isCurrent(request)) error.value = err instanceof HistoryFileError ? err.message : READ_FAILED
      return
    }
    if (!previews.isCurrent(request)) return
    const result = await previewHistoryImport(props.campusKey, { sheets })
    if (previews.isCurrent(request)) preview.value = result
  } catch (err) {
    if (!previews.isCurrent(request)) return
    error.value = apiErrorMessage(err, '預覽失敗，請再試一次。')
    headers.value = workbookHeaders(err)
  } finally {
    if (previews.isCurrent(request)) previewing.value = false
  }
}

async function confirmImport() {
  const chosen = preview.value
  if (!chosen || !canConfirm.value || applying.value || confirming) return
  // 對話框寫的是哪一校就送哪一校：先記下校區。請求序號也從這裡起算，對話框開著時頁首換了校區，
  // ImportsTab 會卸載這張卡片、序號跟著過期，結果就改用全域提示告知（畫面已經是別校）。
  const campusKey = props.campusKey
  const label = campusLabel(campusKey)
  const request = previews.begin()
  confirming = true
  try {
    const lines = [
      `${historyCompareText(current.value, chosen)}。`,
      ...(chosen.removed_terms.length ? [`${removedText.value} 會被刪掉。`] : []),
      '確認後會整校換掉這校目前的歷年註冊。',
    ]
    await ElMessageBox.confirm(importConfirmMessage(target.value, lines), '確認匯入歷年註冊？', {
      confirmButtonText: '確認匯入',
      cancelButtonText: '先不要',
      type: 'warning',
      autofocus: false,
    })
  } catch {
    return
  } finally {
    confirming = false
  }
  // 對話框開著時預覽被換掉或清掉（重選了檔案、這張卡片自己收到新校區）就不送。頁首換校區時卡片是直接被卸載，
  // 預覽還在：照對話框寫的校區送出（伺服器也核對 payload 的校區）。
  if (preview.value !== chosen) return
  applying.value = true
  try {
    const result = await applyHistoryImport(campusKey, chosen.payload)
    ElMessage.success(`已匯入到${label}：歷年註冊 ${formatCount(result.rows)} 列`)
    if (!previews.isCurrent(request)) return
    reset()
    emit('imported')
  } catch (err) {
    const message = apiErrorMessage(err, '匯入失敗，請再試一次。')
    if (!previews.isCurrent(request)) {
      notifyError(`匯入到${label}失敗：${message}`)
      return
    }
    if (isStalePreview(err)) reset()
    error.value = message
  } finally {
    applying.value = false
  }
}
</script>

<template>
  <section class="import-card" :aria-labelledby="titleId" data-test="history-card">
    <h3 :id="titleId" class="import-card__title">歷年註冊</h3>

    <div>
      <h4 class="import-card__label">目前資料</h4>
      <div data-test="history-current">
        <p v-if="!current" class="empty-note">{{ NOT_IMPORTED_TEXT }}</p>
        <dl v-else class="import-facts">
          <div><dt>學期範圍</dt><dd class="num">{{ historyStatusRange(current) }}</dd></div>
          <div><dt>列數</dt><dd class="num">{{ formatCount(current.rows) }} 列</dd></div>
          <div><dt>匯入時間</dt><dd class="num">{{ formatDateTime(current.imported_at) }}</dd></div>
        </dl>
      </div>
    </div>

    <div class="import-card__pick">
      <el-button type="primary" plain :loading="previewing" :disabled="applying" @click="chooseFile">選擇統計表</el-button>
      <input ref="fileInput" type="file" accept=".xls" class="visually-hidden" tabindex="-1" aria-hidden="true" data-test="history-file" @change="onFileChange">
      <p class="hint">{{ HISTORY_SENDS_TEXT }}</p>
    </div>

    <el-alert v-if="error" type="error" :closable="false" show-icon :title="error" class="import-card__alert" />
    <div v-if="headers.length" class="history-headers">
      <p class="hint">各表的表頭如下（第 0 欄只留年級，其他字已遮住），可以整段複製給開發者核對。</p>
      <pre class="history-headers__text" tabindex="0" data-test="history-headers">{{ workbookHeadersText(headers) }}</pre>
    </div>

    <div v-if="preview" class="import-preview" data-test="history-preview">
      <p class="import-target">{{ target }}</p>
      <p class="import-preview__line num">{{ historyCompareText(current, preview) }}</p>
      <template v-if="current">
        <p v-if="!preview.changed.length" class="import-preview__line">{{ NO_CHANGE_TEXT }}</p>
        <div v-else>
          <h4 class="import-card__label">兩邊都有、註冊人數不同的</h4>
          <ul class="history-list num">
            <li v-for="change in preview.changed" :key="`${change.school_year}-${change.semester}-${change.grade}`">{{ changeText(change) }}</li>
          </ul>
        </div>
      </template>

      <div class="history-table">
        <table class="import-table" data-test="history-table">
          <thead>
            <tr>
              <th scope="col">學期</th>
              <th v-for="grade in GRADES" :key="grade" scope="col">{{ grade }}</th>
              <th scope="col">合計</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in table" :key="row.key">
              <th scope="row">{{ row.term }}</th>
              <td v-for="(count, index) in row.counts" :key="GRADES[index]" class="num">{{ count === null ? NO_VALUE : formatCount(count) }}</td>
              <td class="num">{{ formatCount(row.total) }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="preview.warnings.length">
        <h4 class="import-card__label">提醒</h4>
        <ul class="history-list">
          <li v-for="warning in preview.warnings" :key="warning">{{ warning }}</li>
        </ul>
      </div>

      <el-alert v-if="preview.removed_terms.length" type="warning" :closable="false" show-icon class="import-card__alert" title="這次的檔案沒有這些學期，匯入後會被刪掉">
        <p class="num">{{ removedText }}</p>
        <el-checkbox v-model="acknowledged" data-test="history-removed-ack">{{ REMOVED_ACK_TEXT }}</el-checkbox>
      </el-alert>
      <div class="import-preview__actions">
        <el-button type="primary" :loading="applying" :disabled="!canConfirm" @click="confirmImport">確認匯入</el-button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.history-headers {
  display: grid;
  gap: 6px;
  min-width: 0;
}

.history-headers .hint {
  margin: 0;
}

.history-headers__text {
  max-height: 320px;
  margin: 0;
  padding: 10px 12px;
  overflow: auto;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface-2);
  color: var(--ink);
  font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
  font-size: var(--text-xs);
  line-height: 1.6;
  white-space: pre-wrap;
  user-select: text;
}

.history-list {
  margin: 0;
  padding-left: 18px;
  color: var(--ink);
}

/* 三十幾個學期：表格自己捲，不把確認鈕推到很下面。 */
.history-table {
  max-height: 360px;
  overflow: auto;
}

.history-table .import-table th,
.history-table .import-table td {
  white-space: nowrap;
}

.history-table .import-table tbody td,
.history-table .import-table thead th:not(:first-child) {
  text-align: right;
}

.history-table thead th {
  position: sticky;
  top: 0;
  background: var(--surface-2);
}
</style>
