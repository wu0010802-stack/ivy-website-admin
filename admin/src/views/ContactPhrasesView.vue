<script setup lang="ts">
import { computed, onMounted, ref, useId, useTemplateRef } from 'vue'
import { ElMessage } from 'element-plus'
import { Delete, Plus } from '@element-plus/icons-vue'
import { api, ApiError } from '../api/client'
import { apiErrorMessage, isVersionConflict } from '../api/errors'
import { formatDateTime } from '../api/labels'
import type { ContactPhrasesOut, ContactPhrasesUpdate } from '../api/types'
import PageHeader from '../components/PageHeader.vue'
import { moveKeepingFocus } from '../composables/moveKeepingFocus'
import { revealListItem } from '../composables/newsContent'
import { notifyError, notifyWarning } from '../composables/notify'
import { invalidateContactPhrases } from '../composables/useContactPhrases'
import { useUnsavedChanges } from '../composables/useUnsavedChanges'

// 聯絡片語（2026-10-12 規格 4.2）：全站一份，總管理者維護。存檔立即生效，不經草稿與發布。
// 規則與後端相同（backend/app/contact_phrases/schemas.py）；真正的驗證在後端，
// 422 的 loc 指到第幾句，就標在那一句上。
const MAX_PHRASES = 20
const MAX_LENGTH = 60

const data = ref<ContactPhrasesOut | null>(null)
const draft = ref<string[]>([])
const loading = ref(true)
const loadError = ref(false)
const saving = ref(false)
// 第幾句（0 起算）→ 錯誤原因；清單層級的錯誤（例如超過 20 句）另放 listError。
const rowErrors = ref<Record<number, string>>({})
const listError = ref('')
const uid = useId()
const root = useTemplateRef<HTMLElement>('root')

const atLimit = computed(() => draft.value.length >= MAX_PHRASES)
const dirty = computed(() => JSON.stringify(draft.value) !== JSON.stringify(data.value?.phrases ?? []))
const lastEdit = computed(() => {
  const saved = data.value
  if (!saved?.updated_at) return ''
  return [saved.updated_by_name, formatDateTime(saved.updated_at)].filter(Boolean).join('・')
})
useUnsavedChanges(dirty, saving)

function clearErrors() {
  rowErrors.value = {}
  listError.value = ''
}

function applyLoaded(result: ContactPhrasesOut) {
  data.value = result
  draft.value = [...result.phrases]
  clearErrors()
}

async function load(): Promise<boolean> {
  loadError.value = false
  if (!data.value) loading.value = true
  try {
    applyLoaded(await api.get<ContactPhrasesOut>('/admin/contact-phrases'))
    return true
  } catch {
    // 第一次讀不到：整頁換成說明加重新載入；已經有內容時（409 後重讀）留著畫面上的內容。
    if (!data.value) loadError.value = true
    else notifyError('重新載入失敗，畫面上是先前讀到的片語，請再試一次。')
    return false
  } finally {
    loading.value = false
  }
}

function phraseName(index: number): string {
  const text = (draft.value[index] ?? '').trim()
  return text ? `第 ${index + 1} 句「${text}」` : `第 ${index + 1} 句`
}

function add() {
  if (atLimit.value) return
  draft.value.push('')
  void revealListItem(root.value, `[data-list-item="${draft.value.length - 1}"]`)
}

// 刪除、移動之後句子的順序變了，原本標在第幾句的錯誤已經對不上：全部清掉，存檔時會再檢查。
function remove(index: number) {
  draft.value.splice(index, 1)
  clearErrors()
}

function move(index: number, delta: number) {
  clearErrors()
  void moveKeepingFocus(draft.value, index, delta, root.value)
}

function edited(index: number) {
  if (rowErrors.value[index] === undefined) return
  const { [index]: _gone, ...rest } = rowErrors.value
  rowErrors.value = rest
}

// pydantic 的英文訊息換成中文；後端自己寫的（value_error）已經是中文，只拿掉前綴。
function describe(type: string, msg: string): string {
  if (type === 'string_too_short') return '請填寫內容，或刪除這一句'
  if (type === 'string_too_long') return `不能超過 ${MAX_LENGTH} 字`
  if (type === 'too_long') return `最多 ${MAX_PHRASES} 句，請先刪掉幾句`
  const text = msg.replace(/^Value error,\s*/, '')
  return /[㐀-鿿]/.test(text) ? text : '格式不正確'
}

/** 422 把錯誤標到對應那一句；有標到任何一處回 true。 */
function showValidationErrors(err: unknown): boolean {
  if (!(err instanceof ApiError) || err.status !== 422 || !Array.isArray(err.detail)) return false
  const rows: Record<number, string> = {}
  const list: string[] = []
  for (const item of err.detail as { loc?: unknown; msg?: unknown; type?: unknown }[]) {
    const loc = Array.isArray(item?.loc) ? item.loc : []
    const at = loc.indexOf('phrases')
    if (at < 0) continue
    const message = describe(typeof item.type === 'string' ? item.type : '', typeof item.msg === 'string' ? item.msg : '')
    const index = loc[at + 1]
    if (typeof index === 'number' && index >= 0 && index < draft.value.length) rows[index] ??= message
    else list.push(message)
  }
  if (!Object.keys(rows).length && !list.length) return false
  rowErrors.value = rows
  listError.value = [...new Set(list)].join('；')
  const first = Object.keys(rows).map(Number).sort((a, b) => a - b)[0]
  if (first !== undefined) void revealListItem(root.value, `[data-list-item="${first}"]`)
  return true
}

async function save() {
  const saved = data.value
  if (!saved || saving.value || !dirty.value) return
  clearErrors()
  const blanks = draft.value.flatMap((text, index) => (text.trim() ? [] : [index]))
  if (blanks.length) {
    rowErrors.value = Object.fromEntries(blanks.map((index) => [index, '請填寫內容，或刪除這一句']))
    void revealListItem(root.value, `[data-list-item="${blanks[0]}"]`)
    return
  }
  saving.value = true
  try {
    const body: ContactPhrasesUpdate = { phrases: draft.value.map((text) => text.trim()), expected_version: saved.version }
    applyLoaded(await api.put<ContactPhrasesOut>('/admin/contact-phrases', body))
    // 輸入框上方的片語下次掛載時重新讀
    invalidateContactPhrases()
    ElMessage.success('已儲存')
  } catch (err) {
    if (isVersionConflict(err)) {
      invalidateContactPhrases()
      // 不覆蓋別人的修改：重讀最新版，這邊還沒存的修改會被換掉，所以要講清楚。
      if (await load()) notifyWarning('剛有人改過片語，已重新載入')
    } else if (!showValidationErrors(err)) {
      notifyError(apiErrorMessage(err, '儲存失敗，請稍後再試'))
    }
  } finally {
    saving.value = false
  }
}

onMounted(() => void load())
</script>

<template>
  <div ref="root" class="page page--narrow phrases">
    <PageHeader lead="接待與招生記錄聯絡時，輸入框上方會出現這些片語，點一下帶入。" />

    <el-alert v-if="loadError" type="error" :closable="false" show-icon title="無法讀取聯絡片語，請重新載入。">
      <el-button :loading="loading" @click="load()">重新載入</el-button>
    </el-alert>
    <el-skeleton v-else-if="loading && !data" animated :rows="5" />

    <section v-else-if="data" class="panel" aria-labelledby="phrases-title">
      <div class="panel__head">
        <h2 id="phrases-title">片語</h2>
        <span class="hint num">{{ draft.length }} / {{ MAX_PHRASES }} 句</span>
      </div>
      <div class="panel__body">
        <el-alert v-if="listError" type="error" :closable="false" show-icon class="phrases__alert" :title="listError" />
        <p v-if="!draft.length" class="hint phrases__empty">目前沒有片語，輸入框上方不會出現這一列。</p>
        <ol v-if="draft.length" class="phrases__list">
          <li v-for="(_, index) in draft" :key="index" class="phrase-row" :class="{ 'is-error': rowErrors[index] !== undefined }" :data-list-item="index">
            <span class="phrase-row__no num" aria-hidden="true">{{ index + 1 }}</span>
            <div class="phrase-row__field">
              <el-input
                v-model="draft[index]"
                :maxlength="MAX_LENGTH"
                show-word-limit
                :disabled="saving"
                :aria-label="`第 ${index + 1} 句`"
                :aria-invalid="rowErrors[index] !== undefined"
                :aria-describedby="rowErrors[index] !== undefined ? `${uid}-error-${index}` : undefined"
                @input="edited(index)"
              />
              <p v-if="rowErrors[index] !== undefined" :id="`${uid}-error-${index}`" class="phrase-row__error" role="alert">{{ rowErrors[index] }}</p>
            </div>
            <span class="phrase-row__actions">
              <el-button
                text
                size="small"
                :disabled="saving || index === 0"
                :data-move-row="index"
                data-move-dir="-1"
                :aria-label="`上移${phraseName(index)}`"
                @click="move(index, -1)"
              >上移</el-button>
              <el-button
                text
                size="small"
                :disabled="saving || index === draft.length - 1"
                :data-move-row="index"
                data-move-dir="1"
                :aria-label="`下移${phraseName(index)}`"
                @click="move(index, 1)"
              >下移</el-button>
              <el-button text size="small" type="danger" :icon="Delete" :disabled="saving" :aria-label="`刪除${phraseName(index)}`" @click="remove(index)">刪除</el-button>
            </span>
          </li>
        </ol>
        <div class="phrases__add">
          <el-button :icon="Plus" :disabled="atLimit || saving" @click="add">新增一句</el-button>
          <span v-if="atLimit" class="field-help phrases__limit">最多 {{ MAX_PHRASES }} 句，要新增請先刪掉一句。</span>
        </div>
      </div>
      <div class="phrases__foot">
        <p v-if="lastEdit" class="hint phrases__meta">最後修改：{{ lastEdit }}</p>
        <el-button type="primary" :loading="saving" :disabled="!dirty" @click="save">儲存</el-button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.phrases__alert {
  margin-bottom: 12px;
}

.phrases__empty {
  margin: 0 0 12px;
}

.phrases__list {
  display: grid;
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.phrase-row {
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr) auto;
  align-items: start;
  gap: 4px 8px;
}

/* 序號對齊輸入框的第一行（輸入框高度 --control-h）。 */
.phrase-row__no {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: var(--control-h);
  color: var(--ink-3);
  font-size: var(--text-sm);
}

.phrase-row__field {
  min-width: 0;
}

/* 錯誤標在那一句：輸入框紅框，原因寫在下面（不靠 el-form-item，它的錯誤訊息會延遲 100ms 才出現）。 */
.phrase-row.is-error :deep(.el-input__wrapper) {
  box-shadow: 0 0 0 1px var(--el-color-danger) inset;
}

.phrase-row__error {
  margin: 4px 0 0;
  color: var(--el-color-danger);
  font-size: var(--text-sm);
  line-height: 1.45;
}

.phrase-row__actions {
  display: flex;
  align-items: center;
  min-height: var(--control-h);
  gap: 2px;
}

.phrases__add {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 12px;
  margin-top: 16px;
}

.phrases__limit {
  margin: 0;
}

.phrases__foot {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 8px 16px;
  padding: 14px 24px;
  border-top: 1px solid var(--line);
  background: var(--surface-2);
}

.phrases__meta {
  flex: 1 1 200px;
  margin: 0;
}

/* 手機：輸入框獨佔一行，上移／下移／刪除排在它下面，不擠成一條溢出畫面。 */
@media (max-width: 720px) {
  .phrase-row {
    grid-template-columns: 24px minmax(0, 1fr);
    padding-bottom: 8px;
    border-bottom: 1px solid var(--line);
  }

  .phrase-row__actions {
    grid-column: 2;
    flex-wrap: wrap;
    min-height: 0;
  }

  .phrases__foot {
    padding-inline: 16px;
  }
}
</style>
