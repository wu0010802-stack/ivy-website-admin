<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useContentItem } from '../composables/useContentItem'
import type { SiteFooterPayload } from '../api/types'
import ContentEditor from '../components/ContentEditor.vue'
import LengthHint from '../components/LengthHint.vue'
import SiteLinksEditor from '../components/SiteLinksEditor.vue'
import { DEFAULT_FOOTER_LINKS, FOOTER_LINKS_MAX } from '../composables/siteLinks'

const defaultLinks = () => DEFAULT_FOOTER_LINKS.map((link) => ({ ...link }))

const editor = useContentItem<SiteFooterPayload>(
  'site_footer',
  {
    tagline: '',
    copyright: '',
    bottom_note: '',
    campus_list_label: '',
    links: defaultLinks(),
  },
  undefined,
  {
    // 還沒在後台設定過頁尾連結的版本（沒有欄位或 null）：先帶入官網現在的內建連結。
    // 空陣列是園方刻意拿掉全部連結，照舊保留。
    normalize: (payload) => ({ ...payload, links: payload.links ?? defaultLinks() }),
  },
)
const links = computed(() => editor.form.value.links ?? [])

onMounted(editor.load)
</script>

<template>
  <ContentEditor :editor="editor">
    <template #lead>官網每一頁最底下的文字與連結。五校清單與聯絡方式來自「五校介紹」；品牌名稱依 2026-09-19 核可固定，不在這裡修改。</template>

    <el-form label-position="top" :disabled="editor.readOnly.value" @submit.prevent>
      <el-form-item label="標語">
        <el-input v-model="editor.form.value.tagline" />
        <LengthHint :value="editor.form.value.tagline" rule="footerTagline" />
      </el-form-item>
      <el-form-item label="五校清單標題">
        <el-input v-model="editor.form.value.campus_list_label" placeholder="例如：五校聯絡" />
      </el-form-item>
      <el-form-item label="版權字樣">
        <el-input v-model="editor.form.value.copyright" placeholder="例如：© 2026 常春藤教育機構" />
      </el-form-item>
      <el-form-item label="底部備註">
        <el-input v-model="editor.form.value.bottom_note" />
      </el-form-item>

      <h3 class="footer-section">頁尾連結</h3>
      <p class="field-help">依這裡的順序排列，最多 {{ FOOTER_LINKS_MAX }} 個。外部網站官網會加 ↗ 並另開分頁。</p>
      <SiteLinksEditor :links="links" :max="FOOTER_LINKS_MAX" :read-only="editor.readOnly.value" item-name="頁尾連結" />
    </el-form>
  </ContentEditor>
</template>

<style scoped>
.footer-section { margin: 24px 0 8px; font-size: 15px; }
</style>
