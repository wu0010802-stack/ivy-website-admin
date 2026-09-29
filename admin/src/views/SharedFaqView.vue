<script setup lang="ts">
import { onMounted, useTemplateRef } from 'vue'
import { Delete, Plus } from '@element-plus/icons-vue'
import { useContentItem } from '../composables/useContentItem'
import type { SharedFaqItemPayload, SharedFaqPayload } from '../api/types'
import ContentEditor from '../components/ContentEditor.vue'
import { vReadonlyValues } from '../composables/readonlyValues'
import LengthHint from '../components/LengthHint.vue'
import ScopeField from '../components/ScopeField.vue'
import { moveKeepingFocus } from '../composables/moveKeepingFocus'
import { newId, revealListItem, scopeLabel } from '../composables/newsContent'

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

const list = useTemplateRef<HTMLElement>('list')

// 新題目加在最後，加完捲過去並聚焦問題欄。
function addItem() {
  editor.form.value.items.push(normalizeItem({}))
  void revealListItem(list.value, `[data-list-item="${editor.form.value.items.length - 1}"]`)
}

function move(index: number, delta: number) {
  void moveKeepingFocus(editor.form.value.items, index, delta, list.value)
}

onMounted(editor.load)
</script>

<template>
  <ContentEditor :editor="editor">
    <template #lead>
      五校共用的常見問題，改一次各校分校頁一起更新；每題可以只給指定的幾校，或先停用不顯示。
      各校在「各校常見問題」決定要不要顯示共用題目、放在本校題目之前或之後。最多 {{ MAX_ITEMS }} 題。
    </template>

    <el-form v-readonly-values="editor.readOnly.value" label-position="top" :disabled="editor.readOnly.value" @submit.prevent>
      <p v-if="!editor.form.value.items.length" class="hint">還沒有共用題目，各校分校頁只顯示自己的題目。</p>
      <div ref="list">
      <div v-for="(qa, index) in editor.form.value.items" :key="qa.id" class="repeat-item" :data-list-item="index">
        <div class="repeat-item__head">
          <span class="repeat-item__index faq-head__title">
            <b>{{ index + 1 }}</b>
            <span class="faq-head__q" :title="qa.q">{{ qa.q.trim() || '還沒填問題' }}</span>
            <el-tag size="small" :type="qa.scope === 'campus' ? 'primary' : 'info'" effect="plain">{{ scopeLabel(qa) }}</el-tag>
            <el-tag v-if="!qa.enabled" size="small" type="info">已停用，官網不顯示</el-tag>
          </span>
          <span v-if="!editor.readOnly.value" class="faq-head__actions">
            <el-button text size="small" :disabled="index === 0" :data-move-row="index" data-move-dir="-1" :aria-label="`上移第 ${index + 1} 題`" @click="move(index, -1)">上移</el-button>
            <el-button text size="small" :disabled="index === editor.form.value.items.length - 1" :data-move-row="index" data-move-dir="1" :aria-label="`下移第 ${index + 1} 題`" @click="move(index, 1)">下移</el-button>
            <el-button text size="small" type="danger" :icon="Delete" @click="editor.form.value.items.splice(index, 1)">移除</el-button>
          </span>
        </div>
        <el-form-item>
          <el-switch v-model="qa.enabled" class="show-switch" active-text="在官網顯示" inactive-text="停用" :aria-label="`第 ${index + 1} 題在官網顯示`" />
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

/* 同「各校常見問題」：標頭顯示問題（一行，太長用刪節號）與適用範圍。 */
.faq-head__title {
  flex: 1 1 240px;
  min-width: 0;
}

.faq-head__q {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.faq-head__title .el-tag,
.faq-head__title b {
  flex-shrink: 0;
}

.faq-head__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.faq-head__actions .el-button + .el-button {
  margin-left: 0;
}

/* 兩個常見問題頁同一種「在官網顯示」開關：文字在外側、打開時是「已上線」綠。 */
.show-switch {
  --el-switch-on-color: var(--status-live);
}
</style>
