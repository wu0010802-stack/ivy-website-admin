<script setup lang="ts">
import { computed, ref, useId, useTemplateRef } from 'vue'
import { ArrowRight, Delete, Picture, Plus } from '@element-plus/icons-vue'
import type { CampusNewsArticlePayload, CampusNewsEventPayload, MediaAssetOut, NewsArticlePayload, NewsEventPayload } from '../api/types'
import { useTitleFontCoverage } from '../composables/useTitleFontCoverage'
import { IMAGE_HINTS } from '../composables/contentHints'
import { altAfterPick, isMediaId, useMediaThumbs } from '../composables/mediaThumbs'
import { moveKeepingFocus } from '../composables/moveKeepingFocus'
import {
  eventTimeError,
  newArticle,
  newCampusArticle,
  newCampusEvent,
  newEvent,
  revealListItem,
  scheduleInvalid,
  scheduleState,
  taipeiToday,
  useCollapsibleItems,
  webUrlError,
  NEWS_SECTION_IDS,
  type NewsMode,
} from '../composables/newsContent'
import LengthHint from './LengthHint.vue'
import MediaPickerDialog from './MediaPickerDialog.vue'
import NewsBodyEditor from './NewsBodyEditor.vue'
import ScopeField from './ScopeField.vue'

// 消息與活動清單的編輯（全站 home_news 與各校 campus_news 共用）。全站模式
// 多了適用校區與首頁推薦；各校模式的每一則都屬於目前選的校區。
const props = defineProps<{
  articles: (NewsArticlePayload | CampusNewsArticlePayload)[]
  events: (NewsEventPayload | CampusNewsEventPayload)[]
  mode: NewsMode
  maxArticles: number
  maxEvents: number
  campusKey?: string
  readOnly?: boolean
}>()

const missingGlyphs = useTitleFontCoverage()
const today = taipeiToday()
const isGlobal = computed(() => props.mode === 'global')
const featuredCount = computed(() => props.articles.filter((a) => (a as NewsArticlePayload).featured).length)

// 封面縮圖：素材庫照片載縮圖（讀不到退回原檔），舊示意消息的代號走官網靜態素材；
// 都讀不到時在框裡寫出來，不是只剩一個空白框。
const thumbs = useMediaThumbs()

function asGlobal<T>(entry: T): T & NewsArticlePayload & NewsEventPayload {
  return entry as T & NewsArticlePayload & NewsEventPayload
}

const articlesList = useTemplateRef<HTMLElement>('articlesList')
const eventsList = useTemplateRef<HTMLElement>('eventsList')

// 每一則有十幾個欄位，全部攤開頁面會長到七八千 px：預設收合成「日期・標題」一行，
// 點開才編輯。新增的、存檔錯誤指到的會自動展開（revealListItem／revealContentPath）。
const collapse = useCollapsibleItems()
const uid = useId()
const allArticlesOpen = computed(() => props.articles.length > 0 && props.articles.every((a) => collapse.isOpen(a.id)))
const allEventsOpen = computed(() => props.events.length > 0 && props.events.every((e) => collapse.isOpen(e.id)))
function toggleAll(ids: string[], open: boolean) {
  collapse.setMany(ids, open)
}

// 有內文或照片的消息重打很費工，移除前先問一次；只有標題摘要的照舊一按就移除。
function articleHasContent(article: NewsArticlePayload | CampusNewsArticlePayload): boolean {
  return Boolean(article.image) || article.body.length > 0
}

// 新增的放最上面：官網依日期排序（推薦的消息依這裡的順序），這裡只是讓剛加的
// 那則不用捲到底才找得到。加完捲過去並聚焦標題（日期已預填今天）。
function addArticle() {
  props.articles.unshift(isGlobal.value ? newArticle() : newCampusArticle())
  void revealListItem(articlesList.value, '[data-list-item="0"]', '.news-item__title input')
}

function addEvent() {
  props.events.unshift(isGlobal.value ? newEvent() : newCampusEvent())
  void revealListItem(eventsList.value, '[data-list-item="0"]', '.news-event__title input')
}

function moveArticle(index: number, delta: number) {
  void moveKeepingFocus(props.articles, index, delta, articlesList.value)
}

function onAllDayChange(event: CampusNewsEventPayload, allDay: boolean) {
  if (allDay) {
    event.start_time = null
    event.end_time = null
  }
}

const pickerVisible = ref(false)
const pickingIndex = ref<number | null>(null)

function pickImage(index: number) {
  pickingIndex.value = index
  pickerVisible.value = true
}

function onPickMedia(asset: MediaAssetOut) {
  const article = pickingIndex.value === null ? null : props.articles[pickingIndex.value]
  if (!article) return
  // 素材庫已經填了圖片說明的話直接帶入，園方不用再打一次；換成另一張時換成新照片的說明。
  article.alt = altAfterPick(article.alt, article.image, asset)
  article.image = asset.id
  thumbs.forget(asset.id)
}
</script>

<template>
  <div class="section__title" style="margin-top: 20px">
    <h2 :id="NEWS_SECTION_IDS.articles" data-section-anchor tabindex="-1">最新消息</h2>
    <span class="hint">{{ articles.length }} / {{ maxArticles }} 則</span>
  </div>
  <p v-if="isGlobal" class="hint news-lead">
    勾「首頁推薦」的消息會依這裡的順序在首頁輪播（可用上移、下移調整）；
    一則都沒勾時，首頁照舊依日期新到舊輪播全部消息。
    <template v-if="featuredCount">目前推薦 {{ featuredCount }} 則。</template>
  </p>
  <div class="news-toolbar">
    <el-button v-if="!readOnly" :icon="Plus" :disabled="articles.length >= maxArticles" @click="addArticle">新增一則消息</el-button>
    <el-button v-if="articles.length > 1" text size="small" @click="toggleAll(articles.map((a) => a.id), !allArticlesOpen)">
      {{ allArticlesOpen ? '全部收合' : '全部展開' }}
    </el-button>
  </div>
  <p v-if="!articles.length" class="hint news-empty">目前沒有消息。</p>

  <div ref="articlesList" data-list="articles">
  <div
    v-for="(article, index) in articles"
    :key="article.id"
    class="repeat-item news-item"
    :class="{ 'is-collapsed': !collapse.isOpen(article.id) }"
    :data-list-item="index"
    @list-item-reveal="collapse.expand(article.id)"
  >
    <div class="repeat-item__head">
      <button
        type="button"
        class="repeat-item__index repeat-item__toggle"
        :aria-expanded="collapse.isOpen(article.id)"
        :aria-controls="`${uid}-article-${article.id}`"
        @click="collapse.toggle(article.id)"
      >
        <el-icon class="repeat-item__caret" aria-hidden="true"><ArrowRight /></el-icon>
        <b>{{ index + 1 }}</b>
        {{ article.date || '日期未填' }}{{ article.title ? `・${article.title}` : '・標題未填' }}
        <el-tag v-if="isGlobal && asGlobal(article).featured" size="small" type="success">首頁推薦</el-tag>
        <el-tag v-if="scheduleState(article, today) === 'upcoming'" size="small" type="warning">{{ article.show_from }} 起顯示</el-tag>
        <el-tag v-else-if="scheduleState(article, today) === 'expired'" size="small" type="info">已下架，官網不顯示</el-tag>
        <!-- 收合時欄位底下的錯誤看不到，標題列先標出來。 -->
        <el-tag v-if="scheduleInvalid(article)" size="small" type="danger">有欄位要修改</el-tag>
      </button>
      <span v-if="!readOnly" class="cell-actions">
        <el-button text size="small" :disabled="index === 0" :data-move-row="index" data-move-dir="-1" :aria-label="`上移「${article.title || `第 ${index + 1} 則消息`}」`" @click="moveArticle(index, -1)">上移</el-button>
        <el-button text size="small" :disabled="index === articles.length - 1" :data-move-row="index" data-move-dir="1" :aria-label="`下移「${article.title || `第 ${index + 1} 則消息`}」`" @click="moveArticle(index, 1)">下移</el-button>
        <el-popconfirm
          v-if="articleHasContent(article)"
          :title="`移除「${article.title || `第 ${index + 1} 則消息`}」？內文和照片要重新填。`"
          confirm-button-text="移除"
          cancel-button-text="先不要"
          confirm-button-type="danger"
          width="260"
          @confirm="articles.splice(index, 1)"
        >
          <template #reference>
            <el-button text size="small" type="danger" :icon="Delete" class="remove-action">移除</el-button>
          </template>
        </el-popconfirm>
        <el-button v-else text size="small" type="danger" :icon="Delete" class="remove-action" @click="articles.splice(index, 1)">移除</el-button>
      </span>
    </div>
    <div v-show="collapse.isOpen(article.id)" :id="`${uid}-article-${article.id}`" class="news-item__grid">
      <div class="news-item__photo">
        <button
          type="button"
          class="news-item__thumb"
          :class="{ 'is-broken': article.image && thumbs.isBroken(article.image) }"
          :disabled="readOnly"
          :aria-label="article.image && thumbs.isBroken(article.image) ? '讀不到這張照片，請重新選擇' : article.image ? '更換照片' : '從素材庫選擇照片'"
          @click="pickImage(index)"
        >
          <span v-if="article.image && thumbs.isBroken(article.image)" class="news-item__thumb-empty news-item__thumb-broken">
            <el-icon><Picture /></el-icon>讀不到這張照片，請重新選擇
          </span>
          <img v-else-if="article.image" :src="thumbs.src(article.image)" alt="" loading="lazy" @error="thumbs.onError(article.image)" />
          <span v-else class="news-item__thumb-empty"><el-icon><Picture /></el-icon>選擇照片</span>
        </button>
        <span v-if="article.image && !isMediaId(article.image)" class="hint">官網內建示意照片</span>
        <span class="field-help">{{ IMAGE_HINTS.news }}</span>
      </div>
      <div class="news-item__fields">
        <div class="field-row">
          <el-form-item label="日期">
            <el-date-picker v-model="article.date" type="date" value-format="YYYY-MM-DD" format="YYYY-MM-DD" :clearable="false" style="width: 100%" />
          </el-form-item>
          <el-form-item label="分類">
            <el-input v-model="article.category" placeholder="例如：校園日常" />
          </el-form-item>
        </div>
        <template v-if="isGlobal">
          <ScopeField :entry="asGlobal(article)" />
          <el-form-item>
            <el-checkbox :model-value="asGlobal(article).featured" @update:model-value="asGlobal(article).featured = Boolean($event)">
              首頁推薦（首頁只輪播推薦的消息）
            </el-checkbox>
          </el-form-item>
        </template>
        <el-form-item label="標題">
          <el-input v-model="article.title" class="news-item__title" />
          <LengthHint :value="article.title" rule="newsTitle" />
          <p v-if="missingGlyphs(article.title).length" class="glyph-hint">
            官網標題字型沒有「{{ missingGlyphs(article.title).join('') }}」，這幾個字會以系統字顯示。可以換個說法，或請工程補字。
          </p>
        </el-form-item>
        <el-form-item label="摘要（卡片、清單與沒有內文時的詳細頁顯示）">
          <el-input v-model="article.description" type="textarea" :autosize="{ minRows: 2, maxRows: 6 }" />
          <LengthHint :value="article.description" rule="newsDescription" />
        </el-form-item>
        <el-form-item label="內文（選填，點開消息時顯示在摘要下面）">
          <NewsBodyEditor :blocks="article.body" :campus-key="campusKey" :read-only="readOnly" />
        </el-form-item>
        <el-form-item label="圖片說明（給看不到照片的人）">
          <el-input v-model="article.alt" type="textarea" :autosize="{ minRows: 1, maxRows: 4 }" placeholder="例如：孩子在菜園裡澆水" />
          <span class="field-help">描述照片裡看得到的內容；換照片時會換成素材庫裡新照片的說明。</span>
        </el-form-item>
        <div class="field-row">
          <el-form-item label="上架日期（選填）">
            <el-date-picker v-model="article.show_from" type="date" value-format="YYYY-MM-DD" format="YYYY-MM-DD" placeholder="發布後立即顯示" clearable style="width: 100%" />
          </el-form-item>
          <el-form-item label="下架日期（選填，當天仍顯示）" :error="scheduleInvalid(article) ? '下架日期不能早於上架日期' : ''">
            <el-date-picker v-model="article.show_until" type="date" value-format="YYYY-MM-DD" format="YYYY-MM-DD" placeholder="不自動下架" clearable style="width: 100%" />
          </el-form-item>
        </div>
      </div>
    </div>
  </div>
  </div>

  <div class="section__title" style="margin-top: 28px">
    <h2 :id="NEWS_SECTION_IDS.events" data-section-anchor tabindex="-1">近期活動</h2>
    <span class="hint">{{ events.length }} / {{ maxEvents }} 筆</span>
  </div>
  <div class="news-toolbar">
    <el-button v-if="!readOnly" :icon="Plus" :disabled="events.length >= maxEvents" @click="addEvent">新增一筆活動</el-button>
    <el-button v-if="events.length > 1" text size="small" @click="toggleAll(events.map((e) => e.id), !allEventsOpen)">
      {{ allEventsOpen ? '全部收合' : '全部展開' }}
    </el-button>
  </div>
  <p v-if="!events.length" class="hint news-empty">目前沒有活動。</p>

  <div ref="eventsList" data-list="events">
  <div
    v-for="(event, index) in events"
    :key="event.id"
    class="repeat-item"
    :class="{ 'is-collapsed': !collapse.isOpen(event.id) }"
    :data-list-item="index"
    @list-item-reveal="collapse.expand(event.id)"
  >
    <div class="repeat-item__head">
      <button
        type="button"
        class="repeat-item__index repeat-item__toggle"
        :aria-expanded="collapse.isOpen(event.id)"
        :aria-controls="`${uid}-event-${event.id}`"
        @click="collapse.toggle(event.id)"
      >
        <el-icon class="repeat-item__caret" aria-hidden="true"><ArrowRight /></el-icon>
        <b>{{ index + 1 }}</b>
        {{ event.date || '日期未填' }}{{ event.title ? `・${event.title}` : '・名稱未填' }}
        <el-tag v-if="event.date && event.date < today" size="small" type="info">已過，官網不顯示</el-tag>
        <el-tag v-else-if="scheduleState(event, today) === 'upcoming'" size="small" type="warning">{{ event.show_from }} 起顯示</el-tag>
        <el-tag v-else-if="scheduleState(event, today) === 'expired'" size="small" type="info">已下架，官網不顯示</el-tag>
        <el-tag v-if="scheduleInvalid(event) || webUrlError(event.link_url)" size="small" type="danger">有欄位要修改</el-tag>
      </button>
      <el-button v-if="!readOnly" text size="small" type="danger" :icon="Delete" @click="events.splice(index, 1)">移除</el-button>
    </div>
    <div v-show="collapse.isOpen(event.id)" :id="`${uid}-event-${event.id}`" class="news-event__body">
    <div class="field-row">
      <el-form-item label="日期">
        <el-date-picker v-model="event.date" type="date" value-format="YYYY-MM-DD" format="YYYY-MM-DD" :clearable="false" style="width: 100%" />
      </el-form-item>
      <el-form-item label="時間" :error="eventTimeError(event)">
        <div class="event-time">
          <el-checkbox v-model="event.all_day" @change="onAllDayChange(event, Boolean($event))">全天</el-checkbox>
          <template v-if="!event.all_day">
            <el-time-select v-model="event.start_time" start="07:00" end="21:00" step="00:15" placeholder="開始" aria-label="開始時間" />
            <el-time-select v-model="event.end_time" start="07:00" end="21:30" step="00:15" placeholder="結束（選填）" clearable aria-label="結束時間" />
          </template>
        </div>
      </el-form-item>
    </div>
    <ScopeField v-if="isGlobal" :entry="asGlobal(event)" />
    <el-form-item label="活動名稱">
      <el-input v-model="event.title" class="news-event__title" />
      <LengthHint :value="event.title" rule="eventTitle" />
      <p v-if="missingGlyphs(event.title).length" class="glyph-hint">
        官網標題字型沒有「{{ missingGlyphs(event.title).join('') }}」，這幾個字會以系統字顯示。
      </p>
    </el-form-item>
    <el-form-item label="活動說明">
      <el-input v-model="event.description" type="textarea" :autosize="{ minRows: 1, maxRows: 4 }" />
    </el-form-item>
    <el-form-item label="地點（選填）">
      <el-input v-model="event.location" maxlength="80" placeholder="例如：義華校 一樓大廳" />
    </el-form-item>
    <div class="field-row">
      <el-form-item label="相關連結（選填，例如報名表或活動詳情）" :error="webUrlError(event.link_url)">
        <el-input v-model="event.link_url" inputmode="url" placeholder="https://" />
      </el-form-item>
      <el-form-item label="連結文字">
        <el-input v-model="event.link_label" maxlength="20" placeholder="活動詳情" :disabled="readOnly || !event.link_url.trim()" />
      </el-form-item>
    </div>
    <div class="field-row">
      <el-form-item label="開始宣傳日期（選填）">
        <el-date-picker v-model="event.show_from" type="date" value-format="YYYY-MM-DD" format="YYYY-MM-DD" placeholder="發布後立即顯示" clearable style="width: 100%" />
      </el-form-item>
      <el-form-item label="提前下架日期（選填）" :error="scheduleInvalid(event) ? '下架日期不能早於上架日期' : ''">
        <el-date-picker v-model="event.show_until" type="date" value-format="YYYY-MM-DD" format="YYYY-MM-DD" placeholder="活動日過後自動下架" clearable style="width: 100%" />
      </el-form-item>
    </div>
    </div>
  </div>
  </div>

  <MediaPickerDialog v-model="pickerVisible" :campus-key="campusKey" @select="onPickMedia" />
</template>

<style scoped>
.news-lead {
  margin: 0 0 12px;
}

.news-empty {
  margin: 12px 0 4px;
}

.news-item:first-of-type {
  margin-top: 12px;
}

.repeat-item__head {
  flex-wrap: wrap;
}

.news-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.news-toolbar .el-button + .el-button {
  margin-left: 0;
}

/* 移除和下移之間多留一點距離，少一點誤點。 */
.cell-actions .remove-action {
  margin-left: 8px;
}

.news-item__grid {
  display: grid;
  grid-template-columns: 180px minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}

.news-item__fields {
  min-width: 0;
}

.news-item__photo {
  display: grid;
  gap: 6px;
}

.news-item__thumb {
  display: block;
  width: 100%;
  aspect-ratio: 1.55;
  padding: 0;
  border: 1px dashed var(--line);
  border-radius: 8px;
  overflow: hidden;
  background: var(--surface-2);
  cursor: pointer;
}

.news-item__thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.news-item__thumb-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  height: 100%;
  color: var(--ink-2);
  font-size: 13px;
}

/* 素材讀不到：比照版位的失效提示，用錯誤色把框和字標出來。 */
.news-item__thumb.is-broken {
  border-color: var(--el-color-danger);
}

.news-item__thumb-broken {
  padding: 8px;
  color: var(--el-color-danger);
  text-align: center;
  line-height: 1.4;
}

.event-time {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.event-time :deep(.el-select) {
  width: 132px;
}

.glyph-hint {
  margin: 6px 0 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--el-color-warning-dark-2);
}

@media (max-width: 720px) {
  .news-item__grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .news-item__photo {
    max-width: 240px;
  }
}
</style>
