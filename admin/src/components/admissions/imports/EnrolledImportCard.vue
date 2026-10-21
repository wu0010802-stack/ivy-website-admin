<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  DOORPLATE_CHANGED_TEXT, ENROLLED_SENDS_TEXT, LOW_RATIO_TEXT, NOT_IMPORTED_TEXT, countsText, enrolledCompareText, importConfirmMessage,
  isStalePreview, levelLabel, methodLabel, placedRatioText, rosterDateText,
} from './importFormat'
import { applyEnrolledImport, clearEnrolledImport, previewEnrolledImport } from '../../../api/admissions'
import { apiErrorMessage } from '../../../api/errors'
import { campusLabel, formatDateTime } from '../../../api/labels'
import type { EnrolledImportPayload, EnrolledPreview, EnrolledPreviewRequest, ImportStatus } from '../../../api/types'
import { RosterFileError, enrolledPreviewBody, parseRosterHtml } from '../../../admissions/imports/roster'
import { NO_VALUE } from '../../../admissions/statsFormat'
import { notifyError } from '../../../composables/notify'
import { useRequestSequence } from '../../../composables/useRequestSequence'
import { doorplateVersionLabel, formatCount, reasonLabel } from '../area/areaFormat'

// 在籍清冊（規格 §5、§7）：教保資訊網「園所幼生清冊」匯出檔在瀏覽器解析，只送班別與地址給伺服器比對，
// 預覽回來的去識別點位原樣送回確認匯入、整校取代。清冊有生日：解析結果只活在 previewSelectedFile 裡，
// 元件狀態只留檔案上的園所名稱、選的日期與預覽回應；選的檔案只在 <input> 裡，沒有列印日期時選了日期再重讀一次。
// 換校區、確認回 409（門牌換版）或校區不符：清掉預覽與選檔，請使用者重新預覽。
const props = defineProps<{ campusKey: string; status: ImportStatus | null }>()
const emit = defineEmits<{ imported: [] }>()

const READ_FAILED = '無法讀取這個檔案，請確認是教保資訊網匯出的園所幼生清冊（.xls）'

const fileInput = ref<HTMLInputElement | null>(null)
const institution = ref<string | null>(null)
const needsDate = ref(false)
const rosterDate = ref<string | null>(null)
const preview = ref<EnrolledPreview | null>(null)
const error = ref('')
const previewing = ref(false)
const applying = ref(false)
const clearing = ref(false)
// 確認對話框開著時擋住第二次點擊（對話框關掉後 applying 才接手）。
let confirming = false
const previews = useRequestSequence()

const titleId = useId()
const dateId = useId()
const target = computed(() => `匯入到：${campusLabel(props.campusKey)}`)
const current = computed(() => props.status?.enrolled ?? null)
const doorplateChanged = computed(() => {
  const active = props.status?.active_doorplate_version ?? null
  return current.value !== null && active !== null && current.value.doorplate_version !== active
})

// 清掉預覽（重選檔案時）；reset 連這次選的檔一起清（換校區、匯入成功、預覽不能用了）。
function clearPreview() {
  previews.begin()
  preview.value = null
  error.value = ''
  institution.value = null
  needsDate.value = false
  rosterDate.value = null
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

function onFileChange() {
  const file = fileInput.value?.files?.[0]
  if (!file) return
  clearPreview()
  void previewSelectedFile(file, null)
}

// 沒有列印日期：選了日期再從 <input> 重讀同一個檔案（檔案選擇器取消時瀏覽器可能已經清掉，就請使用者重選）。
function chooseDate(value: string | null) {
  rosterDate.value = value
  if (!value) return
  const file = fileInput.value?.files?.[0]
  if (file) {
    void previewSelectedFile(file, value)
    return
  }
  clearPreview()
  error.value = '請重新選擇清冊檔。'
}

// 清冊只在這個函式裡解析：生日與地址不進元件狀態，送出的本文只有清冊日期與每位的班別、地址。
async function previewSelectedFile(file: File, chosenDate: string | null) {
  const request = previews.begin()
  error.value = ''
  preview.value = null
  let body: EnrolledPreviewRequest
  try {
    const roster = parseRosterHtml(await file.text())
    if (!previews.isCurrent(request)) return
    institution.value = roster.institution
    const date = roster.printedOn ?? chosenDate
    if (!date) {
      needsDate.value = true
      return
    }
    body = enrolledPreviewBody(roster, date)
  } catch (err) {
    if (previews.isCurrent(request)) error.value = err instanceof RosterFileError ? err.message : READ_FAILED
    return
  }
  previewing.value = true
  try {
    const result = await previewEnrolledImport(props.campusKey, body)
    if (previews.isCurrent(request)) preview.value = result
  } catch (err) {
    if (previews.isCurrent(request)) error.value = apiErrorMessage(err, '預覽失敗，請再試一次。')
  } finally {
    if (previews.isCurrent(request)) previewing.value = false
  }
}

async function confirmImport() {
  const chosen = preview.value
  if (!chosen?.importable || applying.value || clearing.value || confirming) return
  confirming = true
  try {
    const lines = [
      ...(institution.value ? [`檔案上的園所：${institution.value}`] : []),
      `${enrolledCompareText(current.value, chosen)}。`,
      '確認後會整校換掉這校目前的在籍資料。',
    ]
    await ElMessageBox.confirm(importConfirmMessage(target.value, lines), '確認匯入在籍清冊？', {
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
  // 對話框開著時換了校區或重選了檔案：這份預覽已經不是畫面上那份，不送。
  if (preview.value !== chosen) return
  const request = previews.begin()
  const label = campusLabel(props.campusKey)
  applying.value = true
  try {
    // 預覽回來的 payload 原樣送回：契約上 match_level 是字串，伺服器收到時才驗是不是五種等級之一。
    const result = await applyEnrolledImport(props.campusKey, chosen.payload as EnrolledImportPayload)
    ElMessage.success(`已匯入到${label}：${formatCount(result.students)} 位，有點 ${formatCount(result.placed)} 位`)
    if (!previews.isCurrent(request)) return
    reset()
    emit('imported')
  } catch (err) {
    if (!previews.isCurrent(request)) return
    const message = apiErrorMessage(err, '匯入失敗，請再試一次。')
    if (isStalePreview(err)) reset()
    error.value = message
  } finally {
    applying.value = false
  }
}

// 對話框寫的是哪一校就清哪一校：先記下校區，對話框開著時頁首換了校區也不會清到別校。
async function clearData() {
  if (clearing.value || applying.value) return
  const campusKey = props.campusKey
  const label = campusLabel(campusKey)
  try {
    await ElMessageBox.confirm(`會刪掉${label}的在籍清冊與所有點；區域分析的「在籍學生」與招生潛力會跟著沒有這份資料，要再看得重新上傳清冊。`, `清除${label}的在籍資料？`, {
      confirmButtonText: '清除',
      cancelButtonText: '先不要',
      type: 'warning',
      confirmButtonClass: 'el-button--danger',
      autofocus: false,
    })
  } catch {
    return
  }
  clearing.value = true
  try {
    const result = await clearEnrolledImport(campusKey)
    ElMessage.success(result.removed ? `已清除${label}的在籍資料` : `${label}本來就沒有在籍資料`)
    emit('imported')
  } catch (err) {
    notifyError(apiErrorMessage(err, '清除失敗，請再試一次。'))
  } finally {
    clearing.value = false
  }
}

const disableFuture = (date: Date) => date.getTime() > Date.now()
</script>

<template>
  <section class="import-card" :aria-labelledby="titleId" data-test="enrolled-card">
    <h3 :id="titleId" class="import-card__title">在籍清冊</h3>

    <div>
      <h4 class="import-card__label">目前資料</h4>
      <div data-test="enrolled-current">
        <p v-if="!current" class="empty-note">{{ NOT_IMPORTED_TEXT }}</p>
        <dl v-else class="import-facts">
          <div><dt>清冊日期</dt><dd class="num">{{ rosterDateText(current.roster_date) }}</dd></div>
          <div><dt>學年</dt><dd class="num">{{ current.school_year }} 學年</dd></div>
          <div><dt>人數</dt><dd class="num">{{ formatCount(current.total) }} 位（有點 {{ formatCount(current.placed) }} 位）</dd></div>
          <div><dt>比對用門牌</dt><dd>{{ doorplateVersionLabel(current.doorplate_version) }}版</dd></div>
          <div><dt>匯入時間</dt><dd class="num">{{ formatDateTime(current.imported_at) }}</dd></div>
        </dl>
      </div>
      <p v-if="doorplateChanged" class="import-card__warn">{{ DOORPLATE_CHANGED_TEXT }}</p>
    </div>

    <div class="import-card__pick">
      <el-button type="primary" plain :loading="previewing" :disabled="applying" @click="chooseFile">選擇清冊檔</el-button>
      <input ref="fileInput" type="file" accept=".xls" class="visually-hidden" tabindex="-1" aria-hidden="true" data-test="enrolled-file" @change="onFileChange">
      <p class="hint">{{ ENROLLED_SENDS_TEXT }}</p>
    </div>

    <div v-if="needsDate" class="enrolled-date">
      <label :for="dateId">清冊上沒有列印日期，請選清冊是哪一天的（用來算班別）</label>
      <el-date-picker
        :id="dateId"
        :model-value="rosterDate"
        type="date"
        value-format="YYYY-MM-DD"
        placeholder="清冊日期"
        :disabled-date="disableFuture"
        :disabled="previewing || applying"
        @update:model-value="chooseDate"
      />
    </div>

    <el-alert v-if="error" type="error" :closable="false" show-icon :title="error" class="import-card__alert" />

    <div v-if="preview" class="import-preview" data-test="enrolled-preview">
      <p class="import-target">{{ target }}</p>
      <p v-if="institution" class="import-preview__line">檔案上的園所：{{ institution }}</p>
      <p class="import-preview__line num">{{ enrolledCompareText(current, preview) }}</p>
      <dl class="import-facts">
        <div><dt>人數</dt><dd class="num">共 {{ formatCount(preview.total) }} 位，有點 {{ formatCount(preview.placed) }} 位（{{ placedRatioText(preview.placed_ratio) }}）</dd></div>
        <div><dt>學年</dt><dd class="num">{{ preview.school_year }} 學年</dd></div>
        <div><dt>比對用門牌</dt><dd>{{ doorplateVersionLabel(preview.doorplate_version) }}版</dd></div>
      </dl>
      <dl class="enrolled-counts">
        <div><dt>各班人數</dt><dd class="num">{{ countsText(preview.grades) }}</dd></div>
        <div><dt>比對等級</dt><dd class="num">{{ countsText(preview.levels, levelLabel) }}</dd></div>
        <div><dt>補區方式</dt><dd class="num">{{ countsText(preview.methods, methodLabel) }}（其中推定 {{ formatCount(preview.inferred) }} 位）</dd></div>
      </dl>
      <div v-if="preview.unplaced.length" class="enrolled-unplaced">
        <h4 class="import-card__label">沒有點的學生（{{ formatCount(preview.unplaced.length) }} 位，只列到街路）</h4>
        <table class="import-table" data-test="enrolled-unplaced">
          <thead><tr><th scope="col">比對等級</th><th scope="col">原因</th><th scope="col">街路</th></tr></thead>
          <tbody>
            <tr v-for="(item, index) in preview.unplaced" :key="index">
              <td>{{ levelLabel(item.match_level) }}</td>
              <td>{{ item.unlocated_reason ? reasonLabel(item.unlocated_reason) : NO_VALUE }}</td>
              <td>{{ item.street || NO_VALUE }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <el-alert v-if="!preview.importable" type="warning" :closable="false" show-icon :title="LOW_RATIO_TEXT" class="import-card__alert" />
      <div class="import-preview__actions">
        <el-button type="primary" :loading="applying" :disabled="!preview.importable || clearing" @click="confirmImport">確認匯入</el-button>
      </div>
    </div>

    <div v-if="current" class="enrolled-secondary">
      <el-button text type="danger" size="small" :loading="clearing" :disabled="applying" @click="clearData">清除這校在籍資料</el-button>
    </div>
  </section>
</template>

<style scoped>
.enrolled-date {
  display: grid;
  gap: 6px;
  justify-items: start;
  color: var(--ink-2);
  font-size: var(--text-sm);
}

.enrolled-counts {
  display: grid;
  gap: 6px;
  margin: 0;
}

.enrolled-counts div {
  display: grid;
  grid-template-columns: 6em minmax(0, 1fr);
  gap: 12px;
}

.enrolled-counts dt {
  color: var(--ink-3);
  font-size: var(--text-sm);
}

.enrolled-counts dd {
  margin: 0;
  color: var(--ink);
}

.enrolled-unplaced {
  max-height: 320px;
  overflow: auto;
}

.enrolled-secondary {
  display: flex;
  justify-content: flex-end;
}

@media (max-width: 720px) {
  .enrolled-counts div {
    grid-template-columns: minmax(0, 1fr);
    gap: 2px;
  }
}
</style>
