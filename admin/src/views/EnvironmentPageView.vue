<script setup lang="ts">
import { computed, onMounted } from 'vue'
import type { EditorSection } from '../composables/editorSections'
import { useContentItem } from '../composables/useContentItem'
import type { EnvironmentPagePayload } from '../api/types'
import ContentEditor from '../components/ContentEditor.vue'
import PageCopyField from '../components/PageCopyField.vue'
import PagePhotoField from '../components/PagePhotoField.vue'
import type { TitleFontSubset } from '../composables/useTitleFontCoverage'
import { vReadonlyValues } from '../composables/readonlyValues'
import { builtinPhotoSrc } from '../composables/pageContent'
import { normalizeMomentTime } from '../composables/contentHints'
import { highlightMissing } from '../composables/curriculumPageDraft'
import {
  ENVIRONMENT_BUILTIN_PHOTOS,
  ENVIRONMENT_CHAPTER_HINTS,
  ENVIRONMENT_PHOTO_PREVIEWS,
  environmentPageDraft,
  mealOrderError,
  mealTimeError,
} from '../composables/environmentPageDraft'

// 常春藤環境頁（/environment）前三章：幼兒保育、校園環境、幼兒餐點。項目數量、順序與版面固定，只改字和換照片
// （2026-10-12 使用者裁定）；第四章「五所校園」的場景照片與說明在「校園探索」，這裡只改它的標題與段落。
// 照片的積木形狀、結尾三張卡與營養餐點書連結寫在官網程式裡，不在這裡。
// 2026-10-30 官網改成木頭積木版、照片不放說明或註解：首屏與保育照片下的一句話、照片上的便條、小腳印與選校提示
// 官網不再顯示，這裡也不列（資料照舊保留在內容裡，後端欄位不變）。
const editor = useContentItem<EnvironmentPagePayload>('environment_page', environmentPageDraft())
const form = editor.form
const neverSaved = computed(() => !editor.loading.value && !editor.loadError.value && !editor.item.value?.latest_revision)
const highlightProblem = computed(() => highlightMissing(form.value.hero_title, form.value.hero_highlight))
// 官網不再顯示、表單不列的欄位（hero_caption、care_caption、care_photo_note、trail_hint、tour_hint）資料還在，
// 照舊歸到原本那一段：每個欄位都要有段落，被別處改到時（例如還原舊版本）段落目錄照樣打點。
const navSections = computed<EditorSection[]>(() => [
  { id: 'section-env-hero', label: '首屏', fields: ['hero_title', 'hero_highlight', 'hero_lede', 'hero_notice', 'hero_photo', 'hero_photo_alt', 'hero_caption'] },
  { id: 'section-env-chapters', label: '章名', fields: ['chapter_names'] },
  {
    id: 'section-env-care',
    label: '01 幼兒保育',
    fields: ['care_title', 'care_lead', 'hearts', 'care_text', 'care_photo', 'care_photo_alt', 'care_caption', 'care_photo_note', 'care_items'],
  },
  { id: 'section-env-spaces', label: '02 校園環境', fields: ['spaces_title', 'spaces_text', 'feature', 'trail_hint', 'spaces'] },
  { id: 'section-env-meals', label: '03 幼兒餐點', fields: ['meals_title', 'meals_text', 'meals_day_title', 'meals'] },
  { id: 'section-env-tour', label: '04 五所校園', fields: ['tour_title', 'tour_text', 'tour_hint'] },
])

// 整頁都是圓體（標題 800、小標 700、內文 400）：罕用字會退回系統字，欄位下方提示。
// 圓體 800 只補最常用的字（字型目錄要在 15 MB 內），所以 800 的大標（首屏 h1 與四章 h2）用嚴格的字表，
// 其餘欄位（小標、內文）用 400／700 的字表。「大標裡畫螢光的字」是大標的一段，不另外檢查。
const ENV_TITLE_FONTS: TitleFontSubset[] = ['environment']
const ENV_FONTS: TitleFontSubset[] = ['environmentText']

const CARE_PHOTO_HELP = '五張照片各裝在一種積木形狀裡（拱、圓、四分之一圓、倒拱、半圓），會裁掉邊緣；重點放在中間，或在下面點選焦點。留空就用官網內建的照片。'

// 餐點時間：格式（兩位數的時:分）與由早到晚。後端擋存檔時只講整個清單，這裡先在那一個餐點提醒。
function timeError(index: number): string {
  const meals = form.value.meals
  return mealTimeError(meals[index]?.time) || mealOrderError(meals, index)
}

onMounted(editor.load)
</script>

<template>
  <ContentEditor :editor="editor" :sections="navSections">
    <template #lead>
      官網 <code>/environment</code> 常春藤環境頁前三章（幼兒保育、校園環境、幼兒餐點）的文字與照片。項目數量、順序與版面是固定的，這裡只改字、換照片；照片留空就用官網內建的照片。第四章「五所校園」的場景照片在「校園探索」。
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

      <h3 id="section-env-hero" class="sub-title" data-section-anchor tabindex="-1">首屏</h3>
      <PageCopyField v-model="form.hero_title" label="首屏大標" hint="envHeroTitle" :fonts="ENV_TITLE_FONTS" title />
      <PageCopyField v-model="form.hero_highlight" label="大標裡畫螢光的字" hint="envHighlight" help="要和大標同一行裡的字一模一樣，官網會在那幾個字下面畫螢光；留空就不畫。" />
      <p v-if="highlightProblem" class="page-copy__warn" role="status">大標裡找不到「{{ form.hero_highlight }}」（或跨了行），這樣存檔會被擋下。</p>
      <PageCopyField v-model="form.hero_lede" label="首屏介紹" hint="envHeroLede" :fonts="ENV_FONTS" multiline />
      <PageCopyField v-model="form.hero_notice" label="首屏提醒" hint="envHeroNotice" :fonts="ENV_FONTS" help="清空就不顯示。" />
      <PagePhotoField
        v-model:photo="form.hero_photo"
        v-model:alt="form.hero_photo_alt"
        label="首屏照片"
        builtin="官網內建的兩個孩子擁抱的照片"
        :builtin-src="builtinPhotoSrc(ENVIRONMENT_BUILTIN_PHOTOS.hero)"
        :previews="ENVIRONMENT_PHOTO_PREVIEWS.hero"
        help="放在彩虹疊疊樂最內圈的拱裡，裁成直的（約 3:4），左右會被裁掉；請用寬 2000 以上的照片，重點放在中間，或在下面點選焦點。"
        :disabled="editor.readOnly.value"
      />

      <h3 id="section-env-chapters" class="sub-title" data-section-anchor tabindex="-1">章名</h3>
      <div data-list="chapter_names">
        <div v-for="(name, i) in form.chapter_names" :key="i" :data-list-item="i">
          <PageCopyField
            :model-value="name"
            :label="`章名第 ${i + 1} 個`"
            hint="envChapterName"
            :fonts="ENV_FONTS"
            :help="ENVIRONMENT_CHAPTER_HINTS[i]"
            @update:model-value="(value: string) => (form.chapter_names[i] = value)"
          />
        </div>
      </div>

      <h3 id="section-env-care" class="sub-title" data-section-anchor tabindex="-1">01 幼兒保育</h3>
      <PageCopyField v-model="form.care_title" label="幼兒保育的標題" hint="envCareTitle" :fonts="ENV_TITLE_FONTS" title />
      <PageCopyField v-model="form.care_lead" label="幼兒保育的引言" hint="envCareLead" :fonts="ENV_FONTS" help="接在五顆心前面，結尾的冒號自己打。" />
      <h4 class="sub-sub-title">五顆心</h4>
      <div data-list="hearts" class="env-hearts">
        <div v-for="(heart, i) in form.hearts" :key="i" :data-list-item="i">
          <PageCopyField
            :model-value="heart"
            :label="`第 ${i + 1} 顆心`"
            hint="envHeart"
            :fonts="ENV_FONTS"
            @update:model-value="(value: string) => (form.hearts[i] = value)"
          />
        </div>
      </div>
      <PageCopyField v-model="form.care_text" label="幼兒保育的說明" hint="envCareText" :fonts="ENV_FONTS" multiline />
      <PagePhotoField
        v-model:photo="form.care_photo"
        v-model:alt="form.care_photo_alt"
        label="幼兒保育照片"
        builtin="官網內建的老師帶孩子拍手唱歌的照片"
        :builtin-src="builtinPhotoSrc(ENVIRONMENT_BUILTIN_PHOTOS.care)"
        :previews="ENVIRONMENT_PHOTO_PREVIEWS.care"
        help="橫幅積木，右端是半圓，桌機約 2.75:1、手機約 2.2:1；請用寬 2000 以上的照片。官網內建照片的重點在最左邊，換成自己的照片後沒設焦點就取中間，請在下面點選焦點。"
        :disabled="editor.readOnly.value"
      />

      <h4 class="sub-sub-title">五件照顧的小事</h4>
      <div data-list="care_items">
        <div v-for="(item, i) in form.care_items" :key="i" class="page-copy__item" :data-list-item="i">
          <p class="page-copy__item-title">第 {{ i + 1 }} 件小事</p>
          <PageCopyField v-model="item.title" label="名稱" hint="envCareItemTitle" :fonts="ENV_FONTS" />
          <PageCopyField v-model="item.text" label="說明" hint="envCareItemText" :fonts="ENV_FONTS" multiline />
          <PagePhotoField
            v-model:photo="item.photo"
            v-model:alt="item.photo_alt"
            label="照片"
            builtin="官網內建的照顧照片"
            :builtin-src="builtinPhotoSrc(ENVIRONMENT_BUILTIN_PHOTOS.careItems[i]!)"
            :previews="ENVIRONMENT_PHOTO_PREVIEWS.careItem"
            :help="CARE_PHOTO_HELP"
            :disabled="editor.readOnly.value"
          />
        </div>
      </div>

      <h3 id="section-env-spaces" class="sub-title" data-section-anchor tabindex="-1">02 校園環境</h3>
      <PageCopyField v-model="form.spaces_title" label="校園環境的標題" hint="envSpacesTitle" :fonts="ENV_TITLE_FONTS" title />
      <PageCopyField v-model="form.spaces_text" label="校園環境的說明" hint="envSpacesText" :fonts="ENV_FONTS" multiline />
      <h4 class="sub-sub-title">主打區</h4>
      <div class="page-copy__item">
        <PageCopyField v-model="form.feature.tag" data-field="feature.tag" label="主打區的標籤" hint="envFeatureTag" :fonts="ENV_FONTS" />
        <PageCopyField v-model="form.feature.title" data-field="feature.title" label="主打區的標題" hint="envFeatureTitle" :fonts="ENV_FONTS" title />
        <PageCopyField v-model="form.feature.text" data-field="feature.text" label="主打區的說明" hint="envFeatureText" :fonts="ENV_FONTS" multiline />
        <PagePhotoField
          v-model:photo="form.feature.photo"
          v-model:alt="form.feature.photo_alt"
          label="主打區的照片"
          builtin="官網內建的遊樂區照片"
          :builtin-src="builtinPhotoSrc(ENVIRONMENT_BUILTIN_PHOTOS.feature)"
          :previews="ENVIRONMENT_PHOTO_PREVIEWS.feature"
          help="桌機放在左欄，各種螢幕都裁成 3:2，左下角是大圓角；請用寬 2000 以上的照片，重點放在中間，或在下面點選焦點。"
          :disabled="editor.readOnly.value"
        />
      </div>
      <h4 class="sub-sub-title">圓點小路串起的六個空間</h4>
      <div data-list="spaces">
        <div v-for="(space, i) in form.spaces" :key="i" class="page-copy__item" :data-list-item="i">
          <p class="page-copy__item-title">第 {{ i + 1 }} 個空間</p>
          <PageCopyField v-model="space.title" label="名稱" hint="envSpaceTitle" :fonts="ENV_FONTS" />
          <PageCopyField v-model="space.text" label="說明" hint="envSpaceText" :fonts="ENV_FONTS" multiline />
          <PageCopyField v-model="space.campus_label" label="照片上的校名" hint="envSpaceCampus" :fonts="ENV_FONTS" help="只有確定是哪一校拍的照片才填，其餘留空就不顯示校名。" />
          <PagePhotoField
            v-model:photo="space.photo"
            v-model:alt="space.photo_alt"
            label="空間照片"
            builtin="官網內建的空間照片"
            :builtin-src="builtinPhotoSrc(ENVIRONMENT_BUILTIN_PHOTOS.spaces[i]!)"
            :previews="ENVIRONMENT_PHOTO_PREVIEWS.space"
            help="六張照片各裝在一種積木形狀裡（圓、拱、半圓等），會裁掉邊緣；重點放在中間，或在下面點選焦點。"
            :disabled="editor.readOnly.value"
          />
        </div>
      </div>

      <h3 id="section-env-meals" class="sub-title" data-section-anchor tabindex="-1">03 幼兒餐點</h3>
      <PageCopyField v-model="form.meals_title" label="幼兒餐點的標題" hint="envMealsTitle" :fonts="ENV_TITLE_FONTS" title />
      <PageCopyField v-model="form.meals_text" label="幼兒餐點的說明" hint="envMealsText" :fonts="ENV_FONTS" multiline />
      <PageCopyField v-model="form.meals_day_title" label="一天吃什麼的標題" hint="envMealsDayTitle" :fonts="ENV_FONTS" />
      <h4 class="sub-sub-title">一天的五個時段</h4>
      <p class="field-help page-copy__list-help">官網把這五個時段由早到晚排成一條時間軸，小圖示依序號固定（吐司、香蕉、碗、蘋果、杯子），所以時間要由早到晚，不能同一時間。</p>
      <div data-list="meals">
        <div v-for="(meal, i) in form.meals" :key="i" class="page-copy__item" :data-list-item="i">
          <p class="page-copy__item-title">第 {{ i + 1 }} 個時段</p>
          <el-form-item label="時間" :error="timeError(i)">
            <el-input
              v-model="meal.time"
              placeholder="例如：08:30"
              @blur="meal.time = normalizeMomentTime(meal.time)"
            />
          </el-form-item>
          <PageCopyField v-model="meal.name" label="名稱" hint="envMealName" :fonts="ENV_FONTS" />
          <PageCopyField v-model="meal.note" label="小字" hint="envMealNote" :fonts="ENV_FONTS" />
          <PageCopyField v-model="meal.text" label="說明" hint="envMealText" :fonts="ENV_FONTS" multiline />
        </div>
      </div>

      <h3 id="section-env-tour" class="sub-title" data-section-anchor tabindex="-1">04 五所校園</h3>
      <PageCopyField v-model="form.tour_title" label="五所校園的標題" hint="envTourTitle" :fonts="ENV_TITLE_FONTS" title />
      <PageCopyField v-model="form.tour_text" label="五所校園的說明" hint="envTourText" :fonts="ENV_FONTS" multiline help="場景的照片與說明在「校園探索」，這裡只改這一章的標題與段落。" />
    </el-form>
  </ContentEditor>
</template>

<style scoped>
.sub-title {
  margin: 24px 0 12px;
  font-size: var(--text-md);
  font-weight: 600;
}

.sub-sub-title {
  margin: 20px 0 10px;
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--el-text-color-regular);
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

.page-copy__list-help {
  display: block;
  margin: -4px 0 10px;
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

/* 五顆心：窄螢幕一行一顆，寬一點就排成幾顆一列 */
.env-hearts {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 0 16px;
}
</style>
