<script setup lang="ts">
import { onMounted } from 'vue'
import { Delete, Plus } from '@element-plus/icons-vue'
import { useContentItem } from '../composables/useContentItem'
import type { SharedFaqItemPayload, SharedFaqPayload } from '../api/types'
import ContentEditor from '../components/ContentEditor.vue'
import LengthHint from '../components/LengthHint.vue'
import ScopeField from '../components/ScopeField.vue'
import { moveItem, newId, scopeLabel } from '../composables/newsContent'

// 全站共用常見問題（shared_faq）：總管理者或有「全站共用內容」授權的人編輯。
// 各校在「各校常見問題」決定要不要顯示、放在本校題目之前或之後；各校也可以
// 寫一題同樣問題的版本蓋過共用答案，其他校不受影響。
const MAX_ITEMS = 20

function normalizeItem(raw: Partial<SharedFaqItemPayload>): SharedFaqItemPayload {
  return {
    id: raw.id || newId('faq'),
    q: raw.q ?? '',
    a: raw.a ?? '',
    enabled: raw.enabled ?? true,
    scope: raw.scope === 'campus' ? 'campus' : 'global',
    campus_keys: [...(raw.campus_keys ?? [])],
  }
}

const editor = useContentItem<SharedFaqPayload>('shared_faq', { items: [] }, undefined, {
  normalize: (payload) => ({ items: (payload.items ?? []).map(normalizeItem) }),
})

function addItem() {
  editor.form.value.items.push(normalizeItem({}))
}

onMounted(editor.load)
</script>

<template>
  <ContentEditor :editor="editor">
    <template #lead>
      五校共用的常見問題，改一次各校分校頁一起更新；每題可以只給指定的幾校，或先停用不顯示。
      各校在「各校常見問題」決定要不要顯示共用題目、放在本校題目之前或之後。最多 {{ MAX_ITEMS }} 題。
    </template>

    <el-form label-position="top" :disabled="editor.readOnly.value" @submit.prevent>
      <p v-if="!editor.form.value.items.length" class="hint">還沒有共用題目，各校分校頁只顯示自己的題目。</p>
      <div v-for="(qa, index) in editor.form.value.items" :key="qa.id" class="repeat-item">
        <div class="repeat-item__head">
          <span class="repeat-item__index">
            <b>{{ index + 1 }}</b>{{ scopeLabel(qa) }}
            <el-tag v-if="!qa.enabled" size="small" type="info">已停用，官網不顯示</el-tag>
          </span>
          <span v-if="!editor.readOnly.value" class="cell-actions">
            <el-button text size="small" :disabled="index === 0" @click="moveItem(editor.form.value.items, index, -1)">上移</el-button>
            <el-button text size="small" :disabled="index === editor.form.value.items.length - 1" @click="moveItem(editor.form.value.items, index, 1)">下移</el-button>
            <el-button text size="small" type="danger" :icon="Delete" @click="editor.form.value.items.splice(index, 1)">移除</el-button>
          </span>
        </div>
        <el-form-item>
          <el-switch v-model="qa.enabled" active-text="在官網顯示" inactive-text="停用" inline-prompt :aria-label="`第 ${index + 1} 題在官網顯示`" style="--el-switch-on-color: var(--status-live)" />
        </el-form-item>
        <ScopeField :entry="qa" />
        <el-form-item label="問題">
          <el-input v-model="qa.q" placeholder="例如：參觀需要預約嗎？" />
          <LengthHint :value="qa.q" rule="faqQuestion" />
        </el-form-item>
        <el-form-item label="回答">
          <el-input v-model="qa.a" type="textarea" :autosize="{ minRows: 2, maxRows: 8 }" />
          <LengthHint :value="qa.a" rule="faqAnswer" />
        </el-form-item>
      </div>

      <template v-if="!editor.readOnly.value">
        <el-button :icon="Plus" :disabled="editor.form.value.items.length >= MAX_ITEMS" @click="addItem">新增一題</el-button>
        <span v-if="editor.form.value.items.length >= MAX_ITEMS" class="hint" style="margin-left: 8px">已達上限</span>
      </template>
    </el-form>
  </ContentEditor>
</template>

<style scoped>
.repeat-item__head {
  flex-wrap: wrap;
}
</style>
