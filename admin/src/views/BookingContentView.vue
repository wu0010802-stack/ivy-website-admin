<script setup lang="ts">
import { onMounted } from 'vue'
import { useContentItem } from '../composables/useContentItem'
import type { BookingContentPayload } from '../api/types'

const { item, form, saving, publishing, isPublished, load, save, publish } =
  useContentItem<BookingContentPayload>('booking_content', {
    cta_label: '',
    cta_label_en: '',
    consent_text: '',
    banner_title_template: '',
    banner_body: '',
    banner_button_label: '',
  })

onMounted(load)
</script>

<template>
  <div style="max-width: 640px">
    <h2>預約相關文案</h2>
    <el-tag v-if="isPublished" type="success">目前草稿已發布</el-tag>
    <el-tag v-else type="warning">尚有未發布的草稿</el-tag>
    <p style="color: var(--el-text-color-secondary)">
      這裡只改按鈕與說明文字；表單欄位定義與各校啟用哪種預約模式，改在「預約設定」頁。
    </p>

    <el-form label-position="top" style="margin-top: 1rem" @submit.prevent>
      <el-form-item label="預約按鈕文字（中文）">
        <el-input v-model="form.cta_label" />
      </el-form-item>
      <el-form-item label="預約按鈕文字（英文）">
        <el-input v-model="form.cta_label_en" />
      </el-form-item>
      <el-form-item label="同意條款文字">
        <el-input v-model="form.consent_text" type="textarea" :rows="2" />
      </el-form-item>
      <el-form-item label="頁尾預約橫幅標題樣板">
        <el-input v-model="form.banner_title_template" />
      </el-form-item>
      <el-form-item label="頁尾預約橫幅內文">
        <el-input v-model="form.banner_body" />
      </el-form-item>
      <el-form-item label="頁尾預約橫幅按鈕文字">
        <el-input v-model="form.banner_button_label" />
      </el-form-item>
      <el-form-item>
        <el-button type="primary" :loading="saving" @click="save">儲存草稿</el-button>
        <el-button
          type="success"
          :loading="publishing"
          :disabled="!item?.latest_revision"
          @click="publish"
        >
          發布到官網
        </el-button>
      </el-form-item>
    </el-form>
  </div>
</template>
