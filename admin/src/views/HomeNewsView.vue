<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { Delete, Picture, Plus } from '@element-plus/icons-vue'
import { useContentItem } from '../composables/useContentItem'
import { useTitleFontCoverage } from '../composables/useTitleFontCoverage'
import type { HomeNewsPayload, MediaAssetOut, NewsArticlePayload, NewsEventPayload } from '../api/types'
import { CAMPUS_LABELS } from '../api/labels'
import { mediaFileUrl } from '../api/client'
import { websiteAssetUrl } from '../config'
import ContentEditor from '../components/ContentEditor.vue'
import MediaPickerDialog from '../components/MediaPickerDialog.vue'

// 上限與後端 HomeNewsPayload 相同（content/schemas.py）。
const MAX_ARTICLES = 30
const MAX_EVENTS = 12
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CAMPUS_OPTIONS = ['全校', ...Object.values(CAMPUS_LABELS).map((name) => `${name}校`)]

function isMediaId(image: string): boolean {
  return UUID_PATTERN.test(image)
}

// 同校園探索：素材庫 UUID 走後台媒體 API；舊示意消息的代號走官網靜態素材。
function previewUrl(image: string): string {
  return isMediaId(image) ? mediaFileUrl(image) : websiteAssetUrl(image)
}

function taipeiToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

function newId(prefix: string): string {
  // 後端要求同一清單內 id 不重複；同一毫秒連按兩次也不能撞號。
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

function newArticle(): NewsArticlePayload {
  return { id: newId('news'), date: taipeiToday(), campus: '全校', category: '', title: '', description: '', image: '', alt: '' }
}

function newEvent(): NewsEventPayload {
  return { id: newId('event'), date: taipeiToday(), campus: '全校', title: '', description: '' }
}

const editor = useContentItem<HomeNewsPayload>('home_news', { sample_note: '', articles: [], events: [] })
const missingGlyphs = useTitleFontCoverage()
const today = taipeiToday()

const articles = computed(() => editor.form.value.articles)
const events = computed(() => editor.form.value.events)
const isSample = computed(() => editor.form.value.sample_note.trim() !== '')

// 新增的放最上面：官網會依日期重新排序，這裡只是讓剛加的那則不用捲到底才找得到。
function addArticle() {
  editor.form.value.articles.unshift(newArticle())
}

function addEvent() {
  editor.form.value.events.unshift(newEvent())
}

function removeArticle(index: number) {
  editor.form.value.articles.splice(index, 1)
}

function removeEvent(index: number) {
  editor.form.value.events.splice(index, 1)
}

function clearSampleNote() {
  editor.form.value.sample_note = ''
}

const pickerVisible = ref(false)
const pickingIndex = ref<number | null>(null)

function pickImage(index: number) {
  pickingIndex.value = index
  pickerVisible.value = true
}

function onPickMedia(asset: MediaAssetOut) {
  const article = pickingIndex.value === null ? null : articles.value[pickingIndex.value]
  if (!article) return
  article.image = asset.id
  // 素材庫已經填了替代文字的話直接帶入，園方不用再打一次。
  if (!article.alt && asset.alt_text) article.alt = asset.alt_text
}

onMounted(editor.load)
</script>

<template>
  <ContentEditor :editor="editor">
    <template #lead>
      首頁「最新消息」與「近期活動」。官網上的消息依日期新到舊排列；活動只顯示今天以後的，
      <strong>日期過了會自動從官網下架</strong>。沒有消息時可以全部刪掉，官網會顯示「目前沒有新的消息」，
      不需要為了填滿版面放示意內容。
    </template>

    <el-form label-position="top" @submit.prevent>
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

      <div class="section__title" style="margin-top: 20px">
        <h2>最新消息</h2>
        <span class="hint">{{ articles.length }} / {{ MAX_ARTICLES }} 則</span>
      </div>
      <el-button :icon="Plus" :disabled="articles.length >= MAX_ARTICLES" @click="addArticle">新增一則消息</el-button>
      <p v-if="!articles.length" class="hint news-empty">目前沒有消息，官網會顯示「目前沒有新的消息」。</p>

      <div v-for="(article, index) in articles" :key="article.id" class="repeat-item news-item">
        <div class="repeat-item__head">
          <span class="repeat-item__index">
            <b>{{ index + 1 }}</b>
            {{ article.date || '日期未填' }}{{ article.title ? `・${article.title}` : '' }}
          </span>
          <el-button text size="small" type="danger" :icon="Delete" @click="removeArticle(index)">移除</el-button>
        </div>
        <div class="news-item__grid">
          <div class="news-item__photo">
            <button type="button" class="news-item__thumb" :aria-label="article.image ? '更換照片' : '從素材庫選擇照片'" @click="pickImage(index)">
              <img v-if="article.image" :src="previewUrl(article.image)" alt="" @error="($event.target as HTMLImageElement).style.visibility = 'hidden'" />
              <span v-else class="news-item__thumb-empty"><el-icon><Picture /></el-icon>選擇照片</span>
            </button>
            <span v-if="article.image && !isMediaId(article.image)" class="hint">官網內建示意照片</span>
          </div>
          <div>
            <div class="field-row">
              <el-form-item label="日期">
                <el-date-picker v-model="article.date" type="date" value-format="YYYY-MM-DD" format="YYYY-MM-DD" :clearable="false" style="width: 100%" />
              </el-form-item>
              <el-form-item label="校區">
                <el-select v-model="article.campus" filterable allow-create default-first-option>
                  <el-option v-for="option in CAMPUS_OPTIONS" :key="option" :label="option" :value="option" />
                </el-select>
              </el-form-item>
              <el-form-item label="分類">
                <el-input v-model="article.category" placeholder="例如：校園日常" />
              </el-form-item>
            </div>
            <el-form-item label="標題">
              <el-input v-model="article.title" />
              <p v-if="missingGlyphs(article.title).length" class="glyph-hint">
                官網標題字型沒有「{{ missingGlyphs(article.title).join('') }}」，這幾個字會以系統字顯示。可以換個說法，或請工程補字。
              </p>
            </el-form-item>
            <el-form-item label="內文">
              <el-input v-model="article.description" type="textarea" :autosize="{ minRows: 2, maxRows: 8 }" />
            </el-form-item>
            <el-form-item label="照片替代文字（給螢幕報讀器，描述照片內容）">
              <el-input v-model="article.alt" placeholder="例如：孩子在菜園裡澆水" />
            </el-form-item>
          </div>
        </div>
      </div>

      <div class="section__title" style="margin-top: 28px">
        <h2>近期活動</h2>
        <span class="hint">{{ events.length }} / {{ MAX_EVENTS }} 筆</span>
      </div>
      <el-button :icon="Plus" :disabled="events.length >= MAX_EVENTS" @click="addEvent">新增一筆活動</el-button>
      <p v-if="!events.length" class="hint news-empty">目前沒有活動，官網會顯示「目前沒有近期活動」。</p>

      <div v-for="(event, index) in events" :key="event.id" class="repeat-item">
        <div class="repeat-item__head">
          <span class="repeat-item__index">
            <b>{{ index + 1 }}</b>
            {{ event.date || '日期未填' }}{{ event.title ? `・${event.title}` : '' }}
            <el-tag v-if="event.date && event.date < today" size="small" type="info">已過，官網不顯示</el-tag>
          </span>
          <el-button text size="small" type="danger" :icon="Delete" @click="removeEvent(index)">移除</el-button>
        </div>
        <div class="field-row">
          <el-form-item label="日期">
            <el-date-picker v-model="event.date" type="date" value-format="YYYY-MM-DD" format="YYYY-MM-DD" :clearable="false" style="width: 100%" />
          </el-form-item>
          <el-form-item label="校區">
            <el-select v-model="event.campus" filterable allow-create default-first-option>
              <el-option v-for="option in CAMPUS_OPTIONS" :key="option" :label="option" :value="option" />
            </el-select>
          </el-form-item>
        </div>
        <el-form-item label="活動名稱">
          <el-input v-model="event.title" />
          <p v-if="missingGlyphs(event.title).length" class="glyph-hint">
            官網標題字型沒有「{{ missingGlyphs(event.title).join('') }}」，這幾個字會以系統字顯示。
          </p>
        </el-form-item>
        <el-form-item label="活動說明">
          <el-input v-model="event.description" type="textarea" :autosize="{ minRows: 1, maxRows: 4 }" />
        </el-form-item>
      </div>
    </el-form>

    <MediaPickerDialog v-model="pickerVisible" @select="onPickMedia" />
  </ContentEditor>
</template>

<style scoped>
.news-empty {
  margin: 12px 0 4px;
}

.news-item:first-of-type {
  margin-top: 12px;
}

.news-item__grid {
  display: grid;
  grid-template-columns: 180px minmax(0, 1fr);
  gap: 16px;
  align-items: start;
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
