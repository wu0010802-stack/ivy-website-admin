<script setup lang="ts">
import { computed, onMounted, useId, useTemplateRef } from 'vue'
import { ArrowRight, Delete, Plus } from '@element-plus/icons-vue'
import { useContentItem } from '../composables/useContentItem'
import { DAY_MOMENT_TINTS, type DayExperiencePayload, type DayMomentPayload, type MediaAssetOut } from '../api/types'
import ContentEditor from '../components/ContentEditor.vue'
import { vReadonlyValues } from '../composables/readonlyValues'
import LengthHint from '../components/LengthHint.vue'
import GlyphHint from '../components/GlyphHint.vue'
import MediaSlotField from '../components/MediaSlotField.vue'
import { momentTimeError, normalizeMomentTime } from '../composables/contentHints'
import { altAfterPick, BUILTIN_PHOTO } from '../composables/mediaThumbs'
import { moveKeepingFocus } from '../composables/moveKeepingFocus'
import { revealListItem, useCollapsibleItems } from '../composables/newsContent'

const MAX_MOMENTS = 12

// 官網既有的相紙色票（不能輸入 CSS）。
const TINT_LABELS: Record<string, string> = { yellow: '暖黃', mint: '薄荷綠', peach: '蜜桃', cream: '米白' }
// 原型六張卡的內建照片，預覽用（新增的卡片沒有內建照片）。
const BUILTIN_PHOTOS: Record<string, string> = {
  hello: 'day-hello',
  discover: 'day-discover',
  lunch: 'day-lunch',
  rest: 'classroom',
  outside: 'day-outside',
  home: 'day-home',
}

function newMoment(): DayMomentPayload {
  return {
    key: `moment-${Date.now()}`,
    time: '',
    label: '',
    // 照片補充字：官網不顯示、後台不列，後端仍是必填欄位，新卡片存空字串。
    caption: '',
    title: '',
    story: '',
    question: '',
    answer: '',
    photo: null,
    alt: '',
    tint: null,
  }
}

const editor = useContentItem<DayExperiencePayload>(
  'day_experience',
  {
    eyebrow: '',
    eyebrow_en: '',
    note: '',
    source_note: '',
    moments: [newMoment()],
    film_desktop: null,
    film_mobile: null,
    film_poster: null,
    film_caption_zh: null,
    film_caption_en: null,
  },
  undefined,
  {
    // 2026-09-25 以前的卡片沒有照片、圖片說明與色調欄位：補成「沿用內建」，比對變更時才不會多列。
    normalize: (payload) => ({
      ...payload,
      moments: payload.moments.map((m) => ({ ...m, photo: m.photo ?? null, alt: m.alt ?? '', tint: m.tint ?? null })),
    }),
  },
)

function builtinPhoto(moment: DayMomentPayload): string {
  const name = BUILTIN_PHOTOS[moment.key]
  return name ? `/assets/${name}.webp` : ''
}

// 帶入素材庫的說明；換成另一張時換成新照片的說明（沒填就清空），不留舊照片的。
// 原有六張卡沒選照片時官網顯示原本的照片，說明欄打的字描述的是那張，選了素材庫
// 的照片也要換掉；新增的卡片沒有內建照片，先打好的說明才留給這次選的照片。
// 改回官網內建時清掉說明（官網改用原本照片的說明），不讓拿掉的照片的說明留著。
function onPickMomentPhoto(moment: DayMomentPayload, asset: MediaAssetOut, previousId: string | null) {
  moment.alt = altAfterPick(moment.alt, previousId ?? (builtinPhoto(moment) ? BUILTIN_PHOTO : null), asset)
}

// 影片說明：null＝沿用官網內建；打開「自訂」時先帶入內建文字再改，關掉就改回 null。
// 關掉時把自訂的文字記在這個畫面裡，再打開就還原（誤關不用重打），離開頁面就不記了。
const BUILTIN_CAPTION = { zh: '義華校 · 遊藝表演', en: 'LITTLE MOMENTS, BIG GROWTH.' }
let rememberedCaption: { zh: string; en: string | null } | null = null
function toggleCaption(on: boolean) {
  const form = editor.form.value
  if (on) {
    const restore = rememberedCaption ?? BUILTIN_CAPTION
    form.film_caption_zh = restore.zh
    form.film_caption_en = restore.en
    rememberedCaption = null
    return
  }
  if (form.film_caption_zh != null) rememberedCaption = { zh: form.film_caption_zh, en: form.film_caption_en ?? null }
  form.film_caption_zh = null
  form.film_caption_en = null
}

const momentsList = useTemplateRef<HTMLElement>('momentsList')

// 每張卡十個欄位，六張全部攤開頁面要捲好幾屏：預設收合成「時間・時段名稱」一行。
// 新增的、存檔錯誤指到的會自動展開（revealListItem／revealContentPath）。
const collapse = useCollapsibleItems()
const uid = useId()
const allMomentsOpen = computed(() => editor.form.value.moments.every((m) => collapse.isOpen(m.key)))

// 新卡片加在最後（官網照這裡的順序），加完捲過去並聚焦時間欄；要插到中間用上移。
function addMoment() {
  editor.form.value.moments.push(newMoment())
  void revealListItem(momentsList.value, `[data-list-item="${editor.form.value.moments.length - 1}"]`)
}

function removeMoment(index: number) {
  editor.form.value.moments.splice(index, 1)
}

function moveMoment(index: number, delta: number) {
  void moveKeepingFocus(editor.form.value.moments, index, delta, momentsList.value)
}

function momentName(moment: DayMomentPayload, index: number): string {
  return [moment.time, moment.label].filter(Boolean).join('・') || `第 ${index + 1} 張`
}

onMounted(editor.load)
</script>

<template>
  <ContentEditor :editor="editor">
    <template #lead>
      首頁「孩子的一天」的文字、背景影片與卡片。卡片的張數、順序照這裡顯示，刪掉的卡片官網也會拿掉。
      照片、影片沒選的沿用官網內建：原有的六張用原本的照片，<strong>新增的卡片沒選照片時以空白相紙顯示</strong>。
    </template>

    <el-form v-readonly-values="editor.readOnly.value" label-position="top" :disabled="editor.readOnly.value" @submit.prevent>
      <div class="field-row">
        <el-form-item label="小標（中文）">
          <el-input v-model="editor.form.value.eyebrow" placeholder="例如：孩子的一天" />
        </el-form-item>
        <el-form-item label="小標（英文）">
          <el-input v-model="editor.form.value.eyebrow_en" placeholder="A DAY AT IVY" />
        </el-form-item>
      </div>
      <el-form-item label="說明文字">
        <el-input v-model="editor.form.value.note" type="textarea" :autosize="{ minRows: 1, maxRows: 4 }" />
      </el-form-item>
      <!-- 影片來源標註（source_note）是原型程式註解抽成的欄位，官網從來沒有顯示；區塊的來源說明
           就是上面的「說明文字」。2026-09-29 查證後比照照片補充字：後台不列，舊值照原樣存回。 -->

      <h3 class="form-section">背景影片</h3>
      <p class="field-help">影片靜音循環、當作背景，沒有字幕。手機版影片沒選時用桌機那支；影片封面是影片載入前看到的畫面。</p>
      <el-form-item label="桌機影片">
        <MediaSlotField v-model="editor.form.value.film_desktop" kind="video" builtin="官網內建的遊藝表演影片" :disabled="editor.readOnly.value" />
      </el-form-item>
      <el-form-item label="手機影片（選填）">
        <MediaSlotField v-model="editor.form.value.film_mobile" kind="video" builtin="桌機影片（沒選桌機影片時是內建的手機版）" :disabled="editor.readOnly.value" />
      </el-form-item>
      <el-form-item label="影片封面">
        <MediaSlotField
          v-model="editor.form.value.film_poster"
          builtin="官網內建的影片畫面"
          builtin-src="/assets/day-poster.webp"
          :focus-previews="[{ label: '桌機', ratio: '16 / 9' }, { label: '手機', ratio: '9 / 16' }]"
          :disabled="editor.readOnly.value"
        />
      </el-form-item>
      <el-form-item label="影片左下角的說明">
        <el-switch
          :model-value="editor.form.value.film_caption_zh != null"
          active-text="自訂（關閉時沿用官網內建：義華校 · 遊藝表演）"
          aria-label="自訂影片左下角的說明"
          @update:model-value="toggleCaption(Boolean($event))"
        />
      </el-form-item>
      <div v-if="editor.form.value.film_caption_zh != null" class="field-row">
        <el-form-item label="中文說明">
          <el-input v-model="editor.form.value.film_caption_zh" maxlength="40" show-word-limit placeholder="例如：明華校 · 運動會" />
        </el-form-item>
        <el-form-item label="英文說明">
          <el-input :model-value="editor.form.value.film_caption_en ?? ''" maxlength="60" show-word-limit placeholder="LITTLE MOMENTS, BIG GROWTH." @update:model-value="editor.form.value.film_caption_en = $event" />
        </el-form-item>
      </div>

      <div class="section__title" style="margin-top: 20px">
        <h2>時刻卡</h2>
        <span class="hint">{{ editor.form.value.moments.length }} / {{ MAX_MOMENTS }} 張</span>
      </div>

      <p class="field-help moments-lead">
        官網照這裡的順序排列，可以用上移、下移調整。時間用 24 小時制（例如 08:05），官網依時間調整背景影片的光線。新增的卡片沒選色調時，依位置輪流套用內建的色調，調整順序後顏色可能跟著換。
      </p>
      <el-button
        v-if="editor.form.value.moments.length > 1"
        text
        size="small"
        class="moments-toggle-all"
        @click="collapse.setMany(editor.form.value.moments.map((m) => m.key), !allMomentsOpen)"
      >
        {{ allMomentsOpen ? '全部收合' : '全部展開' }}
      </el-button>
      <div ref="momentsList" data-list="moments">
      <div
        v-for="(moment, index) in editor.form.value.moments"
        :key="moment.key"
        class="repeat-item"
        :class="{ 'is-collapsed': !collapse.isOpen(moment.key) }"
        :data-list-item="index"
        @list-item-reveal="collapse.expand(moment.key)"
      >
        <div class="repeat-item__head">
          <button
            type="button"
            class="repeat-item__index repeat-item__toggle"
            :aria-expanded="collapse.isOpen(moment.key)"
            :aria-controls="`${uid}-moment-${moment.key}`"
            @click="collapse.toggle(moment.key)"
          >
            <el-icon class="repeat-item__caret" aria-hidden="true"><ArrowRight /></el-icon>
            <b>{{ index + 1 }}</b>
            {{ moment.time || '時間未填' }}{{ moment.label ? `・${moment.label}` : '' }}{{ moment.title ? `・${moment.title}` : '' }}
          </button>
          <span v-if="!editor.readOnly.value" class="moment-actions">
            <el-button text size="small" :disabled="index === 0" :data-move-row="index" data-move-dir="-1" :aria-label="`上移「${momentName(moment, index)}」`" @click="moveMoment(index, -1)">上移</el-button>
            <el-button text size="small" :disabled="index === editor.form.value.moments.length - 1" :data-move-row="index" data-move-dir="1" :aria-label="`下移「${momentName(moment, index)}」`" @click="moveMoment(index, 1)">下移</el-button>
            <el-button
              text
              size="small"
              type="danger"
              :icon="Delete"
              :disabled="editor.form.value.moments.length <= 1"
              @click="removeMoment(index)"
            >
              移除
            </el-button>
          </span>
        </div>
        <div v-show="collapse.isOpen(moment.key)" :id="`${uid}-moment-${moment.key}`">
        <div class="field-row">
          <el-form-item label="時間（24 小時制）" :error="momentTimeError(moment.time)">
            <el-input v-model="moment.time" placeholder="例如：08:00" @blur="moment.time = normalizeMomentTime(moment.time)" />
          </el-form-item>
          <el-form-item label="時段名稱">
            <el-input v-model="moment.label" placeholder="例如：早晨" />
          </el-form-item>
        </div>
        <!-- 照片補充字（caption）2026-09-22 起官網刻意不顯示（DESIGN.md），2026-09-29 業主同意
             後台不再列這一欄；舊內容的值留在表單裡照原樣存回，不清掉。 -->
        <el-form-item label="拍立得標題">
          <el-input v-model="moment.title" />
          <LengthHint :value="moment.title" rule="momentTitle" />
          <GlyphHint :value="moment.title" />
        </el-form-item>
        <el-form-item label="翻面後的故事">
          <el-input v-model="moment.story" type="textarea" :autosize="{ minRows: 2, maxRows: 6 }" />
          <LengthHint :value="moment.story" rule="momentStory" />
        </el-form-item>
        <div class="field-row">
          <el-form-item label="照片">
            <MediaSlotField
              v-model="moment.photo"
              :builtin="builtinPhoto(moment) ? '原本的照片' : '空白相紙（沒有照片）'"
              :builtin-src="builtinPhoto(moment)"
              :focus-previews="[{ label: '拍立得', ratio: '1 / 1' }]"
              :disabled="editor.readOnly.value"
              @picked="(asset: MediaAssetOut, previousId: string | null) => onPickMomentPhoto(moment, asset, previousId)"
              @cleared="moment.alt = ''"
            />
          </el-form-item>
          <div>
            <el-form-item label="圖片說明（給看不到照片的人）">
              <el-input v-model="moment.alt" data-keep-placeholder type="textarea" :autosize="{ minRows: 1, maxRows: 4 }" maxlength="200" placeholder="留空時用原本的說明或素材庫的說明" />
            </el-form-item>
            <el-form-item label="相紙色調">
              <el-select
                :model-value="moment.tint ?? ''"
                placeholder="沿用原本的色調"
                @update:model-value="moment.tint = ($event || null) as DayMomentPayload['tint']"
              >
                <el-option label="沿用原本的色調" value="" />
                <el-option v-for="tint in DAY_MOMENT_TINTS" :key="tint" :label="TINT_LABELS[tint]" :value="tint" />
              </el-select>
            </el-form-item>
          </div>
        </div>
        <div class="field-row">
          <el-form-item label="家長常問">
            <el-input v-model="moment.question" />
          </el-form-item>
          <el-form-item label="我們的回答">
            <el-input v-model="moment.answer" type="textarea" :autosize="{ minRows: 1, maxRows: 4 }" />
          </el-form-item>
        </div>
        </div>
      </div>
      </div>

      <el-button :icon="Plus" :disabled="editor.form.value.moments.length >= MAX_MOMENTS" @click="addMoment">
        新增一張時刻卡
      </el-button>
    </el-form>
  </ContentEditor>
</template>

<style scoped>
.moments-lead {
  margin: 0 0 12px;
}

.moment-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.moment-actions .el-button + .el-button {
  margin-left: 0;
}

.moments-toggle-all {
  margin-bottom: 8px;
}

.form-section {
  margin: 20px 0 8px;
  padding-top: 16px;
  border-top: 1px solid var(--line);
  color: var(--ink-2);
}
</style>
