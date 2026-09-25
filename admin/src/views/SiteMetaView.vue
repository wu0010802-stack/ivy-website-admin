<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useContentItem } from '../composables/useContentItem'
import type { MediaAssetOut, SiteMetaPayload } from '../api/types'
import { mediaFileUrl } from '../api/client'
import ContentEditor from '../components/ContentEditor.vue'
import MediaPickerDialog from '../components/MediaPickerDialog.vue'
import SiteLinksEditor from '../components/SiteLinksEditor.vue'
import { DEFAULT_PRIMARY_NAV, PRIMARY_NAV_MAX } from '../composables/siteLinks'

const defaultNav = () => DEFAULT_PRIMARY_NAV.map((link) => ({ ...link }))

const editor = useContentItem<SiteMetaPayload>(
  'site_meta',
  {
    title: '',
    description: '',
    header_phone_number: '',
    header_phone_note: '',
    share_image: '',
    share_image_alt: '',
    admission_title: '',
    admission_description: '',
    allow_indexing: true,
    primary_nav: defaultNav(),
  },
  undefined,
  {
    // 還沒在後台設定過主選單的版本（沒有欄位或 null）：先帶入官網現在的內建選單。
    normalize: (payload) => ({
      ...payload,
      primary_nav: payload.primary_nav?.length
        ? payload.primary_nav.map((link) => ({ ...link, label_en: link.label_en ?? '' }))
        : defaultNav(),
    }),
  },
)
const nav = computed(() => editor.form.value.primary_nav ?? [])

const pickerVisible = ref(false)
function onPickShareImage(asset: MediaAssetOut) {
  editor.form.value.share_image = asset.id
  if (!editor.form.value.share_image_alt && asset.alt_text) editor.form.value.share_image_alt = asset.alt_text
}
const shareImageUrl = computed(() => (editor.form.value.share_image ? mediaFileUrl(editor.form.value.share_image) : ''))

onMounted(editor.load)
</script>

<template>
  <ContentEditor :editor="editor">
    <template #lead>瀏覽器分頁與搜尋結果顯示的網站名稱、社群分享圖、頁首右上角的聯絡電話與主選單。</template>

    <el-form label-position="top" :disabled="editor.readOnly.value" @submit.prevent>
      <el-form-item label="網站標題">
        <el-input v-model="editor.form.value.title" maxlength="40" show-word-limit />
        <span class="field-help">會出現在瀏覽器分頁與 Google 搜尋結果標題。</span>
      </el-form-item>
      <el-form-item label="網站描述">
        <el-input v-model="editor.form.value.description" type="textarea" :autosize="{ minRows: 2, maxRows: 4 }" maxlength="160" show-word-limit />
        <span class="field-help">搜尋結果標題下方那段摘要，建議 60 到 120 字。</span>
      </el-form-item>
      <div class="field-row">
        <el-form-item label="頁首電話">
          <el-input v-model="editor.form.value.header_phone_number" placeholder="07-000-0000" />
        </el-form-item>
        <el-form-item label="電話備註">
          <el-input v-model="editor.form.value.header_phone_note" placeholder="例如：週一至週五 9:00–17:00" />
        </el-form-item>
      </div>

      <h3 class="meta-section">社群分享圖</h3>
      <el-form-item label="分享到 LINE、Facebook 時的預覽圖">
        <div class="share">
          <img v-if="shareImageUrl" :src="shareImageUrl" alt="" class="share__img" />
          <div class="share__actions">
            <el-button size="small" @click="pickerVisible = true">{{ editor.form.value.share_image ? '更換圖片' : '從素材庫選擇' }}</el-button>
            <el-button v-if="editor.form.value.share_image" size="small" text @click="editor.form.value.share_image = ''">改回首頁大圖</el-button>
          </div>
        </div>
        <span class="field-help">建議 1200×630 的橫式 JPG。沒設定時用首頁大圖；分校頁一律用各校照片。</span>
      </el-form-item>
      <el-form-item v-if="editor.form.value.share_image" label="分享圖說明">
        <el-input v-model="editor.form.value.share_image_alt" maxlength="200" placeholder="例如：孩子在戶外遊戲場玩耍" />
      </el-form-item>

      <h3 class="meta-section">入學資訊頁的搜尋結果</h3>
      <el-form-item label="標題">
        <el-input v-model="editor.form.value.admission_title" maxlength="120" show-word-limit placeholder="留空使用預設：入學資訊｜入學流程、新生須知、收退費與分班｜常春藤教育機構" />
      </el-form-item>
      <el-form-item label="描述">
        <el-input v-model="editor.form.value.admission_description" type="textarea" :autosize="{ minRows: 2, maxRows: 4 }" maxlength="300" show-word-limit placeholder="留空使用預設描述" />
      </el-form-item>

      <h3 class="meta-section">搜尋引擎</h3>
      <el-form-item>
        <el-switch v-model="editor.form.value.allow_indexing" active-text="允許 Google 等搜尋引擎收錄官網" />
        <span class="field-help">關閉後各頁都會告訴搜尋引擎不要收錄。正式站是否開放收錄另由部署設定決定，這裡只能關、不能強制打開。</span>
      </el-form-item>

      <h3 class="meta-section">主選單</h3>
      <p class="field-help">
        頁首與選單面板的連結，依這裡的順序排列，最多 {{ PRIMARY_NAV_MAX }} 個。站內頁面用 / 開頭的路徑（例如 /admission、/#about）；外部網站官網會加 ↗ 並另開分頁。
      </p>
      <SiteLinksEditor :links="nav" with-english :min="1" :max="PRIMARY_NAV_MAX" :read-only="editor.readOnly.value" item-name="選單項目" />

      <h3 class="meta-section">品牌名稱與 Logo</h3>
      <p class="field-help">
        品牌名稱「常春藤教育機構」與 Logo 使用只含這幾個字的專用字型檔，改字會讓頁首退回系統字、版面走樣，所以不開放在後台修改。需要更換時請聯絡網站維護人員重新製作字型與圖檔。
      </p>
    </el-form>
    <MediaPickerDialog v-model="pickerVisible" @select="onPickShareImage" />
  </ContentEditor>
</template>

<style scoped>
.meta-section { margin: 24px 0 8px; font-size: 15px; }
.share { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.share__img { width: 240px; aspect-ratio: 1200 / 630; object-fit: cover; border-radius: var(--radius); border: 1px solid var(--line); }
.share__actions { display: flex; gap: 8px; }
</style>
