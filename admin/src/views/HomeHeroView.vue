<script setup lang="ts">
import { onMounted } from 'vue'
import { useContentItem } from '../composables/useContentItem'
import type { HomeHeroPayload, MediaAssetOut } from '../api/types'
import ContentEditor from '../components/ContentEditor.vue'
import LengthHint from '../components/LengthHint.vue'
import GlyphHint from '../components/GlyphHint.vue'
import MediaSlotField from '../components/MediaSlotField.vue'

// 首屏按鈕 2026-09-23 已拿掉（按鈕文字不再編輯）；舊版本的 cta_label 載入時丟掉，
// 不會出現在「變更了哪些欄位」，存檔也不再送出（後端同樣忽略）。
const editor = useContentItem<HomeHeroPayload>(
  'home_hero',
  {
    eyebrow: '',
    copy_lines: ['', ''],
    video_desktop: null,
    video_mobile: null,
    poster: null,
    poster_alt: '',
    fallback_image: null,
  },
  undefined,
  {
    normalize: (payload) => {
      const { cta_label: _legacy, ...rest } = payload as HomeHeroPayload & { cta_label?: string }
      return rest
    },
  },
)

// 首屏照片滿版：桌機寬、手機直，兩種比例都看得到焦點附近。
const HERO_PREVIEWS = [
  { label: '桌機', ratio: '16 / 9' },
  { label: '手機', ratio: '9 / 16' },
]

function onPickPoster(asset: MediaAssetOut) {
  if (!editor.form.value.poster_alt && asset.alt_text) editor.form.value.poster_alt = asset.alt_text
}

onMounted(editor.load)
</script>

<template>
  <ContentEditor :editor="editor">
    <template #lead>首頁大圖（影片）旁的小標與標語。標語每行最多 24 字，建議控制在 14 字內，手機上更容易閱讀。大標題由官網設計固定，不在這裡修改。</template>

    <el-form label-position="top" :disabled="editor.readOnly.value" @submit.prevent>
      <el-form-item label="標語上方的小標">
        <el-input v-model="editor.form.value.eyebrow" placeholder="例如：高雄五校・1997 創校" />
        <LengthHint :value="editor.form.value.eyebrow" rule="heroEyebrow" />
        <GlyphHint :value="editor.form.value.eyebrow" />
      </el-form-item>
      <el-form-item v-for="(_, i) in editor.form.value.copy_lines" :key="i" :label="`標語第 ${i + 1} 行`">
        <el-input v-model="editor.form.value.copy_lines[i]" maxlength="24" show-word-limit />
      </el-form-item>

      <h3 class="form-section">影片與照片</h3>
      <p class="field-help">
        沒有選的項目官網沿用現在的內建素材。影片靜音循環播放，建議 10–20 秒、MP4（H.264）；手機版影片沒選時用桌機那支。
      </p>
      <el-form-item label="桌機影片">
        <MediaSlotField v-model="editor.form.value.video_desktop" kind="video" builtin="官網內建的校園影片" :disabled="editor.readOnly.value" />
      </el-form-item>
      <el-form-item label="手機影片（選填）">
        <MediaSlotField v-model="editor.form.value.video_mobile" kind="video" builtin="桌機影片（沒選桌機影片時是內建的手機版）" :disabled="editor.readOnly.value" />
      </el-form-item>
      <el-form-item label="Poster（影片播放前與不自動播放時的照片）">
        <MediaSlotField
          v-model="editor.form.value.poster"
          builtin="官網內建的首屏照片"
          builtin-src="/assets/hero-campus-restored-v1-still.webp"
          :focus-previews="HERO_PREVIEWS"
          :disabled="editor.readOnly.value"
          @picked="onPickPoster"
        />
        <span class="field-help">這張照片是首頁最先載入的畫面，建議橫式、寬 1920 以上，並跟影片第一個畫面接近。</span>
      </el-form-item>
      <el-form-item v-if="editor.form.value.poster" label="Poster 替代文字">
        <el-input v-model="editor.form.value.poster_alt" maxlength="200" placeholder="例如：孩子在戶外草地上奔跑、微笑" />
        <span class="field-help">給看不見畫面的家長與搜尋引擎；留空時用素材庫裡這張照片的說明。</span>
      </el-form-item>
      <el-form-item label="影片載入失敗時的替代圖（選填）">
        <MediaSlotField v-model="editor.form.value.fallback_image" builtin="Poster" :focus-previews="HERO_PREVIEWS" :disabled="editor.readOnly.value" />
      </el-form-item>
    </el-form>
  </ContentEditor>
</template>

<style scoped>
.form-section {
  margin: 16px 0 8px;
  padding-top: 16px;
  border-top: 1px solid var(--line);
  color: var(--ink-2);
}
</style>
