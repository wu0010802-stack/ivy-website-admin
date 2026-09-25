<script setup lang="ts">
import { onMounted, useTemplateRef } from 'vue'
import { useContentItem } from '../composables/useContentItem'
import type { HomeCampusBoardPayload } from '../api/types'
import { campusLabel } from '../api/labels'
import { CAMPUS_KEYS } from '../composables/newsContent'
import { moveKeepingFocus } from '../composables/moveKeepingFocus'
import ContentEditor from '../components/ContentEditor.vue'
import GlyphHint from '../components/GlyphHint.vue'
import LengthHint from '../components/LengthHint.vue'

// 首頁五校的顯示順序要剛好是五校各一次（後端同樣檢查）；舊版本沒有這兩個欄位，
// 或順序不完整時，先帶入官網原本的內建順序。
function validOrder(order: string[] | undefined): order is string[] {
  return Array.isArray(order)
    && order.length === CAMPUS_KEYS.length
    && new Set(order).size === order.length
    && order.every((key) => CAMPUS_KEYS.includes(key))
}

const editor = useContentItem<HomeCampusBoardPayload>(
  'home_campus_board',
  {
    section_title: '',
    eyebrow: '',
    note: '',
    campus_order: [...CAMPUS_KEYS],
    default_campus: CAMPUS_KEYS[0]!,
  },
  undefined,
  {
    normalize: (payload) => ({
      ...payload,
      campus_order: validOrder(payload.campus_order) ? [...payload.campus_order] : [...CAMPUS_KEYS],
      default_campus: CAMPUS_KEYS.includes(payload.default_campus) ? payload.default_campus : CAMPUS_KEYS[0]!,
    }),
  },
)

const orderList = useTemplateRef<HTMLElement>('orderList')
function move(index: number, delta: number) {
  void moveKeepingFocus(editor.form.value.campus_order, index, delta, orderList.value)
}

onMounted(editor.load)
</script>

<template>
  <ContentEditor :editor="editor">
    <template #lead>首頁五校區塊的標題、五校的排列順序與一進首頁先顯示哪一校。各校的名稱、地址與電話在「五校介紹」修改。</template>

    <el-form label-position="top" :disabled="editor.readOnly.value" @submit.prevent>
      <el-form-item label="小標">
        <el-input v-model="editor.form.value.eyebrow" placeholder="例如：CAMPUSES" />
      </el-form-item>
      <el-form-item label="區塊標題">
        <el-input v-model="editor.form.value.section_title" placeholder="例如：分校資訊" />
        <LengthHint :value="editor.form.value.section_title" rule="boardTitle" />
        <GlyphHint :value="editor.form.value.section_title" :fonts="['serif']" />
      </el-form-item>
      <el-form-item label="說明文字">
        <el-input v-model="editor.form.value.note" />
        <LengthHint :value="editor.form.value.note" rule="boardNote" />
      </el-form-item>

      <h3 class="board-section">五校順序</h3>
      <p class="field-help">首頁輪播、左右切換都照這個順序。停用的分校官網會自動略過。</p>
      <ol ref="orderList" class="board-order">
        <li v-for="(key, index) in editor.form.value.campus_order" :key="index" class="board-order__item">
          <span class="board-order__name"><b>{{ index + 1 }}</b>{{ campusLabel(key) }}校</span>
          <span v-if="!editor.readOnly.value" class="board-order__actions">
            <el-button text size="small" :disabled="index === 0" :data-move-row="index" data-move-dir="-1" :aria-label="`${campusLabel(key)}校上移`" @click="move(index, -1)">上移</el-button>
            <el-button text size="small" :disabled="index === editor.form.value.campus_order.length - 1" :data-move-row="index" data-move-dir="1" :aria-label="`${campusLabel(key)}校下移`" @click="move(index, 1)">下移</el-button>
          </span>
        </li>
      </ol>

      <el-form-item label="進首頁先顯示">
        <el-radio-group v-model="editor.form.value.default_campus">
          <el-radio v-for="key in editor.form.value.campus_order" :key="key" :value="key">{{ campusLabel(key) }}校</el-radio>
        </el-radio-group>
      </el-form-item>
    </el-form>
  </ContentEditor>
</template>

<style scoped>
.board-section { margin: 24px 0 8px; font-size: 15px; }
.board-order { list-style: none; margin: 8px 0 20px; padding: 0; max-width: 420px; }
.board-order__item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 0;
  border-bottom: 1px solid var(--line);
}
.board-order__name { display: flex; align-items: center; gap: 10px; }
.board-order__name b {
  display: inline-grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: var(--surface-3);
  font-size: 12px;
}
.board-order__actions { display: flex; gap: 4px; }
</style>
