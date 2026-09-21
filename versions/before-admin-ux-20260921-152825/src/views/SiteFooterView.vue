<script setup lang="ts">
import { onMounted } from 'vue'
import { useContentItem } from '../composables/useContentItem'
import type { SiteFooterPayload } from '../api/types'

const { item, form, saving, publishing, isPublished, load, save, publish } =
  useContentItem<SiteFooterPayload>('site_footer', {
    tagline: '',
    copyright: '',
    bottom_note: '',
    campus_list_label: '',
  })

onMounted(load)
</script>

<template>
  <div style="max-width: 640px">
    <h2>頁尾文字</h2>
    <el-tag v-if="isPublished" type="success">目前草稿已發布</el-tag>
    <el-tag v-else type="warning">尚有未發布的草稿</el-tag>

    <el-form label-position="top" style="margin-top: 1rem" @submit.prevent>
      <el-form-item label="標語">
        <el-input v-model="form.tagline" />
      </el-form-item>
      <el-form-item label="校區清單標題">
        <el-input v-model="form.campus_list_label" />
      </el-form-item>
      <el-form-item label="版權文字">
        <el-input v-model="form.copyright" />
      </el-form-item>
      <el-form-item label="底部備註">
        <el-input v-model="form.bottom_note" />
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
