<script setup lang="ts">
import { computed, ref, useTemplateRef } from 'vue'
import { useContentItem } from '../composables/useContentItem'
import { useCampusContent } from '../composables/useCampusContent'
import type { CampusProfilePayload, FocusPointPayload, MediaAssetOut } from '../api/types'
import { mediaFocusUrl } from '../api/client'
import ContentEditor from '../components/ContentEditor.vue'
import LengthHint from '../components/LengthHint.vue'
import CampusSelect from '../components/CampusSelect.vue'
import GlyphHint from '../components/GlyphHint.vue'
import MediaSlotField from '../components/MediaSlotField.vue'
import FocusPicker from '../components/FocusPicker.vue'
import { addressSearchUrl, mapUrlError } from '../composables/siteLinks'

const campus = ref('')
const editor = useContentItem<CampusProfilePayload>(
  'campus_profile',
  {
    name: '',
    district: '',
    address: '',
    phone: '',
    intro: '',
    description: '',
    facebook: '',
    fb_note: '',
    line: '',
    map_url: '',
    cover: null,
    card_focus: null,
    hero_focus: null,
    line_art: null,
    line_art_colour: null,
  },
  campus,
)

// 官網內建的五校封面（沒換封面時也能只調兩個版位的焦點）。
const BUILTIN_COVERS: Record<string, string> = {
  yihua: 'yihua-exterior-enhanced-v1',
  minghua: 'minghua-enhanced-v1',
  chongde: 'chongde-enhanced-v1',
  international: 'international-enhanced-v1',
  renwu: 'renwu-enhanced-v1',
}
const builtinCover = computed(() => (BUILTIN_COVERS[campus.value] ? `/assets/${BUILTIN_COVERS[campus.value]}.webp` : ''))
const builtinLineArt = computed(() => (campus.value ? `/assets/campus-line-art-${campus.value}.webp` : ''))
const builtinLineArtColour = computed(() => (campus.value ? `/assets/campus-line-art-${campus.value}-colour.webp` : ''))
// 封面版位目前的素材（MediaSlotField 載入後回報；換封面、切校區時跟著換）。
const coverAsset = ref<MediaAssetOut | null>(null)
const currentCoverAsset = computed(() => {
  const cover = editor.form.value.cover
  return cover && coverAsset.value?.id === cover.media_id ? coverAsset.value : null
})
// 點焦點用的封面（換了封面用素材的縮圖——舊縮圖沒依拍攝方向轉正時用原檔；沒換用內建照片）。
// 換了封面、素材還在載入時先不顯示，免得在另一張照片上點。
const coverSrc = computed(() => {
  if (!editor.form.value.cover) return builtinCover.value
  return currentCoverAsset.value ? mediaFocusUrl(currentCoverAsset.value) : ''
})
// 版位焦點沒設時官網實際用的位置：沒換封面＝內建位置（web fixture 的 panoramaPos／
// heroPhotoPos，沒有就是元件預設）；換了封面＝封面設定的焦點，再來是素材庫設定的
// 素材預設焦點（官網 slotPosition 的順序），都沒有才是元件預設。
const BUILTIN_CARD_FOCUS: Record<string, FocusPointPayload> = { yihua: { x: 50, y: 12 } }
const BUILTIN_HERO_FOCUS: Record<string, FocusPointPayload> = { yihua: { x: 85, y: 8 } }
const CARD_DEFAULT: FocusPointPayload = { x: 50, y: 55 }
const HERO_DEFAULT: FocusPointPayload = { x: 50, y: 50 }
const coverFocus = computed<FocusPointPayload | null>(() => {
  const cover = editor.form.value.cover
  return cover && cover.focus_x != null && cover.focus_y != null ? { x: cover.focus_x, y: cover.focus_y } : null
})
const assetFocus = computed<FocusPointPayload | null>(() => {
  const a = currentCoverAsset.value
  return a && a.crop_focus_x != null && a.crop_focus_y != null
    ? { x: Math.round(a.crop_focus_x * 100), y: Math.round(a.crop_focus_y * 100) }
    : null
})
const cardFallback = computed(() =>
  editor.form.value.cover
    ? (coverFocus.value ?? assetFocus.value ?? CARD_DEFAULT)
    : (BUILTIN_CARD_FOCUS[campus.value] ?? CARD_DEFAULT),
)
const heroFallback = computed(() =>
  editor.form.value.cover
    ? (coverFocus.value ?? assetFocus.value ?? HERO_DEFAULT)
    : (BUILTIN_HERO_FOCUS[campus.value] ?? HERO_DEFAULT),
)
const fallbackLabel = computed(() => (editor.form.value.cover ? '預設位置（封面或素材的焦點）' : '官網原本的位置'))

const shell = useTemplateRef<InstanceType<typeof ContentEditor>>('shell')
const { visibleCampusKeys } = useCampusContent(editor, campus, shell)
// 「開啟看看」：填了地圖網址就開它，沒填開官網會用的地址搜尋。
const mapPreviewUrl = computed(() => {
  const form = editor.form.value
  if (form.map_url.trim()) return mapUrlError(form.map_url) ? '' : form.map_url.trim()
  return form.address.trim() ? addressSearchUrl(form.address) : ''
})
</script>

<template>
  <ContentEditor
    ref="shell"
    :editor="editor"
    :placeholder="visibleCampusKeys.length === 0 ? '你的帳號沒有可編輯的校區。' : undefined"
  >
    <template #lead>各校在首頁五校區塊、分校頁與頁尾顯示的基本資料。留空的社群連結官網會顯示「待補」。</template>
    <template #toolbar>
      <CampusSelect v-model="campus" :keys="visibleCampusKeys" />
    </template>

    <el-form label-position="top" :disabled="editor.readOnly.value" @submit.prevent>
      <div class="field-row">
        <el-form-item label="校名">
          <el-input v-model="editor.form.value.name" placeholder="例如：義華校" />
          <!-- 首頁五校與分校頁大標用明體子集，分校頁「來認識…」小標用標題字型。 -->
          <GlyphHint :value="editor.form.value.name" :fonts="['serif', 'bd']" />
        </el-form-item>
        <el-form-item label="行政區">
          <el-input v-model="editor.form.value.district" placeholder="例如：鳳山區" />
        </el-form-item>
      </div>
      <el-form-item label="地址">
        <el-input v-model="editor.form.value.address" />
      </el-form-item>
      <el-form-item label="地圖連結（選填）" :error="mapUrlError(editor.form.value.map_url) ?? ''">
        <el-input v-model="editor.form.value.map_url" placeholder="https://maps.app.goo.gl/…" />
        <span class="field-help">
          在 Google 地圖找到學校、按「分享」複製連結貼上。留空時官網用上面的地址搜尋；地址搜尋不準時才需要填。
          <a v-if="mapPreviewUrl" :href="mapPreviewUrl" target="_blank" rel="noopener noreferrer">開啟看看 ↗</a>
        </span>
      </el-form-item>
      <el-form-item label="參觀專線">
        <el-input v-model="editor.form.value.phone" placeholder="07-000-0000" />
      </el-form-item>
      <el-form-item label="一句話簡介">
        <el-input v-model="editor.form.value.intro" maxlength="40" show-word-limit />
        <!-- 分校頁「認識〇〇校」下方的大標。 -->
        <GlyphHint :value="editor.form.value.intro" />
      </el-form-item>
      <el-form-item label="詳細介紹">
        <el-input v-model="editor.form.value.description" type="textarea" :autosize="{ minRows: 4, maxRows: 12 }" />
        <LengthHint :value="editor.form.value.description" rule="campusDescription" />
      </el-form-item>

      <h3 class="form-section">封面照片與建築線稿</h3>
      <p class="field-help">沒選的沿用官網內建。封面在兩個地方裁成不同比例，可以各自點選要保留的位置；沒換封面也能只調位置。</p>
      <el-form-item label="封面照片">
        <MediaSlotField
          v-model="editor.form.value.cover"
          :campus-key="campus"
          builtin="官網內建的校園外觀照"
          @asset="coverAsset = $event"
          :builtin-src="builtinCover"
          :focus="false"
          :disabled="editor.readOnly.value"
        />
      </el-form-item>
      <div class="field-row">
        <el-form-item label="首頁五校卡片、預約頁的裁切焦點">
          <FocusPicker
            v-if="coverSrc"
            v-model="editor.form.value.card_focus"
            :src="coverSrc"
            :fallback="cardFallback"
            :fallback-label="fallbackLabel"
            label="首頁五校卡片的裁切焦點"
            reset-label="改回預設位置"
            :previews="[{ label: '首頁卡片', ratio: '16 / 9' }, { label: '預約頁', ratio: '4 / 3' }]"
            :disabled="editor.readOnly.value"
          />
        </el-form-item>
        <el-form-item label="分校頁首屏的裁切焦點">
          <FocusPicker
            v-if="coverSrc"
            v-model="editor.form.value.hero_focus"
            :src="coverSrc"
            :fallback="heroFallback"
            :fallback-label="fallbackLabel"
            label="分校頁首屏的裁切焦點"
            reset-label="改回預設位置"
            :previews="[{ label: '桌機', ratio: '21 / 9' }, { label: '手機', ratio: '3 / 4' }]"
            :disabled="editor.readOnly.value"
          />
        </el-form-item>
      </div>
      <div class="field-row">
        <el-form-item label="建築線稿">
          <MediaSlotField
            v-model="editor.form.value.line_art"
            :campus-key="campus"
            builtin="官網內建的線稿"
            :builtin-src="builtinLineArt"
            :focus="false"
            :disabled="editor.readOnly.value"
          />
          <span class="field-help">首頁五校分頁上的小插圖，建議去背 PNG 或白底、橫式 3:2。</span>
        </el-form-item>
        <el-form-item label="建築線稿（上色版）">
          <MediaSlotField
            v-model="editor.form.value.line_art_colour"
            :campus-key="campus"
            builtin="上面的線稿（換了線稿時）或內建的上色版"
            :builtin-src="editor.form.value.line_art ? '' : builtinLineArtColour"
            :focus="false"
            :disabled="editor.readOnly.value"
          />
          <span class="field-help">選到這一校時疊上去的彩色版；沒選時用上面的線稿。</span>
        </el-form-item>
      </div>

      <h3 class="form-section">社群</h3>
      <el-form-item label="Facebook 粉絲專頁網址">
        <el-input v-model="editor.form.value.facebook" placeholder="https://www.facebook.com/…" />
      </el-form-item>
      <el-form-item label="Facebook 備註">
        <el-input v-model="editor.form.value.fb_note" placeholder="例如：活動照片與公告" />
      </el-form-item>
      <el-form-item label="LINE 官方帳號網址">
        <el-input v-model="editor.form.value.line" placeholder="https://lin.ee/…" />
        <span class="field-help">留空代表這一校尚未提供，官網會顯示待補，不會帶入其他校的帳號。</span>
      </el-form-item>
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
</style>
