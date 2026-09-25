<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useContentItem } from '../composables/useContentItem'
import type { HomeNewsPayload } from '../api/types'
import ContentEditor from '../components/ContentEditor.vue'
import NewsEntriesEditor from '../components/NewsEntriesEditor.vue'
import { NEWS_LIMITS, normalizeArticle, normalizeEvent } from '../composables/newsContent'

// 舊版消息沒有適用範圍、內文、推薦與活動時間：載入時換算成新欄位
// （跟後端讀舊版本的規則相同），再拍快照，才不會一打開就顯示有修改。
function normalize(payload: HomeNewsPayload): HomeNewsPayload {
  return {
    ...payload,
    articles: (payload.articles ?? []).map((a) => normalizeArticle(a as never)),
    events: (payload.events ?? []).map((e) => normalizeEvent(e as never)),
    home_display_count: payload.home_display_count ?? null,
  }
}

const editor = useContentItem<HomeNewsPayload>(
  'home_news',
  { sample_note: '', articles: [], events: [], home_display_count: null },
  undefined,
  { normalize },
)

const isSample = computed(() => editor.form.value.sample_note.trim() !== '')

function clearSampleNote() {
  editor.form.value.sample_note = ''
}

onMounted(editor.load)
</script>

<template>
  <ContentEditor :editor="editor">
    <template #lead>
      首頁「最新消息」與「近期活動」，適用全校或指定幾校（各校自己的消息在「分校頁 → 各校消息與活動」）。
      官網上的消息依日期新到舊排列；活動只顯示今天以後的，<strong>日期過了會自動從官網下架</strong>。
      每一則也可以設定上架、下架日期，時間到官網自動顯示或隱藏，不用再回來發布一次。
      沒有消息時可以全部刪掉，官網會顯示「目前沒有新的消息」，不需要為了填滿版面放示意內容。
    </template>

    <el-form label-position="top" :disabled="editor.readOnly.value" @submit.prevent>
      <el-alert
        v-if="isSample"
        type="warning"
        :closable="false"
        show-icon
        title="目前官網這一區標示為「示意內容」"
        style="margin-bottom: 16px"
      >
        換成真實的消息與活動後，把下方的示意說明清空，官網就不再標示「示意內容」。
        <el-button size="small" style="margin-left: 8px" @click="clearSampleNote">清空示意說明</el-button>
      </el-alert>
      <el-form-item label="示意說明（有內容時，官網在標題旁標示「示意內容」，並在區塊底部顯示這段文字）">
        <el-input v-model="editor.form.value.sample_note" type="textarea" :autosize="{ minRows: 1, maxRows: 3 }" placeholder="真實消息請留空" />
      </el-form-item>
      <el-form-item label="首頁最多輪播幾則消息（每次顯示 3 則）">
        <el-input-number
          v-model="editor.form.value.home_display_count"
          :min="1"
          :max="NEWS_LIMITS.displayCount"
          :value-on-clear="null"
          placeholder="全部"
          controls-position="right"
        />
        <span class="field-help">留空＝全部。「所有最新消息」清單不受這個限制。</span>
      </el-form-item>

      <NewsEntriesEditor
        :articles="editor.form.value.articles"
        :events="editor.form.value.events"
        mode="global"
        :max-articles="NEWS_LIMITS.homeArticles"
        :max-events="NEWS_LIMITS.homeEvents"
        :read-only="editor.readOnly.value"
      />
    </el-form>
  </ContentEditor>
</template>
