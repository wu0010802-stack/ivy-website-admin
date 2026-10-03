<script setup lang="ts">
import { computed, onMounted, useTemplateRef } from 'vue'
import { Delete, Plus } from '@element-plus/icons-vue'
import { useContentItem } from '../composables/useContentItem'
import { moveKeepingFocus } from '../composables/moveKeepingFocus'
import { revealListItem } from '../composables/newsContent'
import type { BookingContentPayload } from '../api/types'
import { PRIVACY_SAMPLE_MARKER, PRIVACY_SECTIONS_MAX, privacyHasSample, privacySampleSections } from '../composables/privacyNotice'
import ContentEditor from '../components/ContentEditor.vue'
import { vReadonlyValues } from '../composables/readonlyValues'
import LengthHint from '../components/LengthHint.vue'

const editor = useContentItem<BookingContentPayload>('booking_content', {
  cta_label: '',
  cta_label_en: '',
  consent_text: '',
  banner_title_template: '',
  banner_body: '',
  banner_button_label: '',
  privacy_title: '',
  privacy_sections: [],
})

const sections = computed(() => editor.form.value.privacy_sections)
// 示意段落不能發布（後端也會擋）；提早講，不要等按了發布才知道。
const hasSample = computed(() => privacyHasSample(editor.form.value))

const sectionsList = useTemplateRef<HTMLElement>('sectionsList')

// 新的一段加在最後（新增鈕在清單下方），加完捲過去並聚焦小標欄。
function addSection() {
  editor.form.value.privacy_sections.push({ heading: '', body: '' })
  void revealListItem(sectionsList.value, `[data-list-item="${editor.form.value.privacy_sections.length - 1}"]`)
}

function removeSection(index: number) {
  editor.form.value.privacy_sections.splice(index, 1)
}

function move(index: number, delta: number) {
  void moveKeepingFocus(editor.form.value.privacy_sections, index, delta, sectionsList.value)
}

// 正式條款由園方提供；這裡只給一份標了「【示意】」的骨架方便排版，發布前必須全部換掉。
function insertSample() {
  if (!editor.form.value.privacy_title.trim()) editor.form.value.privacy_title = '個資使用說明'
  editor.form.value.privacy_sections.push(...privacySampleSections())
}

onMounted(editor.load)
</script>

<template>
  <ContentEditor :editor="editor">
    <template #lead>
      預約按鈕、同意條款與隱私說明的文字。各校採用哪種預約方式（表單、LINE、電話）在
      <router-link to="/booking">各校預約方式</router-link> 設定。
    </template>

    <el-form v-readonly-values="editor.readOnly.value" label-position="top" :disabled="editor.readOnly.value" @submit.prevent>
      <h3 class="form-section">預約按鈕</h3>
      <div class="field-row">
        <el-form-item label="中文">
          <el-input v-model="editor.form.value.cta_label" placeholder="預約參觀" />
          <LengthHint :value="editor.form.value.cta_label" rule="bookingCta" />
        </el-form-item>
        <el-form-item label="英文副標">
          <el-input v-model="editor.form.value.cta_label_en" placeholder="Book a visit" />
        </el-form-item>
      </div>

      <h3 class="form-section">隱私／個資使用說明</h3>
      <p class="field-help privacy__lead">
        官網頁尾與預約表單的「個資使用說明」會開啟這段說明；還沒有段落時官網不顯示入口。正式內容請由園方提供，
        含「{{ PRIVACY_SAMPLE_MARKER }}」的示意文字不能發布。
      </p>
      <el-alert v-if="hasSample" type="warning" :closable="false" show-icon class="privacy__alert" :title="`還有「${PRIVACY_SAMPLE_MARKER}」示意文字，換成園方提供的正式內容後才能發布`" />
      <el-form-item label="說明標題">
        <el-input v-model="editor.form.value.privacy_title" maxlength="40" placeholder="個資使用說明" />
        <span class="field-help">留空時官網顯示「個資使用說明」。</span>
      </el-form-item>
      <div ref="sectionsList">
      <div v-for="(section, index) in sections" :key="index" class="repeat-item" :data-list-item="index">
        <div class="repeat-item__head">
          <span class="repeat-item__index"><b>{{ index + 1 }}</b>{{ section.heading.trim() || `第 ${index + 1} 段` }}</span>
          <span v-if="!editor.readOnly.value" class="privacy__row-actions">
            <el-button text size="small" :disabled="index === 0" :data-move-row="index" data-move-dir="-1" :aria-label="`上移第 ${index + 1} 段`" @click="move(index, -1)">上移</el-button>
            <el-button text size="small" :disabled="index === sections.length - 1" :data-move-row="index" data-move-dir="1" :aria-label="`下移第 ${index + 1} 段`" @click="move(index, 1)">下移</el-button>
            <el-button text size="small" type="danger" :icon="Delete" @click="removeSection(index)">移除</el-button>
          </span>
        </div>
        <el-form-item label="小標（選填）">
          <el-input v-model="section.heading" maxlength="60" placeholder="例如：蒐集目的" />
        </el-form-item>
        <el-form-item label="內文" required>
          <el-input v-model="section.body" type="textarea" :autosize="{ minRows: 2, maxRows: 8 }" />
        </el-form-item>
      </div>
      </div>
      <div v-if="!editor.readOnly.value" class="privacy__actions">
        <el-button :icon="Plus" :disabled="sections.length >= PRIVACY_SECTIONS_MAX" @click="addSection">新增一段</el-button>
        <el-button v-if="!sections.length" @click="insertSample">帶入示意段落</el-button>
        <span v-if="sections.length >= PRIVACY_SECTIONS_MAX" class="hint">最多 {{ PRIVACY_SECTIONS_MAX }} 段</span>
      </div>
    </el-form>
  </ContentEditor>
</template>

<style scoped>
.form-section {
  margin: 4px 0 12px;
  color: var(--ink-2);
}

.el-form-item + .form-section,
.field-row + .form-section,
.privacy__actions + .form-section {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid var(--line);
}

.privacy__lead { margin: 0 0 12px; }
.privacy__alert { margin-bottom: 12px; }
.privacy__actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 8px; }
.privacy__actions .el-button + .el-button { margin-left: 0; }
.privacy__row-actions { display: flex; flex-wrap: wrap; gap: 4px; }
.privacy__row-actions .el-button + .el-button { margin-left: 0; }
</style>
