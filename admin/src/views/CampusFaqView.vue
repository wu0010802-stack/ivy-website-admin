<script setup lang="ts">
import { ref, useTemplateRef } from 'vue'
import { Delete, Plus } from '@element-plus/icons-vue'
import { useContentItem } from '../composables/useContentItem'
import { useCampusContent } from '../composables/useCampusContent'
import type { CampusFaqPayload } from '../api/types'
import ContentEditor from '../components/ContentEditor.vue'
import CampusSelect from '../components/CampusSelect.vue'

const MAX_ITEMS = 20

const campus = ref('')
const editor = useContentItem<CampusFaqPayload>('campus_faq', { items: [{ q: '', a: '' }] }, campus)
const shell = useTemplateRef<InstanceType<typeof ContentEditor>>('shell')
const { visibleCampusKeys } = useCampusContent(editor, campus, shell)

function addItem() {
  editor.form.value.items.push({ q: '', a: '' })
}

function removeItem(index: number) {
  editor.form.value.items.splice(index, 1)
}

function move(index: number, delta: number) {
  const items = editor.form.value.items
  const target = index + delta
  if (target < 0 || target >= items.length) return
  const [it] = items.splice(index, 1)
  items.splice(target, 0, it!)
}
</script>

<template>
  <ContentEditor
    ref="shell"
    :editor="editor"
    :placeholder="visibleCampusKeys.length === 0 ? '你的帳號沒有可編輯的校區。' : undefined"
  >
    <template #lead>分校頁「常見問題」的問答，依這裡的順序顯示，最多 {{ MAX_ITEMS }} 題。</template>
    <template #toolbar>
      <CampusSelect v-model="campus" :keys="visibleCampusKeys" />
    </template>

    <el-form label-position="top" :disabled="editor.readOnly.value" @submit.prevent>
      <div v-for="(qa, index) in editor.form.value.items" :key="index" class="repeat-item">
        <div class="repeat-item__head">
          <span class="repeat-item__index"><b>{{ index + 1 }}</b>第 {{ index + 1 }} 題</span>
          <span v-if="!editor.readOnly.value" class="cell-actions">
            <el-button text size="small" :disabled="index === 0" @click="move(index, -1)">上移</el-button>
            <el-button text size="small" :disabled="index === editor.form.value.items.length - 1" @click="move(index, 1)">下移</el-button>
            <el-button
              text
              size="small"
              type="danger"
              :icon="Delete"
              :disabled="editor.form.value.items.length <= 1"
              @click="removeItem(index)"
            >
              移除
            </el-button>
          </span>
        </div>
        <el-form-item label="問題">
          <el-input v-model="qa.q" placeholder="例如：幾歲可以入園？" />
        </el-form-item>
        <el-form-item label="回答">
          <el-input v-model="qa.a" type="textarea" :autosize="{ minRows: 2, maxRows: 8 }" />
        </el-form-item>
      </div>

      <template v-if="!editor.readOnly.value">
        <el-button :icon="Plus" :disabled="editor.form.value.items.length >= MAX_ITEMS" @click="addItem">
          新增一題
        </el-button>
        <span v-if="editor.form.value.items.length >= MAX_ITEMS" class="hint" style="margin-left: 8px">已達上限</span>
      </template>
    </el-form>
  </ContentEditor>
</template>
