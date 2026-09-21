<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useContentItem } from '../composables/useContentItem'
import { CAMPUS_KEYS } from '../api/types'
import type { CampusFaqPayload } from '../api/types'
import { useAuthStore } from '../stores/auth'

const authStore = useAuthStore()

const visibleCampusKeys = computed(() => {
  if (authStore.user?.role === 'super_admin') return [...CAMPUS_KEYS]
  return authStore.user?.campus_keys ?? []
})

const selectedCampus = ref<string>('')

const { item, form, saving, publishing, isPublished, load, save, publish } =
  useContentItem<CampusFaqPayload>('campus_faq', { items: [{ q: '', a: '' }] }, selectedCampus)

function addItem() {
  form.value.items.push({ q: '', a: '' })
}

function removeItem(index: number) {
  form.value.items.splice(index, 1)
}

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
    <h2>各校 FAQ</h2>
    <el-form-item label="選擇校區">
      <el-select v-model="selectedCampus" style="width: 200px">
        <el-option v-for="key in visibleCampusKeys" :key="key" :label="key" :value="key" />
      </el-select>
    </el-form-item>

    <template v-if="selectedCampus">
      <el-tag v-if="isPublished" type="success">目前草稿已發布</el-tag>
      <el-tag v-else type="warning">尚有未發布的草稿</el-tag>

      <div v-for="(qa, index) in form.items" :key="index" style="margin: 1rem 0">
        <el-form label-position="top">
          <el-form-item :label="`問題 #${index + 1}`">
            <el-input v-model="qa.q" />
          </el-form-item>
          <el-form-item label="回答">
            <el-input v-model="qa.a" type="textarea" :rows="2" />
          </el-form-item>
          <el-button size="small" type="danger" :disabled="form.items.length <= 1" @click="removeItem(index)">
            移除這一題
          </el-button>
        </el-form>
        <el-divider />
      </div>

      <el-button :disabled="form.items.length >= 20" @click="addItem">新增一題</el-button>

      <div style="margin-top: 1.5rem">
        <el-button type="primary" :loading="saving" @click="save">儲存草稿</el-button>
        <el-button
          type="success"
          :loading="publishing"
          :disabled="!item?.latest_revision"
          @click="publish"
        >
          發布到官網
        </el-button>
      </div>
    </template>
  </div>
</template>
