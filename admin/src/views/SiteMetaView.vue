<script setup lang="ts">
import { onMounted } from 'vue'
import { useContentItem } from '../composables/useContentItem'
import type { SiteMetaPayload } from '../api/types'
import ContentEditor from '../components/ContentEditor.vue'

const editor = useContentItem<SiteMetaPayload>('site_meta', {
  title: '',
  description: '',
  header_phone_number: '',
  header_phone_note: '',
})

onMounted(editor.load)
</script>

<template>
  <ContentEditor :editor="editor">
    <template #lead>瀏覽器分頁與搜尋結果顯示的網站名稱，以及頁首右上角的聯絡電話。</template>

    <el-form label-position="top" @submit.prevent>
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
    </el-form>
  </ContentEditor>
</template>
