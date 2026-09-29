<script setup lang="ts">
import { ref, useTemplateRef } from 'vue'
import { useContentItem } from '../composables/useContentItem'
import { useCampusContent } from '../composables/useCampusContent'
import type { CampusNewsPayload } from '../api/types'
import ContentEditor from '../components/ContentEditor.vue'
import CampusSelect from '../components/CampusSelect.vue'
import NewsEntriesEditor from '../components/NewsEntriesEditor.vue'
import { NEWS_LIMITS, normalizeCampusArticle, normalizeCampusEvent } from '../composables/newsContent'

// 各校自己的消息與活動（campus_news）：分校管理者與內容編輯只能編自己校，
// 官網和全站消息合併顯示。跨校與首頁推薦由總部在「最新消息與活動」決定。
function normalize(payload: CampusNewsPayload): CampusNewsPayload {
  return {
    articles: (payload.articles ?? []).map((a) => normalizeCampusArticle(a as never)),
    events: (payload.events ?? []).map((e) => normalizeCampusEvent(e as never)),
  }
}

const campus = ref('')
const editor = useContentItem<CampusNewsPayload>('campus_news', { articles: [], events: [] }, campus, { normalize })
const shell = useTemplateRef<InstanceType<typeof ContentEditor>>('shell')
const { visibleCampusKeys } = useCampusContent(editor, campus, shell)
</script>

<template>
  <ContentEditor
    ref="shell"
    :editor="editor"
    :placeholder="visibleCampusKeys.length === 0 ? '你的帳號沒有可編輯的校區。' : undefined"
  >
    <template #lead>
      這一校自己的消息與活動，發布後和全站消息一起出現在官網首頁的「最新消息」「近期活動」，並標上校名。
      要放上首頁輪播的推薦消息、或同時適用好幾校的消息，請總部在「首頁 → 最新消息與活動」發布。
    </template>
    <template #toolbar>
      <CampusSelect v-model="campus" :keys="visibleCampusKeys" />
    </template>

    <el-form label-position="top" :disabled="editor.readOnly.value" @submit.prevent>
      <NewsEntriesEditor
        :articles="editor.form.value.articles"
        :events="editor.form.value.events"
        mode="campus"
        :campus-key="campus"
        :max-articles="NEWS_LIMITS.campusArticles"
        :max-events="NEWS_LIMITS.campusEvents"
        :read-only="editor.readOnly.value"
      />
    </el-form>
  </ContentEditor>
</template>
