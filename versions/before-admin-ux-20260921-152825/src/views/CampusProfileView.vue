<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useContentItem } from '../composables/useContentItem'
import { CAMPUS_KEYS } from '../api/types'
import type { CampusProfilePayload } from '../api/types'
import { useAuthStore } from '../stores/auth'

const authStore = useAuthStore()

const visibleCampusKeys = computed(() => {
  if (authStore.user?.role === 'super_admin') return [...CAMPUS_KEYS]
  return authStore.user?.campus_keys ?? []
})

const selectedCampus = ref<string>('')

const { item, form, saving, publishing, isPublished, load, save, publish } =
  useContentItem<CampusProfilePayload>(
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
    },
    selectedCampus,
  )

watch(
  selectedCampus,
  (key) => {
    if (key) load()
  },
  { immediate: false },
)

onMounted(() => {
  if (visibleCampusKeys.value.length > 0) {
    selectedCampus.value = visibleCampusKeys.value[0]
    load()
  }
})
</script>

<template>
  <div style="max-width: 640px">
    <h2>五校介紹內容</h2>
    <el-form-item label="選擇校區">
      <el-select v-model="selectedCampus" style="width: 200px">
        <el-option v-for="key in visibleCampusKeys" :key="key" :label="key" :value="key" />
      </el-select>
    </el-form-item>

    <template v-if="selectedCampus">
      <el-tag v-if="isPublished" type="success">目前草稿已發布</el-tag>
      <el-tag v-else type="warning">尚有未發布的草稿</el-tag>

      <el-form label-position="top" style="margin-top: 1rem" @submit.prevent>
        <el-form-item label="校名">
          <el-input v-model="form.name" />
        </el-form-item>
        <el-form-item label="行政區">
          <el-input v-model="form.district" />
        </el-form-item>
        <el-form-item label="地址">
          <el-input v-model="form.address" />
        </el-form-item>
        <el-form-item label="電話">
          <el-input v-model="form.phone" />
        </el-form-item>
        <el-form-item label="簡介（一句話）">
          <el-input v-model="form.intro" />
        </el-form-item>
        <el-form-item label="詳細描述">
          <el-input v-model="form.description" type="textarea" :rows="4" />
        </el-form-item>
        <el-form-item label="Facebook 網址">
          <el-input v-model="form.facebook" />
        </el-form-item>
        <el-form-item label="Facebook 說明">
          <el-input v-model="form.fb_note" />
        </el-form-item>
        <el-form-item label="LINE 官方帳號網址（留空代表尚未提供）">
          <el-input v-model="form.line" />
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
    </template>
  </div>
</template>
