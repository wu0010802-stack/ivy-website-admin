<script setup lang="ts">
import { computed, ref, useTemplateRef } from 'vue'
import { Delete, Plus } from '@element-plus/icons-vue'
import { api } from '../api/client'
import { useContentItem } from '../composables/useContentItem'
import { useCampusContent } from '../composables/useCampusContent'
import type { CampusFaqItemPayload, CampusFaqPayload, ContentItemOut, ContentRevisionOut, SharedFaqItemPayload } from '../api/types'
import ContentEditor from '../components/ContentEditor.vue'
import LengthHint from '../components/LengthHint.vue'
import CampusSelect from '../components/CampusSelect.vue'
import { moveItem } from '../composables/newsContent'

const MAX_ITEMS = 20

// 舊版內容沒有 enabled／include_shared／shared_position，載入時補預設值。
function normalize(payload: CampusFaqPayload): CampusFaqPayload {
  return {
    items: (payload.items ?? []).map((item) => ({ q: item.q ?? '', a: item.a ?? '', enabled: item.enabled ?? true })),
    include_shared: payload.include_shared ?? true,
    shared_position: payload.shared_position === 'after' ? 'after' : 'before',
  }
}

const campus = ref('')
const editor = useContentItem<CampusFaqPayload>(
  'campus_faq',
  { items: [], include_shared: true, shared_position: 'before' },
  campus,
  { normalize },
)
const shell = useTemplateRef<InstanceType<typeof ContentEditor>>('shell')
const { visibleCampusKeys } = useCampusContent(editor, campus, shell)

// 全站共用題目：顯示官網上（已發布）的版本；還沒發布過就顯示最新草稿並註明。
const shared = ref<SharedFaqItemPayload[]>([])
const sharedIsDraft = ref(false)

async function loadShared() {
  try {
    const item = await api.get<ContentItemOut>('/admin/content-items/shared_faq')
    let payload = item.latest_revision?.payload as { items?: SharedFaqItemPayload[] } | undefined
    sharedIsDraft.value = !item.current_published_revision_id
    if (item.current_published_revision_id && item.current_published_revision_id !== item.latest_revision?.id) {
      const published = await api.get<ContentRevisionOut>(`/admin/content-items/shared_faq/revisions/${item.current_published_revision_id}`)
      payload = published.payload as { items?: SharedFaqItemPayload[] }
    }
    shared.value = Array.isArray(payload?.items) ? payload.items.filter((i) => typeof i?.q === 'string') : []
  } catch {
    shared.value = []
  }
}

loadShared()

const ownQuestions = computed(() => new Map(editor.form.value.items.map((item) => [item.q.trim(), item])))

// 這一校看得到的共用題目（啟用、適用這校）；規則同官網 content-overlay 的 mergeCampusFaq。
const sharedForCampus = computed(() =>
  shared.value.filter(
    (item) => item.enabled !== false && (item.scope !== 'campus' || (item.campus_keys ?? []).includes(campus.value)),
  ),
)

function overrideOf(item: SharedFaqItemPayload): CampusFaqItemPayload | undefined {
  return ownQuestions.value.get(item.q.trim())
}

function sharedStatus(item: SharedFaqItemPayload): string {
  if (!editor.form.value.include_shared) return '不顯示'
  const own = overrideOf(item)
  if (!own) return '顯示共用答案'
  return own.enabled ? '改顯示本校版本' : '本校不顯示'
}

// 同一題寫一份本校版本：停用＝這校不顯示那一題；啟用＝這校顯示自己的答案。
function hideShared(item: SharedFaqItemPayload) {
  editor.form.value.items.push({ q: item.q, a: '', enabled: false })
}

function rewriteShared(item: SharedFaqItemPayload) {
  editor.form.value.items.push({ q: item.q, a: item.a, enabled: true })
}

function isOverride(item: CampusFaqItemPayload): boolean {
  return Boolean(item.q.trim()) && sharedForCampus.value.some((s) => s.q.trim() === item.q.trim())
}

// 在官網顯示的題目問題與回答都要有（後端同一條規則，存檔會被擋）。「本校不顯示」
// 產生的題目沒有回答，切回顯示前要先寫回答；兩格都空的新題目等填了一格再提示。
function blankError(item: CampusFaqItemPayload, field: 'q' | 'a'): string {
  if (!item.enabled || item[field].trim()) return ''
  const other = field === 'q' ? item.a : item.q
  if (!other.trim()) return ''
  return field === 'q' ? '在官網顯示的題目要填問題，不顯示請改成停用' : '在官網顯示的題目要填回答，不顯示請改成停用'
}

function addItem() {
  editor.form.value.items.push({ q: '', a: '', enabled: true })
}
</script>

<template>
  <ContentEditor
    ref="shell"
    :editor="editor"
    :placeholder="visibleCampusKeys.length === 0 ? '你的帳號沒有可編輯的校區。' : undefined"
  >
    <template #lead>
      分校頁「常見問題」：本校自己的題目依這裡的順序顯示（最多 {{ MAX_ITEMS }} 題），另外可以一起顯示全站共用題目。
      停用的題目留在這裡、官網不顯示。
    </template>
    <template #toolbar>
      <CampusSelect v-model="campus" :keys="visibleCampusKeys" />
    </template>

    <el-form label-position="top" :disabled="editor.readOnly.value" @submit.prevent>
      <section class="faq-shared">
        <div class="section__title">
          <h2>全站共用題目</h2>
          <span class="hint">{{ sharedForCampus.length }} 題適用本校</span>
        </div>
        <div class="field-row">
          <el-form-item label="是否顯示">
            <el-switch v-model="editor.form.value.include_shared" active-text="顯示共用題目" inactive-text="不顯示" aria-label="顯示共用題目" />
          </el-form-item>
          <el-form-item label="放在哪裡">
            <el-radio-group v-model="editor.form.value.shared_position" :disabled="!editor.form.value.include_shared">
              <el-radio value="before">本校題目之前</el-radio>
              <el-radio value="after">本校題目之後</el-radio>
            </el-radio-group>
          </el-form-item>
        </div>
        <p v-if="sharedIsDraft && sharedForCampus.length" class="hint">共用題目還沒發布，以下是最新草稿。</p>
        <p v-if="!sharedForCampus.length" class="hint">目前沒有適用本校的共用題目（由總部在「分校頁 → 共用常見問題」編輯）。</p>
        <ul v-else class="faq-shared__list">
          <li v-for="item in sharedForCampus" :key="item.id">
            <div class="faq-shared__q">
              <strong>{{ item.q }}</strong>
              <el-tag size="small" :type="sharedStatus(item) === '顯示共用答案' ? 'success' : 'info'">{{ sharedStatus(item) }}</el-tag>
            </div>
            <p class="faq-shared__a">{{ item.a }}</p>
            <span v-if="!editor.readOnly.value && editor.form.value.include_shared && !overrideOf(item)" class="cell-actions">
              <el-button text size="small" @click="rewriteShared(item)">改寫本校版本</el-button>
              <el-button text size="small" @click="hideShared(item)">本校不顯示</el-button>
            </span>
          </li>
        </ul>
      </section>

      <div class="section__title" style="margin-top: 24px">
        <h2>本校題目</h2>
        <span class="hint">{{ editor.form.value.items.length }} / {{ MAX_ITEMS }} 題</span>
      </div>
      <p v-if="!editor.form.value.items.length" class="hint">本校沒有自己的題目。</p>
      <div v-for="(qa, index) in editor.form.value.items" :key="index" class="repeat-item">
        <div class="repeat-item__head">
          <span class="repeat-item__index">
            <b>{{ index + 1 }}</b>第 {{ index + 1 }} 題
            <el-tag v-if="!qa.enabled" size="small" type="info">已停用，官網不顯示</el-tag>
            <el-tag v-if="isOverride(qa)" size="small" type="warning">
              {{ qa.enabled ? '和共用題目同一題：本校顯示這個版本' : '和共用題目同一題：本校不顯示那一題（移除這題就恢復顯示共用答案）' }}
            </el-tag>
          </span>
          <span v-if="!editor.readOnly.value" class="cell-actions">
            <el-button text size="small" :disabled="index === 0" @click="moveItem(editor.form.value.items, index, -1)">上移</el-button>
            <el-button text size="small" :disabled="index === editor.form.value.items.length - 1" @click="moveItem(editor.form.value.items, index, 1)">下移</el-button>
            <el-button text size="small" type="danger" :icon="Delete" @click="editor.form.value.items.splice(index, 1)">移除</el-button>
          </span>
        </div>
        <el-form-item>
          <el-switch v-model="qa.enabled" active-text="在官網顯示" inactive-text="停用" :aria-label="`第 ${index + 1} 題在官網顯示`" />
        </el-form-item>
        <el-form-item label="問題" :error="blankError(qa, 'q')">
          <el-input v-model="qa.q" placeholder="例如：幾歲可以入園？" />
          <LengthHint :value="qa.q" rule="faqQuestion" />
        </el-form-item>
        <el-form-item label="回答" :error="blankError(qa, 'a')">
          <el-input v-model="qa.a" type="textarea" :autosize="{ minRows: 2, maxRows: 8 }" />
          <LengthHint :value="qa.a" rule="faqAnswer" />
        </el-form-item>
      </div>

      <template v-if="!editor.readOnly.value">
        <el-button :icon="Plus" :disabled="editor.form.value.items.length >= MAX_ITEMS" @click="addItem">
          新增一題
        </el-button>
        <span v-if="editor.form.value.items.length >= MAX_ITEMS" class="hint" style="margin-left: 8px">已達上限</span>
      </template>
    </el-form>
  </ContentEditor>
</template>

<style scoped>
.repeat-item__head {
  flex-wrap: wrap;
}

.faq-shared {
  padding-bottom: 8px;
  border-bottom: 1px solid var(--line);
}

.faq-shared__list {
  display: grid;
  gap: 10px;
  margin: 0 0 12px;
  padding: 0;
  list-style: none;
}

.faq-shared__list li {
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--surface-2);
  min-width: 0;
}

.faq-shared__q {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 10px;
}

.faq-shared__a {
  margin: 4px 0 0;
  color: var(--ink-2);
  font-size: 13px;
  line-height: 1.6;
  overflow-wrap: anywhere;
}
</style>
