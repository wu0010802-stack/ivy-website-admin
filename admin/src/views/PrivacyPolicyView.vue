<script setup lang="ts">
import { computed, onMounted, useTemplateRef } from 'vue'
import type { EditorSection } from '../composables/editorSections'
import { Delete, Plus } from '@element-plus/icons-vue'
import { useContentItem } from '../composables/useContentItem'
import { moveKeepingFocus } from '../composables/moveKeepingFocus'
import { revealListItem } from '../composables/newsContent'
import {
  PRIVACY_POLICY_PENDING_MARKER,
  PRIVACY_POLICY_SECTIONS_MAX,
  privacyPolicyDraft,
  privacyPolicyPendingCount,
} from '../composables/privacyPolicyDraft'
import type { PrivacyPolicyPayload } from '../api/types'
import ContentEditor from '../components/ContentEditor.vue'
import { vReadonlyValues } from '../composables/readonlyValues'

// 從未存過任何版本時帶入初稿：載入、讀取錯誤後的「重新載入」、「放棄修改」都由 useContentItem
// 一致套用（seed）；快照仍是空白表單，所以畫面是「有未儲存的修改」，儲存鈕可以按。
const editor = useContentItem<PrivacyPolicyPayload>('privacy_policy', { title: '隱私權政策', updated_on: null, sections: [] }, undefined, {
  seed: privacyPolicyDraft,
})
const form = editor.form
const sections = computed(() => form.value.sections)
// 段落目錄：每一段一項，小標空白時寫「第 N 段」（和清單標題同一個寫法）。
const navSections = computed<EditorSection[]>(() =>
  sections.value.map((section, index) => ({ id: `policy-section-${index}`, label: section.heading.trim() || `第 ${index + 1} 段` })),
)
const pending = computed(() => privacyPolicyPendingCount(form.value))
// 從未存過任何版本：畫面上的是初稿（還沒存），按儲存才會變成第一個版本。
const isUnsavedDraft = computed(() => !editor.loading.value && !editor.loadError.value && !editor.item.value?.latest_revision)

const sectionsList = useTemplateRef<HTMLElement>('sectionsList')

function addSection() {
  form.value.sections.push({ heading: '', body: '' })
  void revealListItem(sectionsList.value, `[data-list-item="${form.value.sections.length - 1}"]`)
}

function removeSection(index: number) {
  form.value.sections.splice(index, 1)
}

function move(index: number, delta: number) {
  void moveKeepingFocus(form.value.sections, index, delta, sectionsList.value)
}

function jumpToPending() {
  const index = sections.value.findIndex((s) => `${s.heading}${s.body}`.includes(PRIVACY_POLICY_PENDING_MARKER))
  if (index >= 0) void revealListItem(sectionsList.value, `[data-list-item="${index}"]`)
}

onMounted(editor.load)
</script>

<template>
  <ContentEditor :editor="editor" :sections="navSections">
    <template #lead>
      官網 <code>/privacy</code> 的隱私權政策。發布後頁尾與預約表單會多一個「隱私權政策」連結；還沒發布時官網沒有這一頁。
    </template>

    <el-form v-readonly-values="editor.readOnly.value" label-position="top" :disabled="editor.readOnly.value" @submit.prevent>
      <el-alert
        v-if="isUnsavedDraft"
        type="info"
        :closable="false"
        show-icon
        class="policy__alert"
        title="這是初稿，尚未儲存。補完【待確認】、填好最後更新日期後才能發布。"
      />
      <el-alert
        v-if="pending > 0"
        type="warning"
        :closable="false"
        show-icon
        class="policy__alert"
        :title="`還有 ${pending} 處「${PRIVACY_POLICY_PENDING_MARKER}】」要補完才能發布`"
      >
        <el-button text size="small" @click="jumpToPending">跳到第一處</el-button>
      </el-alert>

      <el-form-item label="標題" required>
        <el-input v-model="form.title" maxlength="40" show-word-limit />
      </el-form-item>
      <el-form-item label="最後更新日期" required>
        <el-date-picker
          v-model="form.updated_on"
          type="date"
          value-format="YYYY-MM-DD"
          format="YYYY 年 M 月 D 日"
          placeholder="選擇日期"
          :clearable="true"
        />
        <span class="field-help">顯示在官網標題下方；發布前必填。</span>
      </el-form-item>

      <h3 class="form-section">政策段落</h3>
      <p class="field-help policy__lead">
        內文寫法：空一行就另起一段；一行開頭寫「- 」會變成條列；內文裡的 <code>https://</code> 網址會自動變成可點的連結。不能寫 HTML。
      </p>
      <div ref="sectionsList">
        <div v-for="(section, index) in sections" :id="`policy-section-${index}`" :key="index" class="repeat-item" :data-list-item="index" data-section-anchor tabindex="-1">
          <div class="repeat-item__head">
            <span class="repeat-item__index"><b>{{ index + 1 }}</b>{{ section.heading.trim() || `第 ${index + 1} 段` }}</span>
            <span v-if="!editor.readOnly.value" class="policy__row-actions">
              <el-button text size="small" :disabled="index === 0" :data-move-row="index" data-move-dir="-1" :aria-label="`上移第 ${index + 1} 段`" @click="move(index, -1)">上移</el-button>
              <el-button text size="small" :disabled="index === sections.length - 1" :data-move-row="index" data-move-dir="1" :aria-label="`下移第 ${index + 1} 段`" @click="move(index, 1)">下移</el-button>
              <el-button text size="small" type="danger" :icon="Delete" @click="removeSection(index)">移除</el-button>
            </span>
          </div>
          <el-form-item label="小標" required>
            <el-input v-model="section.heading" maxlength="60" show-word-limit placeholder="例如：蒐集的資料" />
          </el-form-item>
          <el-form-item label="內文" required>
            <el-input v-model="section.body" type="textarea" maxlength="2000" show-word-limit :autosize="{ minRows: 3, maxRows: 14 }" />
          </el-form-item>
        </div>
      </div>
      <div v-if="!editor.readOnly.value" class="policy__actions">
        <el-button :icon="Plus" :disabled="sections.length >= PRIVACY_POLICY_SECTIONS_MAX" @click="addSection">新增一段</el-button>
        <span v-if="sections.length >= PRIVACY_POLICY_SECTIONS_MAX" class="hint">最多 {{ PRIVACY_POLICY_SECTIONS_MAX }} 段</span>
      </div>
    </el-form>
  </ContentEditor>
</template>

<style scoped>
.form-section {
  margin: 16px 0 12px;
  padding-top: 16px;
  border-top: 1px solid var(--line);
  color: var(--ink-2);
}
.policy__alert { margin-bottom: 12px; }
.policy__lead { margin: 0 0 12px; }
.policy__actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 8px; }
.policy__row-actions { display: flex; flex-wrap: wrap; gap: 4px; }
.policy__row-actions .el-button + .el-button { margin-left: 0; }
</style>
