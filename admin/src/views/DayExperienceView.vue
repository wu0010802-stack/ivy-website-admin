<script setup lang="ts">
import { onMounted } from 'vue'
import { Delete, Plus } from '@element-plus/icons-vue'
import { useContentItem } from '../composables/useContentItem'
import type { DayExperiencePayload } from '../api/types'
import ContentEditor from '../components/ContentEditor.vue'

const MAX_MOMENTS = 12

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

const editor = useContentItem<DayExperiencePayload>('day_experience', {
  eyebrow: '',
  eyebrow_en: '',
  note: '',
  source_note: '',
  moments: [newMoment()],
})

function addMoment() {
  editor.form.value.moments.push(newMoment())
}

function removeMoment(index: number) {
  editor.form.value.moments.splice(index, 1)
}

onMounted(editor.load)
</script>

<template>
  <ContentEditor :editor="editor">
    <template #lead>
      首頁「孩子的一天」的文字。照片與背景影片仍由官網程式提供、尚未接素材庫，所以
      <strong>時刻卡的數量要對得上官網現有的照片張數</strong>，多出來的卡片官網不會顯示。
    </template>

    <el-form label-position="top" :disabled="editor.readOnly.value" @submit.prevent>
      <div class="field-row">
        <el-form-item label="小標（中文）">
          <el-input v-model="editor.form.value.eyebrow" placeholder="例如：孩子的一天" />
        </el-form-item>
        <el-form-item label="小標（英文）">
          <el-input v-model="editor.form.value.eyebrow_en" placeholder="A DAY AT IVY" />
        </el-form-item>
      </div>
      <el-form-item label="說明文字">
        <el-input v-model="editor.form.value.note" />
      </el-form-item>
      <el-form-item label="影片來源標註">
        <el-input v-model="editor.form.value.source_note" placeholder="例如：影片攝於義華校，2026 春" />
      </el-form-item>

      <div class="section__title" style="margin-top: 20px">
        <h2>時刻卡</h2>
        <span class="hint">{{ editor.form.value.moments.length }} / {{ MAX_MOMENTS }} 張</span>
      </div>

      <div v-for="(moment, index) in editor.form.value.moments" :key="moment.key" class="repeat-item">
        <div class="repeat-item__head">
          <span class="repeat-item__index">
            <b>{{ index + 1 }}</b>
            {{ moment.time || '時間未填' }}{{ moment.label ? `・${moment.label}` : '' }}
          </span>
          <el-button
            text
            size="small"
            type="danger"
            :icon="Delete"
            :disabled="editor.form.value.moments.length <= 1"
            @click="removeMoment(index)"
          >
            移除
          </el-button>
        </div>
        <div class="field-row">
          <el-form-item label="時間">
            <el-input v-model="moment.time" placeholder="08:00" />
          </el-form-item>
          <el-form-item label="時段名稱">
            <el-input v-model="moment.label" placeholder="例如：早晨" />
          </el-form-item>
        </div>
        <div class="field-row">
          <el-form-item label="拍立得標題">
            <el-input v-model="moment.title" />
          </el-form-item>
          <el-form-item label="拍立得說明">
            <el-input v-model="moment.caption" />
          </el-form-item>
        </div>
        <el-form-item label="翻面後的故事">
          <el-input v-model="moment.story" type="textarea" :autosize="{ minRows: 2, maxRows: 6 }" />
        </el-form-item>
        <div class="field-row">
          <el-form-item label="家長常問">
            <el-input v-model="moment.question" />
          </el-form-item>
          <el-form-item label="我們的回答">
            <el-input v-model="moment.answer" type="textarea" :autosize="{ minRows: 1, maxRows: 4 }" />
          </el-form-item>
        </div>
      </div>

      <el-button :icon="Plus" :disabled="editor.form.value.moments.length >= MAX_MOMENTS" @click="addMoment">
        新增一張時刻卡
      </el-button>
    </el-form>
  </ContentEditor>
</template>
