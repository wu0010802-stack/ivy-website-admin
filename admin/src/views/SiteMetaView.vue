<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useContentItem } from '../composables/useContentItem'
import { legacyCopyHint } from '../composables/contentHints'
import type { MediaAssetOut, SiteMetaPayload } from '../api/types'
import { altAfterPick, BUILTIN_PHOTO } from '../composables/mediaThumbs'
import ContentEditor from '../components/ContentEditor.vue'
import { vReadonlyValues } from '../composables/readonlyValues'
import MediaRefField from '../components/MediaRefField.vue'
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

// 換成另一張時換成新照片在素材庫的說明（沒填就清空），不留舊照片的說明。說明欄
// 只在設了分享圖時出現，沒設時留著的字是舊版本改回首頁大圖後留下的，一樣換掉。
function onPickShareImage(asset: MediaAssetOut, previousId: string | null) {
  const form = editor.form.value
  form.share_image_alt = altAfterPick(form.share_image_alt, previousId ?? BUILTIN_PHOTO, asset)
}

onMounted(editor.load)
</script>

<template>
  <ContentEditor :editor="editor">
    <template #lead>瀏覽器分頁與搜尋結果顯示的網站名稱、社群分享圖、頁首右上角的聯絡電話與主選單。</template>

    <el-form v-readonly-values="editor.readOnly.value" label-position="top" :disabled="editor.readOnly.value" @submit.prevent>
      <el-form-item label="網站標題">
        <el-input v-model="editor.form.value.title" maxlength="40" show-word-limit />
        <span class="field-help">會出現在瀏覽器分頁與 Google 搜尋結果標題。</span>
      </el-form-item>
      <el-form-item label="網站描述">
        <el-input v-model="editor.form.value.description" type="textarea" :autosize="{ minRows: 2, maxRows: 4 }" maxlength="160" show-word-limit />
        <span class="field-help">搜尋結果標題下方那段摘要，建議 60 到 120 字。</span>
        <p v-if="legacyCopyHint('siteDescription', editor.form.value.description)" class="legacy-hint">{{ legacyCopyHint('siteDescription', editor.form.value.description) }}</p>
      </el-form-item>
      <div class="field-row">
        <el-form-item label="頁首電話">
          <el-input v-model="editor.form.value.header_phone_number" inputmode="tel" placeholder="07-000-0000" />
        </el-form-item>
        <el-form-item label="電話備註">
          <el-input v-model="editor.form.value.header_phone_note" placeholder="例如：週一至週五 9:00–17:00" />
        </el-form-item>
      </div>

      <h3 class="meta-section">社群分享圖</h3>
      <el-form-item label="分享到 LINE、Facebook 時的預覽圖">
        <MediaRefField
          v-model="editor.form.value.share_image"
          noun="圖片"
          builtin="首頁大圖"
          clear-label="改回首頁大圖"
          ratio="1200 / 630"
          :disabled="editor.readOnly.value"
          @picked="onPickShareImage"
          @cleared="editor.form.value.share_image_alt = ''"
        >
          <template #hint><span class="field-help">建議 1200×630 的橫式 JPG。沒設定時用首頁大圖。</span></template>
        </MediaRefField>
      </el-form-item>
      <el-form-item v-if="editor.form.value.share_image" label="分享圖說明">
        <el-input v-model="editor.form.value.share_image_alt" type="textarea" :autosize="{ minRows: 1, maxRows: 4 }" maxlength="200" placeholder="例如：孩子在戶外遊戲場玩耍" />
        <span class="field-help">描述照片裡看得到的內容；換照片時會換成素材庫裡新照片的說明。</span>
      </el-form-item>

      <h3 class="meta-section">入學資訊頁的搜尋結果</h3>
      <el-form-item label="標題">
        <el-input v-model="editor.form.value.admission_title" data-keep-placeholder type="textarea" :autosize="{ minRows: 1, maxRows: 4 }" maxlength="120" show-word-limit placeholder="留空使用預設：入學資訊｜入學流程、新生須知、收退費與分班｜常春藤教育機構" />
      </el-form-item>
      <el-form-item label="描述">
        <el-input v-model="editor.form.value.admission_description" data-keep-placeholder type="textarea" :autosize="{ minRows: 2, maxRows: 4 }" maxlength="300" show-word-limit placeholder="留空使用預設描述" />
      </el-form-item>

      <h3 class="meta-section">搜尋引擎</h3>
      <el-form-item>
        <el-switch v-model="editor.form.value.allow_indexing" active-text="允許 Google 等搜尋引擎收錄官網" aria-label="允許 Google 等搜尋引擎收錄官網" />
        <span class="field-help">發布後生效。關閉後，官網每一頁都會告訴搜尋引擎不要收錄。網站維護人員也可以從主機另外關閉收錄；那邊關閉時，這裡打開也不會生效。</span>
      </el-form-item>

      <h3 class="meta-section">主選單</h3>
      <p class="field-help">
        頁首與選單面板的連結，依這裡的順序排列，最多 {{ PRIMARY_NAV_MAX }} 個。
      </p>
      <SiteLinksEditor :links="nav" with-english :min="1" :max="PRIMARY_NAV_MAX" :read-only="editor.readOnly.value" item-name="選單項目" />

      <h3 class="meta-section">品牌名稱與 Logo</h3>
      <p class="field-help">
        品牌名稱「常春藤教育機構」與 Logo 使用只含這幾個字的專用字型檔，改字會讓頁首退回系統字、版面走樣，所以不開放在後台修改。需要更換時請聯絡網站維護人員重新製作字型與圖檔。
      </p>
    </el-form>
  </ContentEditor>
</template>

<style scoped>
/* 原型原文提示：官網顯示的和這裡不同，改了之後才會照這裡顯示。 */
.legacy-hint {
  margin: 6px 0 0;
  font-size: var(--text-xs);
  line-height: 1.6;
  color: var(--el-color-warning-dark-2);
}

.meta-section { margin: 24px 0 8px; font-size: var(--text-md); }
</style>
