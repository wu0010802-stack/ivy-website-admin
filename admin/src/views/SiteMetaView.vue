<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useContentItem } from '../composables/useContentItem'
import { legacyCopyHint } from '../composables/contentHints'
import type { MediaAssetOut, SiteMetaPayload, SocialLinkPayload } from '../api/types'
import { altAfterPick, BUILTIN_PHOTO } from '../composables/mediaThumbs'
import ContentEditor from '../components/ContentEditor.vue'
import { vReadonlyValues } from '../composables/readonlyValues'
import LengthHint from '../components/LengthHint.vue'
import MediaRefField from '../components/MediaRefField.vue'
import SiteLinksEditor from '../components/SiteLinksEditor.vue'
import SocialLinksEditor from '../components/SocialLinksEditor.vue'
import { DEFAULT_PRIMARY_NAV, DEFAULT_SOCIAL_LINKS, PRIMARY_NAV_MAX, SOCIAL_LINKS_MAX } from '../composables/siteLinks'
import {
  normalizePageSeo,
  PAGE_SEO_DEFAULTS,
  PAGE_SEO_KEYS,
  PAGE_SEO_PAGES,
  pageSeoCustomised,
  type PageSeoKey,
} from '../composables/pageSeoDefaults'
import type { EditorSection } from '../composables/editorSections'

const defaultNav = () => DEFAULT_PRIMARY_NAV.map((link) => ({ ...link }))
const defaultSocials = (): SocialLinkPayload[] => DEFAULT_SOCIAL_LINKS.map((link) => ({ ...link }))

// 2026-10-12 前入學資訊頁的搜尋標題與描述是全站設定自己的兩個欄位，現在搬進 page_seo.admission。
interface LegacyAdmissionFields {
  admission_title?: unknown
  admission_description?: unknown
}

const editor = useContentItem<SiteMetaPayload>(
  'site_meta',
  {
    title: '',
    description: '',
    header_phone_number: '',
    header_phone_note: '',
    share_image: '',
    share_image_alt: '',
    allow_indexing: true,
    anniversary_enabled: true,
    primary_nav: defaultNav(),
    page_seo: normalizePageSeo(null),
    social_links: null,
  },
  undefined,
  {
    // 載入時在拍快照之前整理舊版本，畫面才不會一打開就顯示「有未儲存的修改」：
    // - 還沒在後台設定過主選單的版本（沒有欄位或 null）：先帶入官網現在的內建選單。
    // - page_seo 補成七頁都有；舊版本的入學頁欄位（admission_*）只在 page_seo.admission 對應欄位是空的時候搬進去，
    //   然後丟掉，存檔不再送出（後端同樣不再輸出）。
    // - social_links 維持 null（沿用內建）或清單；清單的每一個照固定的欄位順序整理。
    normalize: (payload) => {
      const { admission_title: legacyTitle, admission_description: legacyDescription, ...rest } = payload as SiteMetaPayload & LegacyAdmissionFields
      const pageSeo = normalizePageSeo(rest.page_seo)
      if (typeof legacyTitle === 'string' && legacyTitle.trim() && !pageSeo.admission.title.trim()) pageSeo.admission.title = legacyTitle
      if (typeof legacyDescription === 'string' && legacyDescription.trim() && !pageSeo.admission.description.trim()) pageSeo.admission.description = legacyDescription
      return {
        ...rest,
        // 2026-10-24 前的版本沒有這個欄位＝開。
        anniversary_enabled: rest.anniversary_enabled ?? true,
        primary_nav: rest.primary_nav?.length
          ? rest.primary_nav.map((link) => ({ ...link, label_en: link.label_en ?? '' }))
          : defaultNav(),
        page_seo: pageSeo,
        social_links: Array.isArray(rest.social_links)
          ? rest.social_links.map((link) => ({ platform: link.platform, label: link.label ?? '', url: link.url ?? '' }))
          : null,
      }
    },
  },
)
const nav = computed(() => editor.form.value.primary_nav ?? [])
const pageSeo = computed(() => editor.form.value.page_seo)
const socialLinks = computed(() => editor.form.value.social_links)
const builtinSocialLabels = DEFAULT_SOCIAL_LINKS.map((link) => link.label).join('、')

// 各頁搜尋與分享：目前看的是哪一頁（存檔被擋時，錯誤清單會請對應的頁籤切過來）。
const seoPage = ref<PageSeoKey>('admission')
const customisedPages = computed(() => PAGE_SEO_KEYS.filter((key) => pageSeoCustomised(pageSeo.value[key])))

// 段落目錄：每段列出它編輯的欄位，和官網不同時目錄打點。
const navSections = computed<EditorSection[]>(() => [
  { id: 'section-meta-basic', label: '網站標題與頁首電話', fields: ['title', 'description', 'header_phone_number', 'header_phone_note'] },
  { id: 'section-meta-share', label: '社群分享圖', fields: ['share_image', 'share_image_alt'] },
  {
    id: 'section-meta-seo',
    label: '各頁搜尋與分享',
    note: customisedPages.value.length ? `${customisedPages.value.length} 頁已自訂` : undefined,
    fields: ['page_seo'],
  },
  {
    id: 'section-meta-anniversary',
    label: '30 週年',
    note: editor.form.value.anniversary_enabled ? '開啟' : '關閉',
    fields: ['anniversary_enabled'],
  },
  { id: 'section-meta-index', label: '搜尋引擎', fields: ['allow_indexing'] },
  { id: 'section-meta-nav', label: '主選單', fields: ['primary_nav'] },
  {
    id: 'section-meta-social',
    label: '機構社群',
    note: socialLinks.value === null ? '沿用內建' : `${socialLinks.value.length} 個`,
    fields: ['social_links'],
  },
  { id: 'section-meta-brand', label: '品牌名稱與 Logo' },
])

// 換成另一張時換成新照片在素材庫的說明（沒填就清空），不留舊照片的說明。說明欄
// 只在設了分享圖時出現，沒設時留著的字是舊版本改回首頁大圖後留下的，一樣換掉。
function onPickShareImage(asset: MediaAssetOut, previousId: string | null) {
  const form = editor.form.value
  form.share_image_alt = altAfterPick(form.share_image_alt, previousId ?? BUILTIN_PHOTO, asset)
}

// 各頁的分享圖同理：沒選時用全站分享圖，說明欄跟著照片走。
function onPickPageShareImage(key: PageSeoKey, asset: MediaAssetOut, previousId: string | null) {
  const entry = pageSeo.value[key]
  entry.share_image_alt = altAfterPick(entry.share_image_alt, previousId ?? BUILTIN_PHOTO, asset)
}

// 機構社群：null＝沿用官網內建；「改成自訂」帶入內建清單，「恢復內建」設回 null；清單清空是 []（官網不顯示）。
function customiseSocials() {
  editor.form.value.social_links = defaultSocials()
}
function restoreSocials() {
  editor.form.value.social_links = null
}

onMounted(editor.load)
</script>

<template>
  <ContentEditor :editor="editor" :sections="navSections">
    <template #lead>瀏覽器分頁與搜尋結果顯示的網站名稱、社群分享圖、各頁的搜尋標題與分享圖、頁首右上角的聯絡電話與主選單、機構社群連結，以及 30 週年內容的開關。</template>

    <el-form v-readonly-values="editor.readOnly.value" label-position="top" :disabled="editor.readOnly.value" @submit.prevent>
      <h3 id="section-meta-basic" class="meta-section meta-section--first" data-section-anchor tabindex="-1">網站標題與頁首電話</h3>
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

      <h3 id="section-meta-share" class="meta-section" data-section-anchor tabindex="-1">社群分享圖</h3>
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

      <h3 id="section-meta-seo" class="meta-section" data-section-anchor tabindex="-1">各頁搜尋與分享</h3>
      <p class="field-help seo-lead">
        每一頁在 Google 搜尋結果、LINE 與 Facebook 分享時顯示的標題、描述和預覽圖。留空的欄位用官網內建的（欄位裡的灰色字）；分享圖沒選時用上面的社群分享圖。首頁用上面的網站標題與描述。頁籤上有綠點的，是已經填過自訂內容的頁。
      </p>
      <el-tabs v-model="seoPage" class="page-seo-tabs">
        <el-tab-pane v-for="page in PAGE_SEO_PAGES" :key="page.key" :name="page.key" @field-reveal="seoPage = page.key">
          <template #label>
            <span class="page-seo-tab">
              {{ page.label }}
              <template v-if="pageSeoCustomised(pageSeo[page.key])"><span class="page-seo-tab__dot" aria-hidden="true" /><span class="visually-hidden">（已自訂）</span></template>
            </span>
          </template>
          <p class="field-help page-seo__where">官網網址：{{ page.path }}<template v-if="page.note">。{{ page.note }}</template></p>
          <el-form-item label="搜尋標題">
            <el-input
              v-model="pageSeo[page.key].title"
              :data-field="`page_seo.${page.key}.title`"
              data-keep-placeholder
              type="textarea"
              :autosize="{ minRows: 1, maxRows: 4 }"
              maxlength="120"
              show-word-limit
              :placeholder="`留空使用預設：${PAGE_SEO_DEFAULTS[page.key].title}`"
            />
            <LengthHint :value="pageSeo[page.key].title" rule="seoTitle" />
          </el-form-item>
          <el-form-item label="搜尋描述">
            <el-input
              v-model="pageSeo[page.key].description"
              :data-field="`page_seo.${page.key}.description`"
              data-keep-placeholder
              type="textarea"
              :autosize="{ minRows: 2, maxRows: 5 }"
              maxlength="300"
              show-word-limit
              :placeholder="`留空使用預設：${PAGE_SEO_DEFAULTS[page.key].description}`"
            />
            <LengthHint :value="pageSeo[page.key].description" rule="seoDescription" />
          </el-form-item>
          <el-form-item label="分享圖">
            <MediaRefField
              v-model="pageSeo[page.key].share_image"
              :data-field="`page_seo.${page.key}.share_image`"
              noun="圖片"
              builtin="全站分享圖"
              clear-label="改回全站分享圖"
              ratio="1200 / 630"
              :disabled="editor.readOnly.value"
              @picked="(asset, previousId) => onPickPageShareImage(page.key, asset, previousId)"
              @cleared="pageSeo[page.key].share_image_alt = ''"
            >
              <template #hint><span class="field-help">建議 1200×630 的橫式 JPG。沒選時用上面的社群分享圖。</span></template>
            </MediaRefField>
          </el-form-item>
          <el-form-item v-if="pageSeo[page.key].share_image" label="分享圖說明">
            <el-input
              v-model="pageSeo[page.key].share_image_alt"
              :data-field="`page_seo.${page.key}.share_image_alt`"
              type="textarea"
              :autosize="{ minRows: 1, maxRows: 4 }"
              maxlength="200"
              placeholder="例如：孩子在戶外遊戲場玩耍"
            />
            <span class="field-help">描述照片裡看得到的內容；換照片時會換成素材庫裡新照片的說明。</span>
          </el-form-item>
        </el-tab-pane>
      </el-tabs>

      <h3 id="section-meta-anniversary" class="meta-section" data-section-anchor tabindex="-1">30 週年</h3>
      <el-form-item>
        <el-switch
          v-model="editor.form.value.anniversary_enabled"
          data-field="anniversary_enabled"
          active-text="在官網顯示 30 週年內容"
          aria-label="在官網顯示 30 週年內容"
        />
        <span class="field-help">發布後生效。開啟時，首頁第一次進站會播 30 週年布幕，主選單與頁尾有「30 週年」分頁。關閉後，首頁不播布幕、直接看到首屏影片；30 週年分頁連同主選單、頁尾的連結一起拿掉，網址會顯示找不到頁面。</span>
      </el-form-item>

      <h3 id="section-meta-index" class="meta-section" data-section-anchor tabindex="-1">搜尋引擎</h3>
      <el-form-item>
        <el-switch v-model="editor.form.value.allow_indexing" active-text="允許 Google 等搜尋引擎收錄官網" aria-label="允許 Google 等搜尋引擎收錄官網" />
        <span class="field-help">發布後生效。關閉後，官網每一頁都會告訴搜尋引擎不要收錄。網站維護人員也可以從主機另外關閉收錄；那邊關閉時，這裡打開也不會生效。</span>
      </el-form-item>

      <h3 id="section-meta-nav" class="meta-section" data-section-anchor tabindex="-1">主選單</h3>
      <p class="field-help">
        頁首與選單面板的連結，依這裡的順序排列，最多 {{ PRIMARY_NAV_MAX }} 個。
      </p>
      <SiteLinksEditor :links="nav" with-english :min="1" :max="PRIMARY_NAV_MAX" :read-only="editor.readOnly.value" item-name="選單項目" />

      <h3 id="section-meta-social" class="meta-section" data-section-anchor tabindex="-1">機構社群</h3>
      <p class="field-help">
        顯示在頁首選單面板的「機構社群」，也讓搜尋引擎認得這些是官方帳號。依這裡的順序排列，最多 {{ SOCIAL_LINKS_MAX }} 個，網址要用 https:// 開頭、不能重複。各校自己的社群在「五校介紹」設定，不放在這裡。
      </p>
      <template v-if="socialLinks === null">
        <p class="hint">目前沿用官網內建：{{ builtinSocialLabels }}。</p>
        <el-button v-if="!editor.readOnly.value" @click="customiseSocials">改成自訂（帶入內建）</el-button>
      </template>
      <template v-else>
        <SocialLinksEditor :links="socialLinks" :max="SOCIAL_LINKS_MAX" :read-only="editor.readOnly.value" />
        <el-button v-if="!editor.readOnly.value" text class="social-restore" @click="restoreSocials">恢復內建</el-button>
      </template>

      <h3 id="section-meta-brand" class="meta-section" data-section-anchor tabindex="-1">品牌名稱與 Logo</h3>
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
.meta-section--first { margin-top: 0; }

.seo-lead { margin: 0 0 8px; }

/* 七個頁籤擠在 640px 的表單寬度裡：縮小左右留白，放不下時 Element Plus 會出現左右捲動鈕。
   已自訂的頁在頁名後面放一個綠點（報讀文字另外寫「已自訂」），不佔太多寬度。 */
.page-seo-tabs { min-width: 0; margin-bottom: 8px; }
.page-seo-tabs :deep(.el-tabs__item) { padding: 0 10px; }
.page-seo-tab { position: relative; display: inline-flex; align-items: center; gap: 4px; }
.page-seo-tab__dot { flex: none; width: 8px; height: 8px; border-radius: 50%; background: var(--status-live); }
.page-seo__where { margin: 4px 0 12px; }
.social-restore { margin-left: 8px; }
</style>
