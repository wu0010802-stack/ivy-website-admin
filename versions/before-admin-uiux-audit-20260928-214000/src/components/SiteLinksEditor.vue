<script setup lang="ts">
import { useTemplateRef } from 'vue'
import { Delete, Plus } from '@element-plus/icons-vue'
import type { NavLinkPayload, SiteLinkPayload } from '../api/types'
import { moveKeepingFocus } from '../composables/moveKeepingFocus'
import { isExternalLink, labelEnError, siteLinkError } from '../composables/siteLinks'

// 主選單與頁尾連結共用的清單編輯：顯示文字、連結、排序（上移／下移按鈕，
// 鍵盤可操作）。直接修改傳入的陣列（同 ScopeField）。外部連結官網會加 ↗、另開分頁。
const props = defineProps<{
  links: (SiteLinkPayload | NavLinkPayload)[]
  /** 主選單：多一個頁首英文小字欄位 */
  withEnglish?: boolean
  min?: number
  max: number
  readOnly?: boolean
  itemName: string
}>()

const root = useTemplateRef<HTMLElement>('root')
function move(index: number, delta: number) {
  void moveKeepingFocus(props.links, index, delta, root.value)
}

function add() {
  const link: SiteLinkPayload | NavLinkPayload = props.withEnglish
    ? { label: '', label_en: '', href: '' }
    : { label: '', href: '' }
  props.links.push(link)
}

function remove(index: number) {
  props.links.splice(index, 1)
}

function english(link: SiteLinkPayload | NavLinkPayload): NavLinkPayload {
  return link as NavLinkPayload
}
</script>

<template>
  <div ref="root" class="site-links">
    <p v-if="!links.length" class="hint">目前沒有{{ itemName }}。</p>
    <div v-for="(link, index) in links" :key="index" class="repeat-item">
      <div class="repeat-item__head">
        <span class="repeat-item__index">
          <b>{{ index + 1 }}</b>{{ link.label || `${itemName} ${index + 1}` }}
          <el-tag v-if="isExternalLink(link.href)" size="small" type="info">外部連結 ↗</el-tag>
        </span>
        <span v-if="!readOnly" class="site-links__actions">
          <el-button text size="small" :disabled="index === 0" :data-move-row="index" data-move-dir="-1" :aria-label="`上移「${link.label || `${itemName} ${index + 1}`}」`" @click="move(index, -1)">上移</el-button>
          <el-button text size="small" :disabled="index === links.length - 1" :data-move-row="index" data-move-dir="1" :aria-label="`下移「${link.label || `${itemName} ${index + 1}`}」`" @click="move(index, 1)">下移</el-button>
          <el-button text size="small" type="danger" :icon="Delete" :disabled="links.length <= (min ?? 0)" @click="remove(index)">移除</el-button>
        </span>
      </div>
      <div class="field-row">
        <el-form-item label="顯示文字" :error="link.label.trim() ? '' : '請填寫顯示文字'">
          <el-input v-model="link.label" maxlength="20" show-word-limit />
        </el-form-item>
        <el-form-item v-if="withEnglish" label="英文小字（選填）" :error="labelEnError(english(link).label_en ?? '') ?? ''">
          <el-input v-model="english(link).label_en" maxlength="40" placeholder="例如：Admission" />
        </el-form-item>
      </div>
      <el-form-item label="連結" :error="siteLinkError(link.href) ?? ''">
        <el-input v-model="link.href" placeholder="/admission、/#about 或 https://…" />
        <span class="field-help">站內頁面用 / 開頭的路徑；外部網站要用 https://，官網會標 ↗ 並另開分頁。</span>
      </el-form-item>
    </div>
    <el-button v-if="!readOnly" :icon="Plus" :disabled="links.length >= max" @click="add">
      新增{{ itemName }}（{{ links.length }} / {{ max }}）
    </el-button>
  </div>
</template>

<style scoped>
.site-links__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
</style>
