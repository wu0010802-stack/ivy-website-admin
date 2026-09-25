<script setup lang="ts">
import { ref } from 'vue'
import { Delete, Picture } from '@element-plus/icons-vue'
import type { MediaAssetOut, NewsBodyBlock } from '../api/types'
import { mediaFileUrl } from '../api/client'
import MediaPickerDialog from './MediaPickerDialog.vue'
import { BLOCK_LABELS, NEWS_LIMITS, moveItem, newBlock, webUrlInvalid } from '../composables/newsContent'

// 消息內文（規格 3.4）：只有段落、小標、清單、圖片與連結五種區塊，存成結構化
// 資料，不收任何 HTML；官網逐塊用固定的樣式顯示。
const props = defineProps<{
  blocks: NewsBodyBlock[]
  /** 分校消息只能選自己校或共用的素材 */
  campusKey?: string
  readOnly?: boolean
}>()

const BLOCK_TYPES = Object.keys(BLOCK_LABELS) as NewsBodyBlock['type'][]

function add(type: NewsBodyBlock['type']) {
  props.blocks.push(newBlock(type))
}

function remove(index: number) {
  props.blocks.splice(index, 1)
}

const pickerVisible = ref(false)
const pickingIndex = ref<number | null>(null)

function pickImage(index: number) {
  pickingIndex.value = index
  pickerVisible.value = true
}

function onPick(asset: MediaAssetOut) {
  const block = pickingIndex.value === null ? null : props.blocks[pickingIndex.value]
  if (!block || block.type !== 'image') return
  block.image = asset.id
  if (!block.alt && asset.alt_text) block.alt = asset.alt_text
}

function listText(block: Extract<NewsBodyBlock, { type: 'list' }>): string {
  return block.items.join('\n')
}

function setListText(block: Extract<NewsBodyBlock, { type: 'list' }>, value: string) {
  block.items = value.split('\n')
}
</script>

<template>
  <div class="news-body">
    <p v-if="!blocks.length" class="hint news-body__empty">
      沒有內文時，官網的消息詳細頁只顯示摘要。
    </p>
    <div v-for="(block, index) in blocks" :key="index" class="news-body__block">
      <div class="news-body__head">
        <span class="news-body__type">{{ BLOCK_LABELS[block.type] }}</span>
        <span v-if="!readOnly" class="cell-actions">
          <el-button text size="small" :disabled="index === 0" @click="moveItem(blocks, index, -1)">上移</el-button>
          <el-button text size="small" :disabled="index === blocks.length - 1" @click="moveItem(blocks, index, 1)">下移</el-button>
          <el-button text size="small" type="danger" :icon="Delete" @click="remove(index)">移除</el-button>
        </span>
      </div>

      <el-input
        v-if="block.type === 'paragraph'" v-model="block.text" type="textarea"
        :autosize="{ minRows: 2, maxRows: 10 }" aria-label="段落文字"
      />
      <el-input v-else-if="block.type === 'heading'" v-model="block.text" maxlength="60" show-word-limit aria-label="小標文字" />
      <template v-else-if="block.type === 'list'">
        <el-input
          :model-value="listText(block)" type="textarea" :autosize="{ minRows: 2, maxRows: 10 }"
          aria-label="清單項目，一行一項" placeholder="一行一項"
          @update:model-value="setListText(block, $event)"
        />
        <el-checkbox v-model="block.ordered">加上編號（1. 2. 3.）</el-checkbox>
      </template>
      <div v-else-if="block.type === 'image'" class="news-body__image">
        <button type="button" class="news-body__thumb" :aria-label="block.image ? '更換圖片' : '從素材庫選擇圖片'" :disabled="readOnly" @click="pickImage(index)">
          <img v-if="block.image" :src="mediaFileUrl(block.image)" alt="" />
          <span v-else><el-icon><Picture /></el-icon>選擇圖片</span>
        </button>
        <div class="news-body__image-fields">
          <el-input v-model="block.alt" placeholder="替代文字（描述圖片內容）" aria-label="圖片替代文字" />
          <el-input v-model="block.caption" maxlength="120" placeholder="圖說（選填）" aria-label="圖說" />
          <span v-if="!block.image" class="field-help is-error">請從素材庫選一張圖片</span>
        </div>
      </div>
      <div v-else-if="block.type === 'link'" class="field-row">
        <el-input v-model="block.label" maxlength="40" placeholder="連結文字，例如：活動相簿" aria-label="連結文字" />
        <div>
          <el-input v-model="block.url" placeholder="https://" aria-label="連結網址" />
          <span v-if="webUrlInvalid(block.url)" class="field-help is-error">網址要以 https:// 或 http:// 開頭</span>
        </div>
      </div>
    </div>

    <div v-if="!readOnly" class="news-body__add">
      <span class="hint">加入：</span>
      <el-button
        v-for="type in BLOCK_TYPES" :key="type" size="small"
        :disabled="blocks.length >= NEWS_LIMITS.bodyBlocks" @click="add(type)"
      >
        {{ BLOCK_LABELS[type] }}
      </el-button>
    </div>

    <MediaPickerDialog v-model="pickerVisible" :campus-key="campusKey" @select="onPick" />
  </div>
</template>

<style scoped>
.news-body {
  display: grid;
  gap: 10px;
  width: 100%;
  min-width: 0;
}

.news-body__empty {
  margin: 0;
}

.news-body__block {
  display: grid;
  gap: 6px;
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-radius: 8px;
  min-width: 0;
}

.news-body__head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 4px 12px;
}

.news-body__type {
  font-size: 13px;
  font-weight: 600;
  color: var(--ink-2);
}

.news-body__image {
  display: grid;
  grid-template-columns: 140px minmax(0, 1fr);
  gap: 12px;
  align-items: start;
}

.news-body__image-fields {
  display: grid;
  gap: 6px;
  min-width: 0;
}

.news-body__thumb {
  display: grid;
  place-items: center;
  width: 100%;
  aspect-ratio: 1.55;
  padding: 0;
  border: 1px dashed var(--line);
  border-radius: 8px;
  overflow: hidden;
  background: var(--surface-2);
  color: var(--ink-2);
  font-size: 13px;
  cursor: pointer;
}

.news-body__thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.news-body__add {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.news-body__add .el-button + .el-button {
  margin-left: 0;
}

.is-error {
  color: var(--el-color-danger);
}

@media (max-width: 720px) {
  .news-body__image {
    grid-template-columns: minmax(0, 1fr);
  }

  .news-body__thumb {
    max-width: 200px;
  }
}
</style>
