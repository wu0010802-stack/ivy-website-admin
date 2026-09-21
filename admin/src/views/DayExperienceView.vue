<script setup lang="ts">
import { onMounted } from 'vue'
import { useContentItem } from '../composables/useContentItem'
import type { DayExperiencePayload } from '../api/types'

function newMoment() {
  return {
    key: `moment-${Date.now()}`,
    time: '',
    label: '',
    caption: '',
    title: '',
    story: '',
    question: '',
    answer: '',
  }
}

const { item, form, saving, publishing, isPublished, load, save, publish } =
  useContentItem<DayExperiencePayload>('day_experience', {
    eyebrow: '',
    eyebrow_en: '',
    note: '',
    source_note: '',
    moments: [newMoment()],
  })

function addMoment() {
  form.value.moments.push(newMoment())
}

function removeMoment(index: number) {
  form.value.moments.splice(index, 1)
}

onMounted(load)
</script>

<template>
  <div style="max-width: 720px">
    <h2>孩子的一天：文字內容</h2>
    <el-tag v-if="isPublished" type="success">目前草稿已發布</el-tag>
    <el-tag v-else type="warning">尚有未發布的草稿</el-tag>
    <p style="color: var(--el-text-color-secondary)">
      這裡只改文字（1～12 筆時刻卡）；影片與照片素材仍在官網程式碼中設定，尚未接上素材庫。
      <strong>新增超過官網目前既有照片卡數量的筆數，官網不會顯示</strong>（沒有對應照片，避免出現破圖），
      建議先確認官網目前有幾張照片卡再決定要不要新增。
    </p>

    <el-form label-position="top" style="margin-top: 1rem" @submit.prevent>
      <el-form-item label="Eyebrow（中文）">
        <el-input v-model="form.eyebrow" />
      </el-form-item>
      <el-form-item label="Eyebrow（英文）">
        <el-input v-model="form.eyebrow_en" />
      </el-form-item>
      <el-form-item label="說明文字">
        <el-input v-model="form.note" />
      </el-form-item>
      <el-form-item label="影片來源標註">
        <el-input v-model="form.source_note" />
      </el-form-item>

      <h3>時刻卡（{{ form.moments.length }} 筆）</h3>
      <el-card
        v-for="(moment, index) in form.moments"
        :key="moment.key"
        style="margin-bottom: 1rem"
      >
        <template #header>
          <div style="display: flex; justify-content: space-between; align-items: center">
            <span>#{{ index + 1 }}（key：{{ moment.key }}）</span>
            <el-button
              size="small"
              type="danger"
              :disabled="form.moments.length <= 1"
              @click="removeMoment(index)"
            >
              移除
            </el-button>
          </div>
        </template>
        <el-form-item label="時間">
          <el-input v-model="moment.time" placeholder="例如：08:00" />
        </el-form-item>
        <el-form-item label="標籤">
          <el-input v-model="moment.label" placeholder="例如：早晨" />
        </el-form-item>
        <el-form-item label="拍立得標題">
          <el-input v-model="moment.title" />
        </el-form-item>
        <el-form-item label="拍立得說明">
          <el-input v-model="moment.caption" />
        </el-form-item>
        <el-form-item label="故事文字">
          <el-input v-model="moment.story" type="textarea" :rows="2" />
        </el-form-item>
        <el-form-item label="提問">
          <el-input v-model="moment.question" />
        </el-form-item>
        <el-form-item label="回答">
          <el-input v-model="moment.answer" type="textarea" :rows="2" />
        </el-form-item>
      </el-card>

      <el-button :disabled="form.moments.length >= 12" @click="addMoment">新增一筆時刻卡</el-button>

      <el-form-item style="margin-top: 1.5rem">
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
