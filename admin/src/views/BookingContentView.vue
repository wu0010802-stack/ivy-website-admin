<script setup lang="ts">
import { computed, nextTick, onMounted, useTemplateRef } from 'vue'
import type { InputInstance } from 'element-plus'
import { Delete, Plus } from '@element-plus/icons-vue'
import { useContentItem } from '../composables/useContentItem'
import { useCampusScope } from '../composables/useCampusScope'
import { moveKeepingFocus } from '../composables/moveKeepingFocus'
import { revealListItem } from '../composables/newsContent'
import { BANNER_CAMPUS_TOKEN, BANNER_DEFAULTS, bannerTitlePreview } from '../composables/contentHints'
import { campusLabel } from '../api/labels'
import { CAMPUS_KEYS, type BookingContentPayload } from '../api/types'
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

// 預約橫幅的標題預覽：用這個帳號看得到的第一校（總管理者是義華校）。官網用五校介紹
// 裡的校名，寫法和這裡一樣是「義華校」。
const { visibleCampusKeys } = useCampusScope({ autoSelect: false })
const previewCampus = computed(() => `${campusLabel(visibleCampusKeys.value[0] ?? CAMPUS_KEYS[0])}校`)
const bannerPreview = computed(() => bannerTitlePreview(editor.form.value.banner_title_template, previewCampus.value))
const bannerTitleBlank = computed(() => !editor.form.value.banner_title_template.trim())

// 「插入校名」：在標題欄的游標位置放入校名記號，園方不用自己打大括號。沒點過欄位時
// 游標在最後（瀏覽器換掉欄位內容時會把游標移到結尾），就接在最後面。
const bannerTitleInput = useTemplateRef<InputInstance>('bannerTitleInput')
async function insertCampusName() {
  const form = editor.form.value
  const value = form.banner_title_template
  const field = bannerTitleInput.value?.textarea
  const start = field?.selectionStart ?? value.length
  const end = field?.selectionEnd ?? value.length
  form.banner_title_template = value.slice(0, start) + BANNER_CAMPUS_TOKEN + value.slice(end)
  await nextTick()
  const caret = start + BANNER_CAMPUS_TOKEN.length
  field?.focus()
  field?.setSelectionRange(caret, caret)
}

onMounted(editor.load)
</script>

<template>
  <ContentEditor :editor="editor">
    <template #lead>
      預約按鈕、同意條款、隱私說明與分校頁底部預約橫幅的文字。各校採用哪種預約方式（表單、LINE、電話）在
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
      <el-form-item label="同意條款文字">
        <el-input v-model="editor.form.value.consent_text" type="textarea" :autosize="{ minRows: 2, maxRows: 5 }" />
        <span class="field-help">顯示在表單送出鈕上方，家長勾選後才能送出。每筆官網案件會記下家長同意的是哪一版（發布後的版本），案件明細看得到；改了文字並發布後，正在填表的家長要重新勾選。</span>
      </el-form-item>

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

      <h3 class="form-section">分校頁底部的預約橫幅</h3>
      <p class="field-help banner__lead">每個分校頁最下方的預約橫幅：一句標題、一段內文和預約按鈕。欄位留空時，官網沿用原本的文字。</p>
      <el-form-item label="橫幅標題">
        <el-input ref="bannerTitleInput" v-model="editor.form.value.banner_title_template" type="textarea" :autosize="{ minRows: 1, maxRows: 4 }" />
        <div v-if="!editor.readOnly.value" class="banner__tools">
          <el-button size="small" @click="insertCampusName">插入校名</el-button>
          <span class="field-help">
            在游標的位置放入 <code>{{ BANNER_CAMPUS_TOKEN }}</code>，官網每個分校頁會換成自己的校名，不用自己打校名或大括號。
          </span>
        </div>
        <p class="banner__preview" data-banner-preview>
          <span>{{ bannerTitleBlank ? `留空時沿用原本的標題，${previewCampus}分校頁會顯示：` : `${previewCampus}分校頁會顯示：` }}</span>
          <strong>{{ bannerPreview }}</strong>
        </p>
        <LengthHint :value="bannerTitleBlank ? '' : bannerPreview" rule="bannerTitle" />
      </el-form-item>
      <el-form-item label="內文">
        <el-input v-model="editor.form.value.banner_body" type="textarea" :autosize="{ minRows: 1, maxRows: 4 }" :placeholder="BANNER_DEFAULTS.body" />
        <LengthHint :value="editor.form.value.banner_body" rule="bannerBody" />
        <span class="field-help">留空時官網用原本的內文：{{ BANNER_DEFAULTS.body }}</span>
      </el-form-item>
      <el-form-item label="按鈕文字">
        <el-input v-model="editor.form.value.banner_button_label" :placeholder="BANNER_DEFAULTS.button" />
        <LengthHint :value="editor.form.value.banner_button_label" rule="bannerButton" />
        <span class="field-help">留空時官網用原本的按鈕文字：{{ BANNER_DEFAULTS.button }}</span>
      </el-form-item>
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
.banner__lead { margin: 0 0 12px; }
/* 插入校名鈕與說明、預覽各佔一行（el-form-item__content 是 flex-wrap）。 */
.banner__tools { display: flex; flex-basis: 100%; flex-wrap: wrap; align-items: center; gap: 4px 12px; margin-top: 8px; }
.banner__tools .field-help { flex: 1 1 16em; margin-top: 0; }
.banner__preview { flex-basis: 100%; margin: 8px 0 0; color: var(--ink-2); font-size: 13px; line-height: 1.5; }
.banner__preview strong { color: var(--ink); font-weight: 600; }
@media (max-width: 720px) {
  .banner__preview { font-size: 14px; }
}
.privacy__actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 8px; }
.privacy__actions .el-button + .el-button { margin-left: 0; }
.privacy__row-actions { display: flex; flex-wrap: wrap; gap: 4px; }
.privacy__row-actions .el-button + .el-button { margin-left: 0; }
</style>
