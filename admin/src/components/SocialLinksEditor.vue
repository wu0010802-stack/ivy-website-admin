<script setup lang="ts">
import { useTemplateRef } from 'vue'
import { Delete, Plus } from '@element-plus/icons-vue'
import type { SocialLinkPayload } from '../api/types'
import { moveKeepingFocus } from '../composables/moveKeepingFocus'
import { revealListItem } from '../composables/newsContent'
import { SOCIAL_PLATFORMS, socialDuplicateIndex, socialUrlError } from '../composables/siteLinks'

// 機構社群（全站設定）的清單編輯：平台、顯示名稱、網址、排序（上移／下移按鈕，鍵盤可操作）。
// 直接修改傳入的陣列（同 SiteLinksEditor）。網址邊打邊檢查，規則同後端 SocialLinkPayload。
const props = defineProps<{
  links: SocialLinkPayload[]
  max: number
  readOnly?: boolean
}>()

const root = useTemplateRef<HTMLElement>('root')
const platformLabel = (platform: string) => SOCIAL_PLATFORMS.find((p) => p.value === platform)?.label ?? platform
const example = (platform: string) => SOCIAL_PLATFORMS.find((p) => p.value === platform)?.example ?? 'https://…'
const itemTitle = (link: SocialLinkPayload, index: number) => link.label.trim() || `${platformLabel(link.platform)} ${index + 1}`

function move(index: number, delta: number) {
  void moveKeepingFocus(props.links, index, delta, root.value)
}

// 新的一個加在最後（新增鈕在清單下方），加完捲過去並聚焦第一個欄位。
function add() {
  props.links.push({ platform: 'facebook', label: '', url: '' })
  void revealListItem(root.value, `[data-list-item="${props.links.length - 1}"]`)
}

function remove(index: number) {
  props.links.splice(index, 1)
}

// 網址欄的錯誤：格式不對，或和前面某一個重複。
function urlError(index: number): string {
  const link = props.links[index]!
  const format = socialUrlError(link.url)
  if (format) return format
  const duplicate = socialDuplicateIndex(props.links, index)
  return duplicate >= 0 ? `和第 ${duplicate + 1} 個的網址重複` : ''
}
</script>

<template>
  <div ref="root" class="social-links" data-list="social_links">
    <p v-if="!links.length" class="hint">目前沒有機構社群，官網不顯示機構社群這一區。</p>
    <div v-for="(link, index) in links" :key="index" class="repeat-item" :data-list-item="index">
      <div class="repeat-item__head">
        <span class="repeat-item__index"><b>{{ index + 1 }}</b>{{ itemTitle(link, index) }}</span>
        <span v-if="!readOnly" class="social-links__actions">
          <el-button text size="small" :disabled="index === 0" :data-move-row="index" data-move-dir="-1" :aria-label="`上移「${itemTitle(link, index)}」`" @click="move(index, -1)">上移</el-button>
          <el-button text size="small" :disabled="index === links.length - 1" :data-move-row="index" data-move-dir="1" :aria-label="`下移「${itemTitle(link, index)}」`" @click="move(index, 1)">下移</el-button>
          <el-button text size="small" type="danger" :icon="Delete" :aria-label="`移除「${itemTitle(link, index)}」`" @click="remove(index)">移除</el-button>
        </span>
      </div>
      <div class="field-row">
        <el-form-item label="平台">
          <el-select v-model="link.platform" data-field="platform" :aria-label="`第 ${index + 1} 個社群的平台`">
            <el-option v-for="platform in SOCIAL_PLATFORMS" :key="platform.value" :label="platform.label" :value="platform.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="顯示名稱" :error="link.label.trim() ? '' : '請填寫顯示名稱'">
          <el-input v-model="link.label" data-field="label" maxlength="20" show-word-limit :placeholder="`例如：${platformLabel(link.platform)} 官方帳號`" />
        </el-form-item>
      </div>
      <el-form-item label="網址" :error="urlError(index)">
        <el-input v-model="link.url" data-field="url" inputmode="url" :placeholder="example(link.platform)" />
      </el-form-item>
    </div>
    <el-button v-if="!readOnly" :icon="Plus" :disabled="links.length >= max" @click="add">
      新增社群連結（{{ links.length }} / {{ max }}）
    </el-button>
  </div>
</template>

<style scoped>
.social-links {
  margin-top: 12px;
}

.social-links__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
</style>
