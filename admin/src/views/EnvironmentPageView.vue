<script setup lang="ts">
import { computed, onMounted } from 'vue'
import type { EditorSection } from '../composables/editorSections'
import { useContentItem } from '../composables/useContentItem'
import type { EnvironmentPagePayload } from '../api/types'
import ContentEditor from '../components/ContentEditor.vue'
import PageCopyField from '../components/PageCopyField.vue'
import PagePhotoField from '../components/PagePhotoField.vue'
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
// 便條位置與箭頭落點、太陽弧位置、結尾三張卡與營養餐點書連結寫在官網程式裡，不在這裡。
const editor = useContentItem<EnvironmentPagePayload>('environment_page', environmentPageDraft())
const form = editor.form
const neverSaved = computed(() => !editor.loading.value && !editor.loadError.value && !editor.item.value?.latest_revision)
const highlightProblem = computed(() => highlightMissing(form.value.hero_title, form.value.hero_highlight))
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

const NOTE_HELP = '貼在照片上的便條，位置依格子固定；換照片後箭頭可能沒指準照片裡的東西，存草稿後請到官網預覽確認。'
const CARE_PHOTO_HELP = '曬衣繩上的相片，各種螢幕都裁成 4:3；留空就用官網內建的照片。'

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
      <PageCopyField v-model="form.hero_title" label="首屏大標" hint="envHeroTitle" title />
      <PageCopyField v-model="form.hero_highlight" label="大標裡畫螢光的字" hint="envHighlight" help="要和大標同一行裡的字一模一樣，官網會在那幾個字下面畫螢光；留空就不畫。" />
      <p v-if="highlightProblem" class="page-copy__warn" role="status">大標裡找不到「{{ form.hero_highlight }}」（或跨了行），這樣存檔會被擋下。</p>
      <PageCopyField v-model="form.hero_lede" label="首屏介紹" hint="envHeroLede" multiline />
      <PageCopyField v-model="form.hero_notice" label="首屏提醒" hint="envHeroNotice" help="清空就不顯示。" />
      <PagePhotoField
        v-model:photo="form.hero_photo"
        v-model:alt="form.hero_photo_alt"
        label="首屏照片"
        builtin="官網內建的兩個孩子擁抱的照片"
        :builtin-src="builtinPhotoSrc(ENVIRONMENT_BUILTIN_PHOTOS.hero)"
        :previews="ENVIRONMENT_PHOTO_PREVIEWS.hero"
        help="桌機放在右欄的相片框，各種螢幕都裁成 3:2；請用寬 2000 以上的照片，重點放在中間，或在下面點選焦點。"
        :disabled="editor.readOnly.value"
      />
      <PageCopyField v-model="form.hero_caption" label="首屏照片下的一句話" hint="envHeroCaption" />

      <h3 id="section-env-chapters" class="sub-title" data-section-anchor tabindex="-1">章名</h3>
      <div data-list="chapter_names">
        <div v-for="(name, i) in form.chapter_names" :key="i" :data-list-item="i">
          <PageCopyField
            :model-value="name"
            :label="`章名第 ${i + 1} 個`"
            hint="envChapterName"
            :help="ENVIRONMENT_CHAPTER_HINTS[i]"
            @update:model-value="(value: string) => (form.chapter_names[i] = value)"
          />
        </div>
      </div>

      <h3 id="section-env-care" class="sub-title" data-section-anchor tabindex="-1">01 幼兒保育</h3>
      <PageCopyField v-model="form.care_title" label="幼兒保育的標題" hint="envCareTitle" title />
      <PageCopyField v-model="form.care_lead" label="幼兒保育的引言" hint="envCareLead" help="接在五顆心前面，結尾的冒號自己打。" />
      <h4 class="sub-sub-title">五顆心</h4>
      <div data-list="hearts" class="env-hearts">
        <div v-for="(heart, i) in form.hearts" :key="i" :data-list-item="i">
          <PageCopyField
            :model-value="heart"
            :label="`第 ${i + 1} 顆心`"
            hint="envHeart"
            @update:model-value="(value: string) => (form.hearts[i] = value)"
          />
        </div>
      </div>
      <PageCopyField v-model="form.care_text" label="幼兒保育的說明" hint="envCareText" multiline />
      <PagePhotoField
        v-model:photo="form.care_photo"
        v-model:alt="form.care_photo_alt"
        label="幼兒保育照片"
        builtin="官網內建的老師帶孩子拍手唱歌的照片"
        :builtin-src="builtinPhotoSrc(ENVIRONMENT_BUILTIN_PHOTOS.care)"
        :previews="ENVIRONMENT_PHOTO_PREVIEWS.care"
        help="橫幅，裁成 2:1；請用寬 2000 以上的照片。官網內建照片的重點在最左邊，換成自己的照片後沒設焦點就取中間，請在下面點選焦點。"
        :disabled="editor.readOnly.value"
      />
      <PageCopyField v-model="form.care_caption" label="保育照片下的一句話" hint="envCareCaption" />
      <PageCopyField v-model="form.care_photo_note" label="保育照片上的便條" hint="envCareNote" :help="NOTE_HELP" />

      <h4 class="sub-sub-title">五件照顧的小事</h4>
      <div data-list="care_items">
        <div v-for="(item, i) in form.care_items" :key="i" class="page-copy__item" :data-list-item="i">
          <p class="page-copy__item-title">第 {{ i + 1 }} 件小事</p>
          <PageCopyField v-model="item.title" label="名稱" hint="envCareItemTitle" />
          <PageCopyField v-model="item.text" label="說明" hint="envCareItemText" multiline />
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
      <PageCopyField v-model="form.spaces_title" label="校園環境的標題" hint="envSpacesTitle" title />
      <PageCopyField v-model="form.spaces_text" label="校園環境的說明" hint="envSpacesText" multiline />
      <h4 class="sub-sub-title">主打區</h4>
      <div class="page-copy__item">
        <PageCopyField v-model="form.feature.tag" data-field="feature.tag" label="主打區的標籤" hint="envFeatureTag" />
        <PageCopyField v-model="form.feature.title" data-field="feature.title" label="主打區的標題" hint="envFeatureTitle" title />
        <PageCopyField v-model="form.feature.text" data-field="feature.text" label="主打區的說明" hint="envFeatureText" multiline />
        <PageCopyField v-model="form.feature.note" data-field="feature.note" label="主打區照片上的便條" hint="envFeatureNote" :help="NOTE_HELP" />
        <PagePhotoField
          v-model:photo="form.feature.photo"
          v-model:alt="form.feature.photo_alt"
          label="主打區的照片"
          builtin="官網內建的遊樂區照片"
          :builtin-src="builtinPhotoSrc(ENVIRONMENT_BUILTIN_PHOTOS.feature)"
          :previews="ENVIRONMENT_PHOTO_PREVIEWS.feature"
          help="桌機放在左欄，各種螢幕都裁成 3:2；請用寬 2000 以上的照片，重點放在中間，或在下面點選焦點。"
          :disabled="editor.readOnly.value"
        />
      </div>
      <h4 class="sub-sub-title">小腳印走過的六個空間</h4>
      <PageCopyField v-model="form.trail_hint" label="小腳印提示" hint="envTrailHint" help="小腳印路線上方的一句手寫字。" />
      <div data-list="spaces">
        <div v-for="(space, i) in form.spaces" :key="i" class="page-copy__item" :data-list-item="i">
          <p class="page-copy__item-title">第 {{ i + 1 }} 個空間</p>
          <PageCopyField v-model="space.title" label="名稱" hint="envSpaceTitle" />
          <PageCopyField v-model="space.text" label="說明" hint="envSpaceText" multiline />
          <PageCopyField v-model="space.note" label="照片上的便條" hint="envSpaceNote" :help="NOTE_HELP" />
          <PageCopyField v-model="space.campus_label" label="照片上的校名" hint="envSpaceCampus" help="只有確定是哪一校拍的照片才填，其餘留空就不顯示校名。" />
          <PagePhotoField
            v-model:photo="space.photo"
            v-model:alt="space.photo_alt"
            label="空間照片"
            builtin="官網內建的空間照片"
            :builtin-src="builtinPhotoSrc(ENVIRONMENT_BUILTIN_PHOTOS.spaces[i]!)"
            no-focus
            help="照片依原本比例整張顯示，不裁切。"
            :disabled="editor.readOnly.value"
          />
        </div>
      </div>

      <h3 id="section-env-meals" class="sub-title" data-section-anchor tabindex="-1">03 幼兒餐點</h3>
      <PageCopyField v-model="form.meals_title" label="幼兒餐點的標題" hint="envMealsTitle" title />
      <PageCopyField v-model="form.meals_text" label="幼兒餐點的說明" hint="envMealsText" multiline />
      <PageCopyField v-model="form.meals_day_title" label="一天吃什麼的標題" hint="envMealsDayTitle" />
      <h4 class="sub-sub-title">一天的五個時段</h4>
      <p class="field-help page-copy__list-help">官網用太陽走過的一天排這五個時段，位置依序號固定，所以時間要由早到晚，不能同一時間。</p>
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
          <PageCopyField v-model="meal.name" label="名稱" hint="envMealName" />
          <PageCopyField v-model="meal.note" label="小字" hint="envMealNote" />
          <PageCopyField v-model="meal.text" label="說明" hint="envMealText" multiline />
        </div>
      </div>

      <h3 id="section-env-tour" class="sub-title" data-section-anchor tabindex="-1">04 五所校園</h3>
      <PageCopyField v-model="form.tour_title" label="五所校園的標題" hint="envTourTitle" title />
      <PageCopyField v-model="form.tour_text" label="五所校園的說明" hint="envTourText" multiline help="場景的照片與說明在「校園探索」，這裡只改這一章的標題與段落。" />
      <PageCopyField v-model="form.tour_hint" label="五所校園的提示" hint="envTourHint" />
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
