<script setup lang="ts">
import { onMounted } from 'vue'
import { useContentItem } from '../composables/useContentItem'
import type { BookingContentPayload } from '../api/types'
import ContentEditor from '../components/ContentEditor.vue'

const editor = useContentItem<BookingContentPayload>('booking_content', {
  cta_label: '',
  cta_label_en: '',
  consent_text: '',
  banner_title_template: '',
  banner_body: '',
  banner_button_label: '',
})

onMounted(editor.load)
</script>

<template>
  <ContentEditor :editor="editor">
    <template #lead>
      預約按鈕與頁尾橫幅的文字。各校採用哪種預約方式（表單、LINE、電話）在
      <router-link to="/booking">各校預約方式</router-link> 設定。
    </template>

    <el-form label-position="top" @submit.prevent>
      <h3 class="form-section">預約按鈕</h3>
      <div class="field-row">
        <el-form-item label="中文">
          <el-input v-model="editor.form.value.cta_label" placeholder="預約參觀" />
        </el-form-item>
        <el-form-item label="英文副標">
          <el-input v-model="editor.form.value.cta_label_en" placeholder="Book a visit" />
        </el-form-item>
      </div>
      <el-form-item label="同意條款文字">
        <el-input v-model="editor.form.value.consent_text" type="textarea" :autosize="{ minRows: 2, maxRows: 5 }" />
        <span class="field-help">顯示在表單送出鈕上方，家長勾選後才能送出。</span>
      </el-form-item>

      <h3 class="form-section">頁尾預約橫幅</h3>
      <el-form-item label="橫幅標題">
        <el-input v-model="editor.form.value.banner_title_template" />
        <span class="field-help">可用 <code>{campus}</code> 代表目前校名，例如「歡迎預約參觀{campus}」。</span>
      </el-form-item>
      <el-form-item label="內文">
        <el-input v-model="editor.form.value.banner_body" />
      </el-form-item>
      <el-form-item label="按鈕文字">
        <el-input v-model="editor.form.value.banner_button_label" />
      </el-form-item>
    </el-form>
  </ContentEditor>
</template>

<style scoped>
.form-section {
  margin: 4px 0 12px;
  color: var(--ink-2);
}

.el-form-item + .form-section,
.field-row + .form-section {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid var(--line);
}
</style>
