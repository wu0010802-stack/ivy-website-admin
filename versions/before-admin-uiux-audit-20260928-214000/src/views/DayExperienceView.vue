<script setup lang="ts">
import { onMounted } from 'vue'
import { Delete, Plus } from '@element-plus/icons-vue'
import { useContentItem } from '../composables/useContentItem'
import { DAY_MOMENT_TINTS, type DayExperiencePayload, type DayMomentPayload, type MediaAssetOut } from '../api/types'
import ContentEditor from '../components/ContentEditor.vue'
import LengthHint from '../components/LengthHint.vue'
import GlyphHint from '../components/GlyphHint.vue'
import MediaSlotField from '../components/MediaSlotField.vue'

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
    // 2026-09-25 以前的卡片沒有照片、替代文字與色調欄位：補成「沿用內建」，比對變更時才不會多列。
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

function onPickMomentPhoto(moment: DayMomentPayload, asset: MediaAssetOut) {
  if (!moment.alt && asset.alt_text) moment.alt = asset.alt_text
}

// 影片說明：null＝沿用官網內建；打開「自訂」時先帶入內建文字再改，關掉就改回 null。
const BUILTIN_CAPTION = { zh: '義華校 · 遊藝表演', en: 'LITTLE MOMENTS, BIG GROWTH.' }
function toggleCaption(on: boolean) {
  editor.form.value.film_caption_zh = on ? BUILTIN_CAPTION.zh : null
  editor.form.value.film_caption_en = on ? BUILTIN_CAPTION.en : null
}

function addMoment() {
  editor.form.value.moments.push(newMoment())
}

function removeMoment(index: number) {
  editor.form.value.moments.splice(index, 1)
}

onMounted(editor.load)
</script>

<template>
  <ContentEditor :editor="editor">
    <template #lead>
      首頁「孩子的一天」的文字、背景影片與卡片。卡片的張數、順序照這裡顯示，刪掉的卡片官網也會拿掉。
      照片、影片沒選的沿用官網內建：原有的六張用原本的照片，<strong>新增的卡片沒選照片時以空白相紙顯示</strong>。
    </template>

    <el-form label-position="top" :disabled="editor.readOnly.value" @submit.prevent>
      <div class="field-row">
        <el-form-item label="小標（中文）">
          <el-input v-model="editor.form.value.eyebrow" placeholder="例如：孩子的一天" />
        </el-form-item>
        <el-form-item label="小標（英文）">
          <el-input v-model="editor.form.value.eyebrow_en" placeholder="A DAY AT IVY" />
        </el-form-item>
      </div>
      <el-form-item label="說明文字">
        <el-input v-model="editor.form.value.note" />
      </el-form-item>
      <el-form-item label="影片來源標註">
        <el-input v-model="editor.form.value.source_note" placeholder="例如：影片攝於義華校，2026 春" />
      </el-form-item>

      <h3 class="form-section">背景影片</h3>
      <p class="field-help">影片靜音循環、當作背景，沒有字幕。手機版影片沒選時用桌機那支；poster 是影片載入前看到的畫面。</p>
      <el-form-item label="桌機影片">
        <MediaSlotField v-model="editor.form.value.film_desktop" kind="video" builtin="官網內建的遊藝表演影片" :disabled="editor.readOnly.value" />
      </el-form-item>
      <el-form-item label="手機影片（選填）">
        <MediaSlotField v-model="editor.form.value.film_mobile" kind="video" builtin="桌機影片（沒選桌機影片時是內建的手機版）" :disabled="editor.readOnly.value" />
      </el-form-item>
      <el-form-item label="Poster">
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

      <div v-for="(moment, index) in editor.form.value.moments" :key="moment.key" class="repeat-item">
        <div class="repeat-item__head">
          <span class="repeat-item__index">
            <b>{{ index + 1 }}</b>
            {{ moment.time || '時間未填' }}{{ moment.label ? `・${moment.label}` : '' }}
          </span>
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
        </div>
        <div class="field-row">
          <el-form-item label="時間">
            <el-input v-model="moment.time" placeholder="08:00" />
          </el-form-item>
          <el-form-item label="時段名稱">
            <el-input v-model="moment.label" placeholder="例如：早晨" />
          </el-form-item>
        </div>
        <div class="field-row">
          <el-form-item label="拍立得標題">
            <el-input v-model="moment.title" />
            <LengthHint :value="moment.title" rule="momentTitle" />
            <GlyphHint :value="moment.title" />
          </el-form-item>
          <el-form-item label="拍立得說明">
            <el-input v-model="moment.caption" />
            <LengthHint :value="moment.caption" rule="momentCaption" />
          </el-form-item>
        </div>
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
              @picked="onPickMomentPhoto(moment, $event)"
            />
          </el-form-item>
          <div>
            <el-form-item label="照片替代文字">
              <el-input v-model="moment.alt" maxlength="200" placeholder="留空時用原本的說明或素材庫的說明" />
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

      <el-button :icon="Plus" :disabled="editor.form.value.moments.length >= MAX_MOMENTS" @click="addMoment">
        新增一張時刻卡
      </el-button>
    </el-form>
  </ContentEditor>
</template>

<style scoped>
.form-section {
  margin: 20px 0 8px;
  padding-top: 16px;
  border-top: 1px solid var(--line);
  color: var(--ink-2);
}
</style>
