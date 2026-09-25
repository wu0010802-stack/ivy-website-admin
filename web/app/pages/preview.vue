<script setup lang="ts">
import type { DraftPreviewRender } from '~/composables/useDraftPreview'
import { taipeiToday } from '~/utils/news-content'
import {
  isPreviewEmbed,
  PREVIEW_MOBILE_HEIGHT,
  PREVIEW_MOBILE_WIDTH,
  previewDate,
  previewFrameSrc,
  previewPage,
  previewViewport,
  type PreviewViewport
} from '~/utils/draft-preview'

// 私有草稿預覽殼：整頁 client-only，SSR 完全不輸出任何內容或管理端
// 資料，避免管理 session cookie／草稿內容混進公開快取或搜尋引擎快照。
definePageMeta({ ssr: false })

useHead({
  meta: [{ name: 'robots', content: 'noindex, nofollow' }]
})

// ?page=admission 入學資訊頁、?page=campus&campus=<key> 分校頁、?page=visit
// 預約頁的同意說明，其餘預覽首頁。?viewport=mobile 用手機寬度看，?date= 換
// 判斷消息上下架的日期（參數規則在 utils/draft-preview.ts）。
const route = useRoute()
const router = useRouter()
const page = computed(() => previewPage(route.query))
const viewport = computed(() => previewViewport(route.query))
const embedded = computed(() => isPreviewEmbed(route.query))
const today = taipeiToday()
const date = computed(() => previewDate(route.query, today))
const frameSrc = computed(() => previewFrameSrc(route.query))
const mobileFrame = computed(() => viewport.value === 'mobile' && !embedded.value)

const status = ref<'checking' | 'denied' | 'ready'>('checking')
const render = ref<((date: string) => DraftPreviewRender) | null>(null)
const rendered = computed(() => (render.value ? render.value(date.value) : null))
const draft = computed(() => rendered.value?.content ?? null)
const hiddenNews = computed(() => rendered.value?.hiddenNews ?? [])
const previewCampus = computed(() => {
  const key = typeof route.query.campus === 'string' ? route.query.campus : ''
  return draft.value?.campuses.find((c) => c.key === key) ?? draft.value?.campuses[0] ?? null
})

function setQuery(patch: Record<string, string | undefined>) {
  void router.replace({ query: { ...route.query, ...patch } })
}

function setViewport(value: PreviewViewport) {
  setQuery({ viewport: value === 'mobile' ? 'mobile' : undefined })
}

function setDate(event: Event) {
  const value = (event.target as HTMLInputElement).value
  setQuery({ date: value && value !== today ? value : undefined })
}

onMounted(async () => {
  const result = await useDraftPreview()
  if (!result.authorized || !result.render) {
    status.value = 'denied'
    return
  }
  render.value = result.render
  status.value = 'ready'
})
</script>

<template>
  <div class="preview-shell">
    <div v-if="status === 'checking'" class="preview-notice">
      <p>正在確認管理身分…</p>
    </div>
    <div v-else-if="status === 'denied'" class="preview-notice">
      <p>這個頁面只給已登入的後台管理者看草稿內容。</p>
      <p>請先登入後台管理系統，再重新整理這一頁。</p>
    </div>
    <template v-else-if="draft">
      <div v-if="!embedded" class="preview-banner" role="note">
        <p>草稿預覽 · 尚未發布的內容，僅管理者可見</p>
        <div class="preview-tools">
          <div class="preview-switch" role="group" aria-label="預覽寬度">
            <button type="button" :aria-pressed="viewport === 'desktop'" @click="setViewport('desktop')">桌機</button>
            <button type="button" :aria-pressed="viewport === 'mobile'" @click="setViewport('mobile')">手機</button>
          </div>
          <label v-if="page === 'home'" class="preview-date">
            <span>以這天判斷消息上下架</span>
            <input type="date" :value="date" @change="setDate">
          </label>
        </div>
        <p v-if="page === 'home' && hiddenNews.length" class="preview-hidden">
          {{ date === today ? '今天' : date }}不會顯示 {{ hiddenNews.length }} 則：
          <span v-for="item in hiddenNews" :key="`${item.type}-${item.title}-${item.reason}`" class="preview-hidden__item">{{ item.type === 'event' ? '活動' : '消息' }}「{{ item.title }}」（{{ item.reason }}）</span>
        </p>
      </div>
      <div v-if="mobileFrame" class="preview-device">
        <iframe
          :key="frameSrc"
          :src="frameSrc"
          title="手機寬度預覽"
          :width="PREVIEW_MOBILE_WIDTH"
          :height="PREVIEW_MOBILE_HEIGHT"
        />
      </div>
      <template v-else>
        <SiteHeader :content="draft" />
        <AdmissionContent v-if="page === 'admission'" :admission="draft.admission" />
        <CampusPageMain v-else-if="page === 'campus' && previewCampus" :campus="previewCampus" />
        <main v-else-if="page === 'visit'" id="main" tabindex="-1">
          <div class="container breadcrumb"><NuxtLink to="/">首頁</NuxtLink> / 預約校園參觀</div>
          <BookingDraftPreview :booking="draft.booking" />
        </main>
        <main v-else id="main" tabindex="-1">
          <HeroVideo :hero="draft.home.hero" />
          <AboutSection :about="draft.home.about" />
          <DayExperience :day="draft.dayExperience" />
          <CampusBoard :board="draft.home.campusBoard" :campuses="draft.campuses" />
          <NewsDialog :news="draft.news" />
        </main>
        <SiteFooter :content="draft" />
      </template>
    </template>
  </div>
</template>

<style scoped>
.preview-notice {
  padding: 80px 24px;
  text-align: center;
  font-size: var(--fs-lg);
}
.preview-banner {
  position: sticky;
  top: 0;
  z-index: 999;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 8px 20px;
  background: var(--ivy-dev-bar);
  color: var(--ivy-dev-bar-text);
  text-align: center;
  padding: 8px 16px;
  font-size: var(--fs-sm);
}
.preview-banner p {
  margin: 0;
}
.preview-tools {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 8px 16px;
}
.preview-switch {
  display: inline-flex;
  border: 1px solid currentColor;
  border-radius: 999px;
  overflow: hidden;
}
.preview-switch button {
  min-height: 32px;
  padding: 0 14px;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.preview-switch button[aria-pressed='true'] {
  background: var(--ivy-dev-bar-text);
  color: var(--ivy-dev-bar);
}
.preview-date {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.preview-date input {
  min-height: 32px;
  font: inherit;
}
.preview-hidden {
  flex-basis: 100%;
}
.preview-hidden__item + .preview-hidden__item::before {
  content: '、';
}
.preview-device {
  display: flex;
  justify-content: center;
  padding: 24px 16px 48px;
  background: var(--cream);
}
.preview-device iframe {
  max-width: 100%;
  border: 1px solid var(--line);
  border-radius: 24px;
  background: var(--paper);
}
</style>
