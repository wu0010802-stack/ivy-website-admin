<script setup lang="ts">
import { useId, useTemplateRef } from 'vue'
import { Delete } from '@element-plus/icons-vue'
import type { NewsBodyBlock } from '../api/types'
import MediaRefField from './MediaRefField.vue'
import { altAfterPick } from '../composables/mediaThumbs'
import { BLOCK_LABELS, NEWS_LIMITS, moveItem, newBlock, revealListItem, webUrlError } from '../composables/newsContent'

// 消息內文（規格 3.4）：只有段落、小標、清單、圖片與連結五種區塊，存成結構化
// 資料，不收任何 HTML；官網逐塊用固定的樣式顯示。
const props = defineProps<{
  blocks: NewsBodyBlock[]
  /** 分校消息只能選自己校或共用的素材 */
  campusKey?: string
  readOnly?: boolean
}>()

const BLOCK_TYPES = Object.keys(BLOCK_LABELS) as NewsBodyBlock['type'][]
const root = useTemplateRef<HTMLElement>('root')
// 連結網址錯誤訊息的 id（同一頁可能有好幾個內文編輯器）。
const uid = useId()

// 新的區塊加在最後，加完捲過去並聚焦（圖片區塊聚焦「選擇圖片」）。
function add(type: NewsBodyBlock['type']) {
  props.blocks.push(newBlock(type))
  void revealListItem(root.value, `[data-list-item="${props.blocks.length - 1}"]`, 'textarea, input:not([type=checkbox]), .media-field__actions button')
}

function remove(index: number) {
  props.blocks.splice(index, 1)
}

function listText(block: Extract<NewsBodyBlock, { type: 'list' }>): string {
  return block.items.join('\n')
}

function setListText(block: Extract<NewsBodyBlock, { type: 'list' }>, value: string) {
  block.items = value.split('\n')
}
</script>

<template>
  <div ref="root" class="news-body">
    <p v-if="!blocks.length" class="hint news-body__empty">
      沒有內文時，官網的消息詳細頁只顯示摘要。
    </p>
    <div v-for="(block, index) in blocks" :key="index" class="news-body__block" :data-list-item="index">
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
        <MediaRefField
          v-model="block.image"
          :campus-key="campusKey"
          noun="圖片"
          layout="stack"
          ratio="1.55"
          :clearable="false"
          required
          :disabled="readOnly"
          @picked="(asset, previous) => (block.alt = altAfterPick(block.alt, previous, asset))"
        />
        <div class="news-body__image-fields">
          <label class="news-body__field">
            <span>圖片說明（給看不到照片的人）</span>
            <el-input v-model="block.alt" type="textarea" :autosize="{ minRows: 1, maxRows: 4 }" placeholder="描述圖片內容，例如：孩子在菜園裡澆水" />
          </label>
          <label class="news-body__field">
            <span>照片下方文字（選填）</span>
            <el-input v-model="block.caption" type="textarea" :autosize="{ minRows: 1, maxRows: 4 }" maxlength="120" />
          </label>
        </div>
      </div>
      <div v-else-if="block.type === 'link'" class="field-row">
        <label class="news-body__field">
          <span>連結文字</span>
          <el-input v-model="block.label" maxlength="40" placeholder="例如：活動相簿" />
        </label>
        <!-- 錯誤訊息放在 label 外面、用 aria-describedby 連回輸入框，才不會變成欄位名稱的一部分。 -->
        <div class="news-body__field">
          <label class="news-body__field">
            <span>連結網址</span>
            <el-input
              v-model="block.url" inputmode="url" placeholder="https://"
              :aria-invalid="webUrlError(block.url) ? 'true' : undefined"
              :aria-describedby="webUrlError(block.url) ? `${uid}-url-${index}` : undefined"
            />
          </label>
          <span v-if="webUrlError(block.url)" :id="`${uid}-url-${index}`" class="field-help is-error">{{ webUrlError(block.url) }}</span>
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
  font-size: var(--text-sm);
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

.news-body__field {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.news-body__field > span:first-child {
  font-size: var(--text-sm);
  color: var(--ink-2);
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
}
</style>
