<script setup lang="ts">
import type { DraftPreviewRender } from '~/composables/useDraftPreview'
import { taipeiToday } from '~/utils/news-content'
import {
  isLivePreview,
  isPreviewEmbed,
  PREVIEW_MOBILE_HEIGHT,
  PREVIEW_MOBILE_WIDTH,
  previewDate,
  previewFrameSrc,
  previewPage,
  previewViewport,
  type PreviewViewport
} from '~/utils/draft-preview'
import { createLiveReceiver, type HighlightHit, type LiveDraft, type LiveOverride, type LiveReceiver } from '~/utils/preview-live'
import { activatePreviewBlock, highlightPreview } from '~/utils/preview-highlight'

// 私有草稿預覽殼：整頁 client-only，SSR 完全不輸出任何內容或管理端
// 資料，避免管理 session cookie／草稿內容混進公開快取或搜尋引擎快照。
definePageMeta({ ssr: false })

useHead({
  meta: [{ name: 'robots', content: 'noindex, nofollow' }]
})

// ?page=admission 入學資訊頁、?page=privacy 隱私權政策、?page=visit
// 預約頁的同意說明、?page=curriculum 特色教學頁、?page=about 關於常春藤頁、?page=environment 常春藤環境頁（校園探索），其餘預覽首頁。?viewport=mobile 用手機寬度看，?date= 換
// 判斷消息上下架的日期（參數規則在 utils/draft-preview.ts）。
// ?embed=1&live=1：後台內容編輯頁右側的即時預覽（2026-10-06 方向 D）。後台把還沒存的表單
// 用 postMessage 傳進來，只放在這一頁的記憶體裡（不進網址、storage 或任何快取），蓋在已存
// 草稿上重畫；頁面也跟著訊息切換，不重新載入。
const route = useRoute()
const router = useRouter()
const live = isLivePreview(route.query)
const liveDraft = shallowRef<LiveDraft | null>(null)
const page = computed(() => liveDraft.value?.page ?? previewPage(route.query))
const viewport = computed(() => previewViewport(route.query))
const embedded = computed(() => isPreviewEmbed(route.query))
const today = taipeiToday()
const date = computed(() => previewDate(route.query, today))
const frameSrc = computed(() => previewFrameSrc(route.query))
const mobileFrame = computed(() => viewport.value === 'mobile' && !embedded.value)

const status = ref<'checking' | 'denied' | 'ready'>('checking')
const render = shallowRef<((date: string, live?: LiveOverride | null) => DraftPreviewRender) | null>(null)
let stopLive: (() => void) | null = null
let unmounted = false
// 這一則即時草稿畫不出來（畫面還停在上一個畫得出來的樣子）。showLiveDraft 開頭歸零，
// 失敗時回報 hit: 'failed'，並且不拿舊畫面去算框選。
let liveRenderFailed = false
// 已存草稿的區塊畫不出來（還沒有即時草稿時 onErrorCaptured 收到的錯）：錯誤照常往上丟，同時不送 ready。
let savedRenderFailed = false

// 錯誤只寫在這個 iframe 自己的 console：全站沒有轉送 console 或錯誤的回報，這裡也不外送。
function reportLiveFailure(error: unknown) {
  liveRenderFailed = true
  console.error('[preview] 這份還沒存的內容畫不出來，預覽停在上一個畫面', error)
}

// 打字打到一半的內容可能讓合併那一步丟錯（這裡是預覽頁自己的 render，onErrorCaptured 管不到）：
// 只有即時草稿造成的才吞，停在上一個畫得出來的畫面，不換成整頁錯誤畫面。已存草稿本身畫不出來
// （沒有即時草稿、或還沒有可停的畫面）照常丟出去，走原本的錯誤路徑，不能讓預覽欄空白還說自己好了。
let lastRendered: DraftPreviewRender | null = null
const rendered = computed(() => {
  if (!render.value) return null
  try {
    lastRendered = render.value(date.value, liveDraft.value)
  } catch (error) {
    if (!live || !liveDraft.value || !lastRendered) throw error
    reportLiveFailure(error)
  }
  return lastRendered
})
const draft = computed(() => rendered.value?.content ?? null)
const hiddenNews = computed(() => rendered.value?.hiddenNews ?? [])

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

// 套用一則即時草稿：先畫，再（首頁五校）切到那一校、等一幀，然後框出改到的位置並回報後台。
// 中途又來了新的一則就交給新的那則處理。這一則畫不出來時：回報 hit: 'failed'（和「畫好了但找不到位置」
// 的 none 分開），畫面停在上一個樣子，不切分頁、不框選（舊畫面上的位置沒有意義）。
async function showLiveDraft(next: LiveDraft, receiver: LiveReceiver) {
  liveRenderFailed = false
  liveDraft.value = next
  await nextTick()
  if (unmounted || liveDraft.value !== next) return
  if (liveRenderFailed) {
    receiver.applied(next.seq, 'failed')
    return
  }
  let hit: HighlightHit = 'none'
  try {
    if (activatePreviewBlock(document, next.focus)) await nextTick()
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    if (unmounted || liveDraft.value !== next) return
    if (!liveRenderFailed) hit = highlightPreview(document, next.focus)
  } catch (error) {
    // 框不出來就不框：草稿已經畫好，回報照送；錯誤只留在這個 iframe 裡（console），不往外傳。
    console.error('[preview] 框選改到的位置時出錯', error)
  }
  receiver.applied(next.seq, liveRenderFailed ? 'failed' : hit)
}

// 即時預覽裡點連結不換頁（預覽只看這一頁；iframe 的 sandbox 也不給換掉後台頁）。
function stayOnPreview(event: MouseEvent) {
  if (event.target instanceof Element && event.target.closest('a[href]')) event.preventDefault()
}

// 打字打到一半的內容可能讓某個區塊畫不出來：即時草稿造成的錯誤停在這裡（記在 console），
// 不換成整頁錯誤畫面；沒有即時草稿時（已存草稿的區塊畫不出來）照舊往上丟。
onErrorCaptured((error) => {
  if (!live) return undefined
  if (!liveDraft.value) {
    savedRenderFailed = true
    return undefined
  }
  reportLiveFailure(error)
  return false
})

onMounted(async () => {
  const result = await useDraftPreview()
  if (unmounted) return
  const receiver: LiveReceiver | null = live
    ? createLiveReceiver({ self: window, campusKeys: result.campusKeys, onDraft: (next) => void showLiveDraft(next, receiver!) })
    : null
  if (!result.authorized || !result.render) {
    status.value = 'denied'
    receiver?.denied()
    return
  }
  render.value = result.render
  status.value = 'ready'
  if (!receiver) return
  await nextTick()
  // 已存草稿畫不出來（空白，或取內容時丟錯，錯誤走原本的路徑）就不送 ready、不收訊息：
  // 後台等不到 ready 會退回「上次儲存的草稿」，不會把空白的預覽說成即時。
  if (unmounted || savedRenderFailed || !draft.value) return
  // 拿到授權、畫好之後才開始收訊息。
  const onMessage = (event: MessageEvent) => receiver.handle(event)
  window.addEventListener('message', onMessage)
  document.addEventListener('click', stayOnPreview, true)
  stopLive = () => {
    window.removeEventListener('message', onMessage)
    document.removeEventListener('click', stayOnPreview, true)
  }
  receiver.ready()
})

onBeforeUnmount(() => {
  unmounted = true
  stopLive?.()
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
        <CurriculumContent v-else-if="page === 'curriculum'" :page="draft.curriculumPage" />
        <AboutContent v-else-if="page === 'about'" :campuses="draft.campuses" :page="draft.aboutPage" />
        <EnvironmentContent v-else-if="page === 'environment'" :campuses="draft.campuses" />
        <PrivacyPolicyContent v-else-if="page === 'privacy' && draft.privacyPolicy" :policy="draft.privacyPolicy" />
        <main v-else-if="page === 'privacy'" id="main" tabindex="-1">
          <div class="container breadcrumb">還沒有儲存過隱私權政策的草稿，請先在後台儲存。</div>
        </main>
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

<style>
/* 即時預覽：後台改到的那一格（找得到文字時）或那一塊。黃框＋外圈深色，淺色與深色底都看得到；
   顏色用預覽工具列同一組 token。 */
.preview-live-hit {
  outline: 3px solid var(--ivy-dev-bar-text);
  outline-offset: 3px;
  box-shadow: 0 0 0 9px var(--ivy-dev-bar);
}
</style>
