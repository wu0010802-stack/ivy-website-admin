<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { api, BASE_URL } from '../api/client'
import { apiErrorMessage } from '../api/errors'
import { campusLabel, formatDateTime } from '../api/labels'
import type { FacebookImportOut, FacebookPostListOut, FacebookPostOut } from '../api/types'
import CampusSelect from '../components/CampusSelect.vue'
import PageHeader from '../components/PageHeader.vue'
import { notifyError, notifyWarning } from '../composables/notify'
import { useCampusScope } from '../composables/useCampusScope'
import { usePermissions } from '../composables/usePermissions'

// 各校粉專同步進來的貼文（docs/specs/2026-10-28-facebook-news-sync-design.md）：
// 挑要放上官網的轉成該校消息草稿，其餘略過。發布照舊在「各校消息與活動」。
// WEBSITE_INSTAGRAM_ENABLED 開著時，粉專連結的 Instagram 貼文也進同一個收件匣
// （docs/specs/2026-11-12-external-integrations-design.md §2）：標來源、可依來源篩選、
// 同步狀態多一行；學校常同一篇兩邊都發，會出現兩則，由人略過一則，不做自動去重。
type Status = 'new' | 'imported' | 'dismissed'
const STATUS_LABELS: Record<Status, string> = { new: '未處理', imported: '已轉成消息', dismissed: '已略過' }
type Source = 'all' | 'facebook' | 'instagram'
const SOURCE_LABELS: Record<Source, string> = { all: '全部', facebook: 'Facebook', instagram: 'Instagram' }

const route = useRoute()
const router = useRouter()
const { visibleCampusKeys, selected } = useCampusScope()
const { can } = usePermissions()
const canManage = computed(() => can('content.manage'))

const linked = route.query.campus
const campus = ref(typeof linked === 'string' && visibleCampusKeys.value.includes(linked) ? linked : selected.value)
const status = ref<Status>('new')
const source = ref<Source>('all')
const data = ref<FacebookPostListOut | null>(null)
const loading = ref(false)
const loadError = ref<string | null>(null)
const syncing = ref(false)
// 正在轉成消息或略過的那一則；同時只處理一則，避免連點。
const busyId = ref<string | null>(null)
const expanded = ref(new Set<string>())
const brokenPictures = ref(new Set<string>())
// video：影片貼文的影片有沒有一起放進消息內文；沒帶進來時是後端給的原因（太大、太長、格式不合）。
const lastImported = ref<{ campus: string; title: string; videoIncluded: boolean; videoSkipped: string | null } | null>(null)

const intervalText = computed(() => {
  const seconds = data.value?.sync_seconds ?? 3600
  return seconds % 3600 === 0 ? `每 ${seconds / 3600} 小時` : `每 ${Math.round(seconds / 60)} 分鐘`
})

// 沒開 Instagram 時頁面跟以前一樣；已經收進來的 Instagram 貼文（之後才關掉開關）照樣標出來源。
const showSources = computed(
  () => !!data.value && (data.value.instagram_enabled || data.value.posts.some((post) => post.source === 'instagram')),
)
const lead = computed(
  () => `這一校 Facebook 粉專${data.value?.instagram_enabled ? '與 Instagram ' : ''}最近的貼文。按「轉成消息草稿」會把照片收進素材庫（影片貼文連影片一起）、在這校的消息最上面加一則草稿，檢查標題與照片說明後，照平常的方式送審或發布。`,
)
const instagram = computed(() => (data.value?.instagram_enabled ? data.value.sync?.instagram ?? null : null))
const instagramLine = computed(() => {
  const ig = instagram.value
  if (!ig?.last_attempt_at) return 'Instagram：還沒同步過。'
  if (!ig.last_success_at) return 'Instagram：還沒同步成功過。'
  return `Instagram：上次同步 ${formatDateTime(ig.last_success_at)}，讀到 ${ig.last_count ?? 0} 則貼文。`
})
// 失敗訊息是後端固定的說法（app/facebook/sync.py）；怎麼辦照原因分。Facebook 那一段不受影響。
const instagramHint = computed(() => {
  const error = instagram.value?.last_error ?? ''
  const todo = error.includes('專業帳號')
    ? '請先把 Instagram 轉成專業帳號並連結到這個 Facebook 粉專。'
    : error.includes('Instagram 權限')
      ? '請技術人員重新授權：在 Meta 的 Graph API 測試工具加上 instagram_basic 權限，再換新的粉專權杖。'
      : '請技術人員檢查 Meta 的設定。'
  return `${error}。${todo}Facebook 貼文不受影響。`
})

function pictureUrl(post: FacebookPostOut): string {
  return `${BASE_URL}/admin/facebook-posts/${post.id}/picture`
}

async function load() {
  if (!campus.value) return
  loading.value = true
  loadError.value = null
  const key = campus.value
  try {
    const sourceQuery = source.value === 'all' ? '' : `&source=${source.value}`
    const result = await api.get<FacebookPostListOut>(
      `/admin/facebook-posts?campus_key=${encodeURIComponent(key)}&status=${status.value}${sourceQuery}`,
    )
    // 載入途中換了校區：丟掉舊的回應。
    if (key === campus.value) data.value = result
  } catch (err) {
    loadError.value = apiErrorMessage(err, '讀不到貼文，請重新載入')
  } finally {
    loading.value = false
  }
}

watch([campus, status, source], ([key], [previous]) => {
  // 換校區就回到「全部」（那一校可能沒開 Instagram，沒有篩選可以選回來）；source 一變會再進來載入一次。
  if (previous !== undefined && key !== previous && source.value !== 'all') {
    source.value = 'all'
    return
  }
  expanded.value = new Set()
  void load()
}, { immediate: true })

// 目前的校區寫在網址 ?campus=，重新整理或分享連結都停在同一校。
watch(campus, (key) => {
  lastImported.value = null
  if (key && route.query.campus !== key) void router.replace({ query: { ...route.query, campus: key } })
}, { immediate: true })

async function syncNow() {
  syncing.value = true
  try {
    const result = await api.post<FacebookPostListOut>('/admin/facebook-posts/sync', { campus_key: campus.value })
    // 回應是這校「全部來源」的未處理貼文。
    if (status.value !== 'new') status.value = 'new'
    if (source.value !== 'all') source.value = 'all'
    data.value = result
    const ig = result.instagram_enabled ? result.sync?.instagram : null
    if (result.sync?.last_error) notifyWarning(`同步失敗：${result.sync.last_error}`)
    else ElMessage.success(`已同步，粉專最近 ${result.sync?.last_count ?? 0} 則貼文${ig && !ig.last_error ? `，Instagram 最近 ${ig.last_count ?? 0} 則貼文` : ''}`)
    if (ig?.last_error) notifyWarning(`Instagram 同步失敗：${ig.last_error}`)
  } catch (err) {
    notifyError(apiErrorMessage(err, '同步失敗，請稍後再試'))
  } finally {
    syncing.value = false
  }
}

async function importPost(post: FacebookPostOut) {
  busyId.value = post.id
  try {
    const result = await api.post<FacebookImportOut>(`/admin/facebook-posts/${post.id}/import`)
    lastImported.value = {
      campus: post.campus_key,
      title: result.article_title,
      videoIncluded: result.video_included ?? false,
      videoSkipped: result.video_skipped_reason ?? null,
    }
    ElMessage.success('已加到消息草稿')
    await load()
  } catch (err) {
    notifyError(apiErrorMessage(err, '轉成消息失敗，請稍後再試'))
  } finally {
    busyId.value = null
  }
}

async function setStatus(post: FacebookPostOut, action: 'dismiss' | 'restore') {
  busyId.value = post.id
  try {
    await api.post<FacebookPostOut>(`/admin/facebook-posts/${post.id}/${action}`)
    await load()
  } catch (err) {
    notifyError(apiErrorMessage(err, '沒有成功，請重新整理後再試'))
  } finally {
    busyId.value = null
  }
}

function isLong(post: FacebookPostOut): boolean {
  const text = post.message ?? ''
  return text.length > 160 || text.split('\n').length > 5
}

function toggle(id: string) {
  const next = new Set(expanded.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expanded.value = next
}

function markBroken(id: string) {
  brokenPictures.value = new Set(brokenPictures.value).add(id)
}
</script>

<template>
  <div class="page page--narrow">
    <PageHeader :lead="lead">
      <template #actions>
        <CampusSelect v-model="campus" class="fb-campus" :keys="visibleCampusKeys" />
        <el-button
          v-if="canManage && data?.configured"
          :loading="syncing"
          :disabled="loading"
          @click="syncNow"
        >立即同步</el-button>
      </template>
    </PageHeader>

    <p v-if="visibleCampusKeys.length === 0" class="hint">你的帳號沒有可看的校區。</p>

    <el-alert v-else-if="loadError && !data" type="error" :closable="false" show-icon :title="loadError">
      <el-button :loading="loading" @click="load()">重新載入</el-button>
    </el-alert>
    <el-skeleton v-else-if="loading && !data" animated :rows="6" />

    <template v-else-if="data">
      <el-empty
        v-if="!data.configured"
        class="fb-empty"
        :description="`${campusLabel(campus)}還沒接上 Facebook 粉專。要先在 Meta Business Manager 把粉專授權給官網，再請技術人員在部署平台加上設定。`"
      />
      <template v-else>
        <!-- 寫成一行：分行的話逗號和「之後」中間會多一個空白。 -->
        <p class="fb-sync hint" role="status">{{ data.sync?.last_success_at ? `上次同步 ${formatDateTime(data.sync.last_success_at)}，` : '還沒同步過，' }}之後{{ intervalText }}自動同步一次。</p>
        <el-alert
          v-if="data.sync?.last_error"
          type="warning"
          :closable="false"
          show-icon
          :title="`最近一次同步失敗（${formatDateTime(data.sync.last_attempt_at)}）`"
          :description="`${data.sync.last_error}。權杖過期或粉專權限被移除時會這樣，請技術人員檢查 Meta 的設定。`"
        />
        <p v-if="data.instagram_enabled" class="fb-sync-ig hint" role="status">{{ instagramLine }}</p>
        <el-alert
          v-if="instagram?.last_error"
          class="fb-ig-error"
          type="warning"
          :closable="false"
          show-icon
          :title="`Instagram 最近一次同步失敗（${formatDateTime(instagram.last_attempt_at)}）`"
          :description="instagramHint"
        />
        <el-alert v-if="lastImported" type="success" :closable="true" show-icon class="fb-imported" @close="lastImported = null">
          <template #title>
            「{{ lastImported.title }}」已加到{{ campusLabel(lastImported.campus) }}的消息草稿，官網還看不到。
            <router-link :to="{ path: '/content/campus-news', query: { campus: lastImported.campus } }">去檢查並發布</router-link>
          </template>
          <template v-if="lastImported.videoIncluded">影片也放進內文了。轉檔要幾分鐘，轉好之後才能發布。</template>
          <template v-else-if="lastImported.videoSkipped">影片沒有帶進來（{{ lastImported.videoSkipped }}）。要放影片的話，請到這則消息的內文自己加。</template>
        </el-alert>

        <div class="fb-filters">
          <el-radio-group v-if="data.instagram_enabled" v-model="source" class="fb-sources" aria-label="貼文來源">
            <el-radio-button v-for="(label, key) in SOURCE_LABELS" :key="key" :value="key">{{ label }}</el-radio-button>
          </el-radio-group>
          <el-radio-group v-model="status" class="fb-tabs" aria-label="貼文狀態">
            <el-radio-button v-for="(label, key) in STATUS_LABELS" :key="key" :value="key">
              {{ label }} {{ data.counts[key] }}
            </el-radio-button>
          </el-radio-group>
        </div>

        <p v-if="!data.posts.length" class="hint fb-none">
          {{ status === 'new' ? '沒有未處理的貼文。' : `沒有${STATUS_LABELS[status]}的貼文。` }}
        </p>
        <ul v-else class="fb-list" :aria-busy="loading">
          <li v-for="post in data.posts" :key="post.id" class="panel fb-post" :data-post="post.id">
            <div class="fb-post__picture">
              <img
                v-if="post.has_picture && !brokenPictures.has(post.id)"
                :src="pictureUrl(post)"
                alt=""
                loading="lazy"
                @error="markBroken(post.id)"
              >
              <span v-else class="fb-post__no-picture">{{ post.has_picture ? '照片載入失敗' : '沒有照片' }}</span>
              <el-tag v-if="post.has_video" class="fb-post__video" type="info" effect="dark" size="small">影片</el-tag>
            </div>
            <div class="fb-post__body">
              <div class="fb-post__meta">
                <el-tag v-if="showSources" class="fb-post__source" size="small" effect="plain" type="info">{{ SOURCE_LABELS[post.source] }}</el-tag>
                <time :datetime="post.posted_at">{{ formatDateTime(post.posted_at) }}</time>
                <a v-if="post.permalink_url" :href="post.permalink_url" target="_blank" rel="noopener noreferrer">在 {{ SOURCE_LABELS[post.source] }} 看 ↗</a>
              </div>
              <p class="fb-post__message" :class="{ 'is-clamped': isLong(post) && !expanded.has(post.id) }">{{ post.message || '（沒有文字）' }}</p>
              <el-button v-if="isLong(post)" text size="small" @click="toggle(post.id)">
                {{ expanded.has(post.id) ? '收起' : '看全文' }}
              </el-button>
              <div v-if="canManage" class="fb-post__actions">
                <template v-if="post.status !== 'imported'">
                  <el-button
                    type="primary"
                    :disabled="!post.has_picture || (busyId !== null && busyId !== post.id)"
                    :loading="busyId === post.id"
                    @click="importPost(post)"
                  >轉成消息草稿</el-button>
                  <el-button
                    v-if="post.status === 'new'"
                    :disabled="busyId !== null"
                    @click="setStatus(post, 'dismiss')"
                  >略過</el-button>
                  <el-button
                    v-else
                    :disabled="busyId !== null"
                    @click="setStatus(post, 'restore')"
                  >放回未處理</el-button>
                  <span v-if="!post.has_picture" class="hint">沒有照片的貼文不能轉成消息（消息一定要有一張照片）</span>
                </template>
                <span v-else class="hint">
                  {{ formatDateTime(post.handled_at) }} 已轉成消息
                  <router-link :to="{ path: '/content/campus-news', query: { campus: post.campus_key } }">到各校消息</router-link>
                </span>
              </div>
            </div>
          </li>
        </ul>
      </template>
    </template>
  </div>
</template>

<style scoped>
/* 頁首動作區的寬度跟著內容走：沒接粉專的分校沒有「立即同步」鈕，下拉不給寬度會縮到只剩箭頭。
   寬度比照參觀場次頁的校區下拉。 */
.fb-campus.el-select { width: 160px; }

.fb-sync {
  margin: 0 0 12px;
}

/* Instagram 同步狀態緊接在 Facebook 那一行下面。 */
.fb-sync-ig {
  margin: -6px 0 12px;
}

.fb-ig-error {
  margin-bottom: 12px;
}

.fb-imported {
  margin-top: 12px;
}

/* 來源與狀態兩組篩選：寬度不夠就換行。 */
.fb-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 12px;
}

.fb-none {
  margin-top: 16px;
}

.fb-list {
  list-style: none;
  margin: 16px 0 0;
  padding: 0;
  display: grid;
  gap: 12px;
}

.fb-post {
  display: grid;
  grid-template-columns: 160px minmax(0, 1fr);
  gap: 16px;
  padding: 16px;
  margin: 0;
}

.fb-post__picture {
  position: relative;
  aspect-ratio: 4 / 3;
  border-radius: 6px;
  overflow: hidden;
  background: var(--el-fill-color-light);
  display: grid;
  place-items: center;
}

.fb-post__picture img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

/* 影片貼文的照片是影片的某一格，角落標出來。 */
.fb-post__video {
  position: absolute;
  left: 8px;
  bottom: 8px;
}

.fb-post__no-picture {
  color: var(--ink-2);
  font-size: var(--text-sm);
}

.fb-post__meta {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  color: var(--ink-2);
  font-size: var(--text-sm);
}

.fb-post__message {
  margin: 8px 0 0;
  white-space: pre-line;
  overflow-wrap: anywhere;
  color: var(--ink);
}

.fb-post__message.is-clamped {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 5;
  line-clamp: 5;
  overflow: hidden;
}

.fb-post__actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 12px;
}

@media (max-width: 640px) {
  .fb-post {
    grid-template-columns: minmax(0, 1fr);
  }

  /* 手機上沒有照片時不用佔一整張照片的高度。 */
  .fb-post__picture:has(.fb-post__no-picture) {
    aspect-ratio: auto;
    padding: 12px;
  }
}

/* 頁首在 720px 以下改直排（PageHeader），下拉跟「立即同步」一樣佔滿一行。 */
@media (max-width: 720px) {
  .fb-campus.el-select { width: 100%; }
}
</style>
