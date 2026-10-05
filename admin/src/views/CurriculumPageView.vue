<script setup lang="ts">
import { computed, onMounted } from 'vue'
import type { EditorSection } from '../composables/editorSections'
import { useContentItem } from '../composables/useContentItem'
import type { CurriculumPagePayload } from '../api/types'
import ContentEditor from '../components/ContentEditor.vue'
import PageCopyField from '../components/PageCopyField.vue'
import PagePhotoField from '../components/PagePhotoField.vue'
import { vReadonlyValues } from '../composables/readonlyValues'
import { builtinPhotoSrc } from '../composables/pageContent'
import {
  CURRICULUM_BUILTIN_PHOTOS,
  CURRICULUM_PHOTO_PREVIEWS,
  CURRICULUM_YEAR_NAMES,
  curriculumPageDraft,
  highlightMissing,
} from '../composables/curriculumPageDraft'

// 特色教學頁（/curriculum）。章節的數量、順序與版面固定，只改字和換照片（2026-10-03 使用者裁定）。
// 表單的空白值就是官網內建內容：從未存過版本時官網顯示的也是這一份，不會一打開就是空白。
const editor = useContentItem<CurriculumPagePayload>('curriculum_page', curriculumPageDraft())
const form = editor.form
const neverSaved = computed(() => !editor.loading.value && !editor.loadError.value && !editor.item.value?.latest_revision)
const highlightProblem = computed(() => highlightMissing(form.value.hero_title, form.value.hero_highlight))
const navSections = computed<EditorSection[]>(() => [
  { id: 'section-cur-hero', label: '首屏' },
  { id: 'section-cur-chapters', label: '章節索引' },
  { id: 'section-cur-years', label: '01 四個年段' },
  { id: 'section-cur-directions', label: '02 課程方向' },
  { id: 'section-cur-gallery', label: '03 兒童美術館' },
  { id: 'section-cur-daily', label: '04 五件事' },
  { id: 'section-cur-beliefs', label: '結尾：教學理念' },
])
const CHAPTER_NUMBERS = ['01', '02', '03', '04']

onMounted(editor.load)
</script>

<template>
  <ContentEditor :editor="editor" :sections="navSections">
    <template #lead>
      官網 <code>/curriculum</code> 特色教學頁的文字與照片。章節的數量、順序與版面是固定的，這裡只改字、換照片；照片留空就用官網內建的照片。
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

      <h3 id="section-cur-hero" class="sub-title" data-section-anchor tabindex="-1">首屏</h3>
      <PageCopyField v-model="form.hero_eyebrow" label="首屏小標" hint="curEyebrow" />
      <PageCopyField
        v-model="form.hero_title"
        label="首屏大標"
        hint="curHeroTitle"
        title
        help="桌機上大標每行大約放得下 9 個字，一行超過的話官網會再自動折一行；想在哪裡斷，就在那裡按 Enter。"
      />
      <PageCopyField v-model="form.hero_highlight" label="大標裡畫顏料的字" hint="curHighlight" help="要和大標同一行裡的字一模一樣；留空就不畫顏料。" />
      <p v-if="highlightProblem" class="page-copy__warn" role="status">大標裡找不到「{{ form.hero_highlight }}」（或跨了行），這樣存檔會被擋下。</p>
      <PageCopyField v-model="form.hero_lede" label="首屏介紹" hint="curLede" multiline />
      <PageCopyField v-model="form.hero_notice" label="首屏提醒" hint="curNotice" help="清空就不顯示。" />
      <PagePhotoField
        v-model:photo="form.hero_photo"
        v-model:alt="form.hero_photo_alt"
        label="首屏照片"
        builtin="官網內建的孩子靜心照片"
        :builtin-src="builtinPhotoSrc(CURRICULUM_BUILTIN_PHOTOS.hero)"
        :previews="CURRICULUM_PHOTO_PREVIEWS.hero"
        help="桌機放在右欄的撕紙框，大約是正方形（依螢幕高度略寬或略窄）；手機裁成 4:3。請用寬 2000 以上的照片，重點放在中間，或在下面點選焦點。"
        :disabled="editor.readOnly.value"
      />

      <h3 id="section-cur-chapters" class="sub-title" data-section-anchor tabindex="-1">章節索引</h3>
      <div data-list="chapters">
        <div v-for="(chapter, i) in form.chapters" :key="i" class="page-copy__item" :data-list-item="i">
          <p class="page-copy__item-title">{{ CHAPTER_NUMBERS[i] }}</p>
          <PageCopyField v-model="chapter.label" label="章節名稱" hint="curChapterLabel" />
          <PageCopyField v-model="chapter.hint" label="小字" hint="curChapterHint" />
        </div>
      </div>

      <h3 id="section-cur-years" class="sub-title" data-section-anchor tabindex="-1">01 四個年段</h3>
      <PageCopyField v-model="form.years_title" label="四個年段的標題" hint="curSectionTitle" title />
      <PageCopyField v-model="form.years_text" label="四個年段的說明" hint="curSectionText" multiline />
      <PageCopyField v-model="form.spiral_label" label="螺旋式課程的標題" hint="curSpiralLabel" />
      <PageCopyField v-model="form.spiral_text" label="螺旋式課程的說明" hint="curSpiralText" multiline />
      <PagePhotoField
        v-model:photo="form.years_photo"
        v-model:alt="form.years_photo_alt"
        label="四個年段的照片"
        builtin="官網內建的老師與孩子合照"
        :builtin-src="builtinPhotoSrc(CURRICULUM_BUILTIN_PHOTOS.years)"
        :previews="CURRICULUM_PHOTO_PREVIEWS.years"
        help="桌機放在標題右邊的撕紙框，各種螢幕都裁成 3:2。"
        :disabled="editor.readOnly.value"
      />
      <PageCopyField v-model="form.years_caption" label="照片下方文字" hint="curCaption" help="清空就不顯示。" />
      <div data-list="years">
        <div v-for="(year, i) in form.years" :key="i" class="page-copy__item" :data-list-item="i">
          <p class="page-copy__item-title">{{ CURRICULUM_YEAR_NAMES[i] }}</p>
          <PageCopyField v-model="year.motto" label="標語" hint="curMotto" help="官網會加上「」。" />
          <PageCopyField v-model="year.text" label="說明" hint="curYearText" multiline />
        </div>
      </div>

      <h3 id="section-cur-directions" class="sub-title" data-section-anchor tabindex="-1">02 課程方向</h3>
      <PageCopyField v-model="form.directions_title" label="課程方向的標題" hint="curSectionTitle" title />
      <PageCopyField v-model="form.directions_text" label="課程方向的說明" hint="curSectionText" multiline />
      <div data-list="directions">
        <div v-for="(direction, i) in form.directions" :key="direction.key" class="page-copy__item" :data-list-item="i">
          <p class="page-copy__item-title">
            第 {{ i + 1 }} 個方向<span v-if="direction.key === 'quote'" class="page-copy__item-note">印在顏料上的引言，沒有照片</span>
          </p>
          <PageCopyField v-model="direction.title" label="標題" hint="curDirTitle" />
          <!-- 品德培養的 sub 在官網是印在顏料上的大字引言（後端上限 10 字），標籤同 contentFieldLabels.ts 的 directions[3].sub -->
          <PageCopyField
            v-if="direction.key === 'quote'"
            v-model="direction.sub"
            label="引言（大字）"
            hint="curQuote"
            help="官網用很大的字印在顏料上，一行只放得下約 5 個字，最多 10 字。"
          />
          <PageCopyField v-else v-model="direction.sub" label="副標" hint="curDirSub" />
          <PageCopyField
            v-model="direction.text"
            label="說明"
            :hint="direction.key === 'quote' ? 'curQuoteText' : 'curDirText'"
            :help="direction.key === 'quote' ? '印在引言下面的一行字，最多 20 字。' : ''"
            multiline
          />
          <PagePhotoField
            v-if="direction.key !== 'quote'"
            v-model:photo="direction.photo"
            v-model:alt="direction.photo_alt"
            label="照片"
            builtin="官網內建的課程照"
            :builtin-src="builtinPhotoSrc(CURRICULUM_BUILTIN_PHOTOS.directions[i]!)"
            :previews="CURRICULUM_PHOTO_PREVIEWS.directions[i]"
            :disabled="editor.readOnly.value"
          />
        </div>
      </div>

      <h3 id="section-cur-gallery" class="sub-title" data-section-anchor tabindex="-1">03 兒童美術館</h3>
      <PageCopyField v-model="form.gallery_title" label="兒童美術館的標題" hint="curSectionTitle" title />
      <PageCopyField v-model="form.gallery_text" label="兒童美術館的說明" hint="curSectionText" multiline />
      <PageCopyField v-model="form.gallery_source" label="作品照片出處" hint="curSource" help="換成自己學校的照片時記得改；清空就不顯示。" />
      <div data-list="gallery">
        <div v-for="(art, i) in form.gallery" :key="i" class="page-copy__item" :data-list-item="i">
          <p class="page-copy__item-title">第 {{ i + 1 }} 件作品</p>
          <PageCopyField v-model="art.label" label="作品名稱" hint="curArtLabel" />
          <PagePhotoField
            v-model:photo="art.photo"
            v-model:alt="art.photo_alt"
            label="照片"
            builtin="官網內建的作品照"
            :builtin-src="builtinPhotoSrc(CURRICULUM_BUILTIN_PHOTOS.gallery[i]!)"
            no-focus
            help="作品照保留原本比例，不裁切；拍到孩子姓名的作品不要放。"
            :disabled="editor.readOnly.value"
          />
        </div>
      </div>

      <h3 id="section-cur-daily" class="sub-title" data-section-anchor tabindex="-1">04 五件事</h3>
      <PageCopyField v-model="form.daily_title" label="五件事的標題" hint="curSectionTitle" title />
      <PageCopyField v-model="form.daily_text" label="五件事的說明" hint="curSectionText" multiline />
      <PageCopyField v-model="form.daily_source" label="五件事的出處" hint="curSource" help="清空就不顯示。" />
      <div data-list="daily">
        <div v-for="(thing, i) in form.daily" :key="i" class="page-copy__item" :data-list-item="i">
          <p class="page-copy__item-title">第 {{ i + 1 }} 件事</p>
          <PageCopyField v-model="thing.title" label="名稱" hint="curDailyTitle" />
          <PageCopyField v-model="thing.text" label="介紹" hint="curDailyText" multiline />
          <PagePhotoField
            v-model:photo="thing.photo"
            v-model:alt="thing.photo_alt"
            label="照片"
            builtin="官網內建的義華校照片"
            :builtin-src="builtinPhotoSrc(CURRICULUM_BUILTIN_PHOTOS.daily[i]!)"
            :previews="CURRICULUM_PHOTO_PREVIEWS.daily"
            :disabled="editor.readOnly.value"
          />
        </div>
      </div>

      <h3 id="section-cur-beliefs" class="sub-title" data-section-anchor tabindex="-1">結尾：教學理念</h3>
      <PageCopyField v-model="form.belief_title" label="教學理念的標題" hint="curBeliefTitle" title />
      <div data-list="beliefs">
        <div v-for="(belief, i) in form.beliefs" :key="i" :data-list-item="i">
          <PageCopyField
            :model-value="belief"
            :label="`教學理念第 ${i + 1} 項`"
            hint="curBelief"
            @update:model-value="(value: string) => (form.beliefs[i] = value)"
          />
        </div>
      </div>
      <PageCopyField v-model="form.belief_close" label="教學理念的結語" hint="curClose" />
      <PageCopyField v-model="form.belief_source" label="教學理念的出處" hint="curSource" help="清空就不顯示。" />
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

.page-copy__warn {
  margin: -8px 0 16px;
  font-size: var(--text-xs);
  line-height: 1.6;
  color: var(--el-color-warning-dark-2);
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
