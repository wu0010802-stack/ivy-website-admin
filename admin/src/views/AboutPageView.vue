<script setup lang="ts">
import { computed, onMounted } from 'vue'
import type { EditorSection } from '../composables/editorSections'
import { useContentItem } from '../composables/useContentItem'
import type { AboutPagePayload } from '../api/types'
import { campusLabel } from '../api/labels'
import ContentEditor from '../components/ContentEditor.vue'
import PageCopyField from '../components/PageCopyField.vue'
import PagePhotoField from '../components/PagePhotoField.vue'
import { vReadonlyValues } from '../composables/readonlyValues'
import { builtinPhotoSrc } from '../composables/pageContent'
import { ABOUT_BUILTIN_PHOTOS, ABOUT_CHAPTER_HINTS, ABOUT_PHOTO_PREVIEWS, aboutPageDraft } from '../composables/aboutPageDraft'

// 關於常春藤頁（/about，立體書）。章節、沿革五站、期許兩段固定，只改字和換照片（2026-10-03 使用者裁定）。
// 六大領域與核心素養是課綱名詞、家長怎麼說由各校的五校介紹編，都不在這裡。
const editor = useContentItem<AboutPagePayload>('about_page', aboutPageDraft())
const form = editor.form
const neverSaved = computed(() => !editor.loading.value && !editor.loadError.value && !editor.item.value?.latest_revision)
const navSections = computed<EditorSection[]>(() => [
  { id: 'section-about-hero', label: '首屏', fields: ['hero_title', 'hero_lede', 'hero_caption', 'hero_photo', 'hero_photo_alt', 'hero_back_photo', 'hero_back_photo_alt'] },
  { id: 'section-about-chapters', label: '章名', fields: ['chapter_names'] },
  { id: 'section-about-story', label: '第一章：一路走來', fields: ['story_title', 'story_text', 'milestones'] },
  { id: 'section-about-whole', label: '第二章：全人教育', fields: ['whole_title', 'whole_text', 'whole_fine', 'whole_fine_source'] },
  { id: 'section-about-hope', label: '第三章：我們的期許', fields: ['hope_title', 'hope_quotes', 'hope_photo', 'hope_photo_alt'] },
  { id: 'section-about-outro', label: '結尾：五所校園', fields: ['outro_title', 'outro_text'] },
])

// 民國年＝西元 − 1911（同官網 utils/page-content.ts 的 rocYear）；年份清空時（null）不顯示。
function rocLabel(year: number | null): string {
  return typeof year === 'number' ? `民國 ${year - 1911} 年` : ''
}

// 年份要由早到晚：後端擋存檔時錯誤只指到整個沿革，這裡先在比上一站早的那一站提醒（不擋存檔）。
function orderError(index: number): string {
  const previous = form.value.milestones[index - 1]
  const year = form.value.milestones[index]?.year
  if (!previous || typeof previous.year !== 'number' || typeof year !== 'number' || year >= previous.year) return ''
  return `比上一站（${campusLabel(previous.key)} ${previous.year}）早，年份要由早到晚，否則存不了`
}

onMounted(editor.load)
</script>

<template>
  <ContentEditor :editor="editor" :sections="navSections">
    <template #lead>
      官網 <code>/about</code> 關於常春藤頁（立體書）的文字與照片。章節、沿革五站與版面是固定的，這裡只改字、換照片；校名與校區照片跟著「五校介紹」，家長分享影片在各校的五校介紹裡編。
    </template>

    <el-form v-readonly-values="editor.readOnly.value" label-position="top" :disabled="editor.readOnly.value" @submit.prevent>
      <el-alert
        v-if="neverSaved"
        type="info"
        :closable="false"
        show-icon
        class="page-copy__alert"
        title="官網目前顯示的是內建內容，就是下面這些字。改了按儲存，才會存成第一個版本。"
      />

      <h3 id="section-about-hero" class="sub-title" data-section-anchor tabindex="-1">首屏</h3>
      <PageCopyField v-model="form.hero_title" label="首屏大標" hint="aboutPageTitle" title help="桌機每行超過約 7–10 字，官網會再自動折行，建議每行短一點。" />
      <PageCopyField v-model="form.hero_lede" label="首屏介紹" hint="aboutPageLede" multiline help="介紹裡寫了創校年份；改下面沿革的年份時記得一起改。" />
      <PageCopyField v-model="form.hero_caption" label="首屏照片上的一句話" hint="aboutPageCaption" />
      <PagePhotoField
        v-model:photo="form.hero_photo"
        v-model:alt="form.hero_photo_alt"
        label="首屏照片"
        builtin="官網內建的創辦人與孩子合照"
        :builtin-src="builtinPhotoSrc(ABOUT_BUILTIN_PHOTOS.hero)"
        :previews="ABOUT_PHOTO_PREVIEWS.hero"
        help="右頁前面那張大卡紙，各種螢幕都裁成 4:3；請用寬 2000 以上的照片，重點放在中間，或在下面點選焦點。"
        :disabled="editor.readOnly.value"
      />
      <PagePhotoField
        v-model:photo="form.hero_back_photo"
        v-model:alt="form.hero_back_photo_alt"
        label="首屏後排照片"
        builtin="官網內建的孩子指著發現的照片"
        :builtin-src="builtinPhotoSrc(ABOUT_BUILTIN_PHOTOS.heroBack)"
        :previews="ABOUT_PHOTO_PREVIEWS.heroBack"
        help="右頁後面那張小卡紙，裁成 4:5 的直式；官網內建照片的重點在右上；換成自己的照片後沒設焦點就取中間，請在下面點選焦點。"
        :disabled="editor.readOnly.value"
      />

      <h3 id="section-about-chapters" class="sub-title" data-section-anchor tabindex="-1">章名</h3>
      <div data-list="chapter_names">
        <div v-for="(name, i) in form.chapter_names" :key="i" :data-list-item="i">
          <PageCopyField
            :model-value="name"
            :label="`章名第 ${i + 1} 個`"
            hint="aboutChapter"
            :help="ABOUT_CHAPTER_HINTS[i]"
            @update:model-value="(value: string) => (form.chapter_names[i] = value)"
          />
        </div>
      </div>

      <h3 id="section-about-story" class="sub-title" data-section-anchor tabindex="-1">第一章：一路走來</h3>
      <PageCopyField v-model="form.story_title" label="一路走來的標題" hint="aboutStoryTitle" title help="第一行最多 6 字、第二三行最多 7 字，避開右上角的紀念章；超過存不了。" />
      <PageCopyField v-model="form.story_text" label="一路走來的說明" hint="aboutPageText" multiline />
      <div data-list="milestones">
        <div v-for="(milestone, i) in form.milestones" :key="milestone.key" class="page-copy__item" :data-list-item="i">
          <p class="page-copy__item-title">{{ campusLabel(milestone.key) }}<span v-if="rocLabel(milestone.year)" class="page-copy__item-note">{{ rocLabel(milestone.year) }}</span></p>
          <el-form-item label="年份" :error="orderError(i)">
            <el-input-number v-model="milestone.year" :min="1950" :max="2100" :precision="0" :controls="false" />
            <span class="field-help">西元年；官網的民國年自動換算。年份要由早到晚。</span>
            <span v-if="i === 0" class="field-help">改了義華的年份，這一頁在搜尋結果的標題與說明會跟著改；首屏介紹和首頁「關於常春藤」（SINCE 1997 與介紹）寫的年份要自己改；30 週年頁上的 1997 不會跟著改，要改請通知工程師。</span>
          </el-form-item>
          <PageCopyField v-model="milestone.text" label="說明" hint="aboutMilestone" />
        </div>
      </div>

      <h3 id="section-about-whole" class="sub-title" data-section-anchor tabindex="-1">第二章：全人教育</h3>
      <PageCopyField v-model="form.whole_title" label="全人教育的標題" hint="aboutPageTitle" title help="桌機每行超過約 7–10 字，官網會再自動折行，建議每行短一點。" />
      <PageCopyField v-model="form.whole_text" label="全人教育的說明" hint="aboutPageText" multiline />
      <PageCopyField v-model="form.whole_fine" label="全人教育的補充" hint="aboutFine" multiline />
      <PageCopyField v-model="form.whole_fine_source" label="全人教育的出處" hint="aboutSource" help="清空就不顯示。六大領域與核心素養是課綱名詞，不在這裡改。" />

      <h3 id="section-about-hope" class="sub-title" data-section-anchor tabindex="-1">第三章：我們的期許</h3>
      <PageCopyField v-model="form.hope_title" label="我們的期許的標題" hint="aboutHopeTitle" title help="桌機每行超過約 7–10 字，官網會再自動折行，建議每行短一點。" />
      <div data-list="hope_quotes">
        <div v-for="(quote, i) in form.hope_quotes" :key="i" :data-list-item="i">
          <PageCopyField
            :model-value="quote"
            :label="`期許第 ${i + 1} 段`"
            hint="aboutQuote"
            multiline
            @update:model-value="(value: string) => (form.hope_quotes[i] = value)"
          />
        </div>
      </div>
      <PagePhotoField
        v-model:photo="form.hope_photo"
        v-model:alt="form.hope_photo_alt"
        label="紙房子窗戶的照片"
        builtin="官網內建的長輩與孩子合照"
        :builtin-src="builtinPhotoSrc(ABOUT_BUILTIN_PHOTOS.hope)"
        :previews="ABOUT_PHOTO_PREVIEWS.hope"
        help="右頁紙房子的窗戶，裁成 4:3，而且很小，選人臉清楚的，並在下面點選焦點。"
        :disabled="editor.readOnly.value"
      />

      <h3 id="section-about-outro" class="sub-title" data-section-anchor tabindex="-1">結尾：五所校園</h3>
      <PageCopyField v-model="form.outro_title" label="五所校園的標題" hint="aboutOutroTitle" help="也是首屏目次的最後一格。" />
      <PageCopyField v-model="form.outro_text" label="五所校園的說明" hint="aboutOutroText" multiline />
    </el-form>
  </ContentEditor>
</template>

<style scoped>
.sub-title {
  margin: 24px 0 12px;
  font-size: var(--text-md);
  font-weight: 600;
}

.page-copy__alert {
  margin-bottom: 16px;
}

.page-copy__item {
  margin-bottom: 12px;
  padding: 12px 16px 4px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
}

.page-copy__item-title {
  margin: 0 0 8px;
  font-weight: 600;
}

.page-copy__item-note {
  margin-left: 8px;
  font-size: var(--text-xs);
  font-weight: 400;
  color: var(--el-text-color-secondary);
}
</style>
