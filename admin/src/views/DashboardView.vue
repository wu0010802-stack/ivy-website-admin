<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { api } from '../api/client'
import { attentionListPath, campusLabel, campusLabels, contentEditorPath, contentItemLabel, formatDateTime, formatHoldRemaining, formatTime } from '../api/labels'
import { usePermissions } from '../composables/usePermissions'
import { canOpenPath } from '../router/nav'
import { useAuthStore } from '../stores/auth'
import { useOpenRequestsStore } from '../stores/openRequests'

interface TodayVisit {
  id: string
  parent_name: string
  campus_key: string
  start_time: string
  end_time: string
}

// 最新一版還沒上官網的內容項（從未發布，或發布後又存了新草稿）。
interface PendingPublishItem {
  kind: string
  campus_key: string | null
  latest_version: number
  published_version: number | null
  updated_at: string | null
}

// 官網上或最新草稿引用的素材已被刪除（missing）或還沒處理好（not_ready）。
interface MediaIssue {
  kind: string
  campus_key: string | null
  missing: number
  not_ready: number
  /** 官網上的版本就有問題（家長看到破圖或備用圖）；否則只有草稿有問題 */
  live: boolean
}

// 排程到點沒有發布（檢查不過），而且之後還沒有人發布過這項內容。
interface FailedPublishJob {
  id: string
  kind: string
  campus_key: string | null
  revision_version: number
  publish_at: string
  error: string | null
}

interface DashboardSummary {
  today_visits: number
  today_visit_list?: TodayVisit[]
  new_requests?: number
  awaiting_confirmation?: number
  next_hold_expires_at?: string | null
  pending_reschedule_requests?: number
  needs_attention?: number
  pending_follow_up: number
  pending_publish: number
  pending_publish_kinds?: string[]
  pending_publish_items?: PendingPublishItem[]
  content_media_issues?: MediaIssue[]
  failed_publish_jobs?: FailedPublishJob[]
  pending_review?: number
  campuses_without_active_booking: string[]
  // 開放家長選時段，但官網現在沒有任何可預約的場次（2026-09-25 起）。
  campuses_slots_without_openings?: string[]
  failed_notifications: number
}

interface PendingReview { kind: string; campus_key: string | null; revision_id: string; submitted_by_email: string | null }
const reviews = ref<PendingReview[]>([])

const authStore = useAuthStore()
const openRequests = useOpenRequestsStore()
const { can } = usePermissions()
const summary = ref<DashboardSummary | null>(null)
const loading = ref(true)
const error = ref<string | null>(null)

// 總覽上的連結只放點得進去的（第 27 條）：進不去的頁面會被導回總覽本身，
// 看起來像按了沒反應。櫃台進不了內容頁與「各校預約方式」，沒有「全站共用
// 內容」授權的分校管理者進不了共用內容頁。
const canOpen = (path: string) => canOpenPath(path, authStore.user)
// 時段、每週規則與預約方式由校區管理者設定（booking.manage），櫃台只能看。
const canManageBooking = computed(() => can('booking.manage'))
// 待發布、素材與排程這類內容提醒只給能編內容的人；每一列再看進不進得了編輯頁。
const canEditContent = computed(() => can('content.manage'))

async function load() {
  loading.value = true
  error.value = null
  try {
    summary.value = await api.get<DashboardSummary>('/admin/dashboard')
    openRequests.apply(summary.value)
    // 待審清單只列自己能發布的內容，沒有發布權的人不用讀。
    if ((summary.value.pending_review ?? 0) > 0 && can('content.publish')) {
      const list = await api.get<PendingReview[]>('/admin/content-reviews').catch(() => [])
      reviews.value = Array.isArray(list) ? list : []
    } else {
      reviews.value = []
    }
  } catch {
    error.value = '無法讀取總覽資料'
  } finally {
    loading.value = false
  }
}

const todayLabel = new Intl.DateTimeFormat('zh-TW', {
  month: 'long',
  day: 'numeric',
  weekday: 'long',
  timeZone: 'Asia/Taipei',
}).format(new Date())

const newRequests = computed(() => summary.value?.new_requests ?? 0)
const awaiting = computed(() => summary.value?.awaiting_confirmation ?? 0)
const reschedules = computed(() => summary.value?.pending_reschedule_requests ?? 0)
// 關了時段、設了休假日或停用分校，但家長還要來的案件：不聯絡的話家長會照原時間到園。
const needsAttention = computed(() => summary.value?.needs_attention ?? 0)
// 主按鈕帶去最急的一批：有占位待確認就先處理（逾期會自動釋出名額），
// 沒有才是新需求。按鈕上的字與數字講的就是點進去那一批，不把兩批加總
// 之後只帶去其中一批。最早送出的先處理，占位也是最早到期的在前面。
const primary = computed(() => {
  if (awaiting.value > 0) return { to: '/visit-requests?status=pending_confirmation&order=oldest', label: '確認時段預約', count: awaiting.value }
  // 家長在等園方回覆能不能改期，原時段也可能快到了，排在新需求前面。
  if (reschedules.value > 0) return { to: '/notifications', label: '核准改期申請', count: reschedules.value }
  if (newRequests.value > 0) return { to: '/visit-requests?status=new&order=oldest', label: '聯絡新需求', count: newRequests.value }
  return { to: '/visit-requests', label: '查看參觀案件', count: 0 }
})
const openCount = computed(() => newRequests.value + awaiting.value)
const slotsWithoutOpenings = computed(() => summary.value?.campuses_slots_without_openings ?? [])
const campusesWithoutBooking = computed(() => summary.value?.campuses_without_active_booking ?? [])
const openableContent = <T extends { kind: string; campus_key: string | null }>(rows: T[] | undefined): T[] =>
  canEditContent.value ? (rows ?? []).filter((row) => canOpen(contentEditorPath(row.kind, row.campus_key))) : []
const pendingPublishItems = computed(() => openableContent(summary.value?.pending_publish_items))
const pendingPublishKinds = computed(() =>
  canEditContent.value ? (summary.value?.pending_publish_kinds ?? []).filter((kind) => canOpen(contentEditorPath(kind))) : [],
)
const pendingPublishCount = computed(() => {
  const s = summary.value
  if (!s || !canEditContent.value) return 0
  if (s.pending_publish_items) return pendingPublishItems.value.length
  // 舊版 API 只有種類或只有總數。
  return s.pending_publish_kinds ? pendingPublishKinds.value.length : s.pending_publish
})
const mediaIssues = computed(() => openableContent(summary.value?.content_media_issues))
const failedJobs = computed(() => openableContent(summary.value?.failed_publish_jobs))
const visibleReviews = computed(() => openableContent(reviews.value))

// 常用工作：一樣只列點得進去的。櫃台看得到時段但不能新增，改成「查看」。
const shortcuts = computed(() =>
  [
    canManageBooking.value
      ? { to: '/slots', title: '安排參觀時段', hint: '開放時間與可接待人數' }
      : { to: '/slots', title: '查看參觀時段', hint: '各場次名額與已預約人數' },
    { to: '/visit-calendar', title: '查看接待月曆', hint: '每天有誰要來參觀' },
    { to: '/content/home-hero', title: '更新首頁文字', hint: '調整家長進站看到的標語' },
    { to: '/content/campus-profile', title: '修改各校資料', hint: '校園介紹與聯絡方式' },
    { to: '/media', title: '整理照片與影片', hint: '上傳素材、補上圖片說明' },
    { to: '/users', title: '管理使用者', hint: '帳號與校區權限' },
  ].filter((link) => canOpen(link.to)),
)

function mediaIssueText(issue: MediaIssue): string {
  const parts: string[] = []
  if (issue.missing) parts.push(`${issue.missing} 個已刪除`)
  if (issue.not_ready) parts.push(`${issue.not_ready} 個還沒處理好`)
  return `${issue.live ? '官網上' : '草稿'}${parts.join('、')}`
}

function pendingPublishText(item: PendingPublishItem): string {
  return item.published_version === null ? '從未發布' : `官網第 ${item.published_version} 版，最新第 ${item.latest_version} 版`
}

const hasTodo = computed(() => {
  const s = summary.value
  if (!s) return false
  return (
    openCount.value > 0 ||
    reschedules.value > 0 ||
    needsAttention.value > 0 ||
    s.pending_follow_up > 0 ||
    pendingPublishCount.value > 0 ||
    visibleReviews.value.length > 0 ||
    s.failed_notifications > 0 ||
    mediaIssues.value.length > 0 ||
    failedJobs.value.length > 0 ||
    campusesWithoutBooking.value.length > 0 ||
    slotsWithoutOpenings.value.length > 0
  )
})

onMounted(load)
</script>

<template>
  <div class="page dashboard">
    <div class="dash__intro">
      <div><p class="dash__date">{{ todayLabel }}</p><h2>今天的工作</h2><p class="dash__lead">先確認參觀安排，再處理家長需求與官網更新。</p></div>
      <router-link class="dash__primary" :to="primary.to">{{ primary.label }}<span v-if="primary.count" class="dash__primary-count num">{{ primary.count }}<span class="visually-hidden"> 件</span></span> <span aria-hidden="true">→</span></router-link>
    </div>
    <el-alert v-if="error" type="error" :closable="false" show-icon :title="error">
      <el-button @click="load">重新載入</el-button>
    </el-alert>
    <el-skeleton v-else-if="loading" animated :rows="6" />
    <template v-else-if="summary">
      <dl class="dash__summary" aria-label="營運摘要">
        <div :class="{ 'is-attention': newRequests > 0 }"><dt>新需求待聯絡</dt><dd>{{ newRequests }}<span>件</span></dd><router-link to="/visit-requests?status=new&order=oldest">查看新需求</router-link></div>
        <div :class="{ 'is-attention': awaiting > 0 }"><dt>待園方確認</dt><dd>{{ awaiting }}<span>件</span></dd><router-link to="/visit-requests?status=pending_confirmation&order=oldest">{{ summary.next_hold_expires_at ? `最早一筆${formatHoldRemaining(summary.next_hold_expires_at)}` : '查看待確認案件' }}</router-link></div>
        <div><dt>今日參觀</dt><dd>{{ summary.today_visits }}<span>組</span></dd><router-link to="/visit-requests?status=confirmed">查看已確認案件</router-link></div>
        <div><dt>到期待追蹤</dt><dd>{{ summary.pending_follow_up }}<span>件</span></dd><router-link to="/visit-requests?due=1">查看到期案件</router-link></div>
      </dl>
      <section v-if="summary.today_visit_list?.length" class="dash__today" aria-labelledby="today-title">
        <div class="section__title"><h2 id="today-title">今天的參觀</h2><span class="hint">點一筆查看聯絡紀錄與電話</span></div>
        <ol class="panel today">
          <li v-for="visit in summary.today_visit_list" :key="visit.id">
            <router-link :to="`/visit-requests/${visit.id}`">
              <time class="today__time num">{{ formatTime(visit.start_time) }}–{{ formatTime(visit.end_time) }}</time>
              <strong class="today__name">{{ visit.parent_name }}</strong>
              <span class="today__campus">{{ campusLabel(visit.campus_key) }}</span>
              <span class="today__go" aria-hidden="true">→</span>
            </router-link>
          </li>
        </ol>
      </section>
      <div class="dash__workspace">
        <section class="dash__tasks" aria-labelledby="tasks-title">
          <div class="section__title"><h2 id="tasks-title">待辦與提醒</h2><span class="hint">依目前資料顯示</span></div>
          <div class="panel dash__task-list">
            <router-link v-if="needsAttention > 0" class="task task--urgent" :to="attentionListPath()">
              <span class="task__number">{{ needsAttention }}</span>
              <div><h3>時段已關閉或分校停用，家長還要來</h3><p>這些案件的場次已關閉（含休假日），或分校已停用但還沒結案。請聯絡家長改期到其他場次或取消，避免家長照原時間到園；那一場其實照常接待的話，重新開放時段並把名額調成已占用的組數。</p><span class="task__action">查看待人工處理的案件 →</span></div>
            </router-link>
            <router-link v-if="awaiting > 0" class="task task--urgent" to="/visit-requests?status=pending_confirmation&order=oldest">
              <span class="task__number">{{ awaiting }}</span>
              <div><h3>時段預約等園方確認</h3><p>家長已選好場次，名額先保留著；逾期沒確認會自動釋出。<template v-if="summary.next_hold_expires_at">最早一筆要在 <strong class="num">{{ formatDateTime(summary.next_hold_expires_at) }}</strong> 前確認。</template></p><span class="task__action">從最早送出的開始確認 →</span></div>
            </router-link>
            <router-link v-if="reschedules > 0" class="task task--urgent" to="/notifications">
              <span class="task__number">{{ reschedules }}</span>
              <div><h3>家長申請改期，等你核准</h3><p>家長用管理連結申請換場次；核准前原時段仍有效。核准或退回後請告知家長。</p><span class="task__action">查看改期申請 →</span></div>
            </router-link>
            <router-link v-if="newRequests > 0" class="task" to="/visit-requests?status=new&order=oldest">
              <span class="task__number">{{ newRequests }}</span>
              <div><h3>新的參觀需求還沒聯絡</h3><p>家長送出後在等園方回電。聯絡後記一筆紀錄，談好時間就排入時段。</p><span class="task__action">從最早送出的開始聯絡 →</span></div>
            </router-link>
            <router-link v-if="summary.pending_follow_up > 0" class="task" to="/visit-requests?due=1">
              <span class="task__number">{{ summary.pending_follow_up }}</span>
              <div><h3>案件已到追蹤時間</h3><p>之前記下「下次聯絡」的案件到期了。聯絡後在案件裡新增紀錄，需要再追就填新的日期。</p><span class="task__action">查看到期案件 →</span></div>
            </router-link>
            <router-link v-if="campusesWithoutBooking.length && canOpen('/booking')" class="task" to="/booking">
              <span class="task__number">{{ campusesWithoutBooking.length }}</span>
              <div><h3>校區尚未開放預約</h3><p>{{ campusLabels(campusesWithoutBooking) }}目前暫停或尚未設定預約方式，家長無法送出需求。</p><span class="task__action">檢查各校預約方式 →</span></div>
            </router-link>
            <div v-else-if="campusesWithoutBooking.length" class="task">
              <span class="task__number">{{ campusesWithoutBooking.length }}</span>
              <div><h3>校區尚未開放預約</h3><p>{{ campusLabels(campusesWithoutBooking) }}目前暫停或尚未設定預約方式，家長無法從官網送出需求。預約方式由校區管理者設定。</p></div>
            </div>
            <router-link v-if="slotsWithoutOpenings.length" class="task" to="/slots">
              <span class="task__number">{{ slotsWithoutOpenings.length }}</span>
              <div v-if="canManageBooking"><h3>開放選時段，但沒有可預約的場次</h3><p>{{ campusLabels(slotsWithoutOpenings) }}官網顯示「目前沒有開放的參觀場次」，家長送不出時段申請。請新增場次或每週開放規則，或改用其他預約方式。</p><span class="task__action">安排參觀時段 →</span></div>
              <div v-else><h3>開放選時段，但沒有可預約的場次</h3><p>{{ campusLabels(slotsWithoutOpenings) }}官網顯示「目前沒有開放的參觀場次」，家長送不出時段申請。新增場次或每週開放規則由校區管理者處理。</p><span class="task__action">查看參觀時段 →</span></div>
            </router-link>
            <router-link v-if="summary.failed_notifications > 0" class="task" to="/notifications">
              <span class="task__number">{{ summary.failed_notifications }}</span>
              <div><h3>通知寄送失敗</h3><p>自動重試後仍沒送出的 Email 或 LINE 通知。查看失敗原因，修好設定後重新寄送。</p><span class="task__action">查看並重新寄送 →</span></div>
            </router-link>
            <div v-if="failedJobs.length > 0" class="task task--urgent">
              <span class="task__number">{{ failedJobs.length }}</span>
              <div>
                <h3>排程發布沒有執行</h3>
                <p>時間到了但檢查沒通過，官網還是舊內容。看過原因、修好後直接發布或重新排程。</p>
                <ul class="task__rows">
                  <li v-for="job in failedJobs" :key="job.id">
                    <router-link :to="contentEditorPath(job.kind, job.campus_key)">{{ contentItemLabel(job.kind, job.campus_key) }} →</router-link>
                    <span>{{ formatDateTime(job.publish_at) }}・第 {{ job.revision_version }} 版{{ job.error ? `：${job.error}` : '' }}</span>
                  </li>
                </ul>
                <router-link v-if="canOpen('/releases')" class="task__action" to="/releases?tab=schedules">查看全站排程 →</router-link>
              </div>
            </div>
            <div v-if="visibleReviews.length > 0" class="task">
              <span class="task__number">{{ visibleReviews.length }}</span>
              <div>
                <h3>內容等你審核</h3>
                <p>內容編輯送上來的修改，核准後才會出現在官網；需要修改就退回並寫原因。</p>
                <span class="task__kinds">
                  <router-link v-for="r in visibleReviews" :key="r.revision_id" :to="contentEditorPath(r.kind, r.campus_key)">
                    {{ contentItemLabel(r.kind, r.campus_key) }} →
                  </router-link>
                </span>
              </div>
            </div>
            <div v-if="mediaIssues.length > 0" class="task">
              <span class="task__number">{{ mediaIssues.length }}</span>
              <div>
                <h3>內容缺少素材或素材還沒處理好</h3>
                <p>引用的照片或影片已從素材庫刪除，或還在處理、處理失敗。官網上的版本有問題時家長會看到備用圖；草稿有問題則發布不了。請換一張素材。</p>
                <ul class="task__rows">
                  <li v-for="issue in mediaIssues" :key="`${issue.kind}-${issue.campus_key ?? ''}`">
                    <router-link :to="contentEditorPath(issue.kind, issue.campus_key)">{{ contentItemLabel(issue.kind, issue.campus_key) }} →</router-link>
                    <span :class="{ 'is-live': issue.live }">{{ mediaIssueText(issue) }}</span>
                  </li>
                </ul>
                <router-link v-if="canOpen('/media')" class="task__action" to="/media">查看素材庫 →</router-link>
              </div>
            </div>
            <div v-if="pendingPublishCount > 0" class="task">
              <span class="task__number">{{ pendingPublishCount }}</span>
              <div>
                <h3>草稿尚未公開</h3>
                <p>這些內容存過草稿，官網顯示的還是舊版或預設文字。檢查後再發布。</p>
                <ul v-if="pendingPublishItems.length" class="task__rows">
                  <li v-for="item in pendingPublishItems" :key="`${item.kind}-${item.campus_key ?? ''}`">
                    <router-link :to="contentEditorPath(item.kind, item.campus_key)">{{ contentItemLabel(item.kind, item.campus_key) }} →</router-link>
                    <span>{{ pendingPublishText(item) }}<template v-if="item.updated_at">・{{ formatDateTime(item.updated_at) }} 儲存</template></span>
                  </li>
                </ul>
                <span v-else class="task__kinds">
                  <router-link v-for="kind in pendingPublishKinds" :key="kind" :to="contentEditorPath(kind)">
                    {{ contentItemLabel(kind) }} →
                  </router-link>
                </span>
              </div>
            </div>
            <div v-if="!hasTodo" class="dash__clear"><h3>目前沒有待處理事項</h3><p>{{ canEditContent ? '可以查看參觀安排，或利用下方入口整理官網內容。' : '可以查看參觀案件與接待月曆。' }}</p></div>
          </div>
        </section>
        <section class="dash__shortcuts" aria-labelledby="shortcuts-title">
          <div class="section__title"><h2 id="shortcuts-title">常用工作</h2></div>
          <div class="dash__links">
            <router-link v-for="link in shortcuts" :key="link.title" :to="link.to"><span><strong>{{ link.title }}</strong><small>{{ link.hint }}</small></span><span aria-hidden="true">→</span></router-link>
          </div>
        </section>
      </div>
    </template>
  </div>
</template>

<style scoped>
.dash__intro { display: flex; align-items: center; justify-content: space-between; gap: 20px; margin-bottom: 28px; }
.dash__date { color: var(--ink-3); font-size: 13px; margin-bottom: 8px; }
.dash__intro h2 { font-size: 24px; letter-spacing: -.02em; }
.dash__lead { margin-top: 8px; color: var(--ink-2); }
.dash__primary { display: inline-flex; align-items: center; justify-content: center; gap: 20px; flex-shrink: 0; min-height: 44px; padding: 0 18px; border-radius: var(--radius); background: var(--el-color-primary); color: var(--surface); font-weight: 500; }
.dash__primary-count { min-width: 24px; margin-left: -12px; padding: 0 7px; border-radius: 999px; background: var(--surface); color: var(--el-color-primary); font-size: 13px; font-weight: 600; line-height: 22px; text-align: center; }
.dash__primary:hover { background: var(--el-color-primary-dark-2); text-decoration: none; }
.dash__summary { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); margin: 0 0 28px; border: 1px solid var(--line); border-radius: var(--radius-lg); background: var(--surface); box-shadow: var(--shadow-sm); }
.dash__summary > div { min-width: 0; padding: 20px; }
.dash__summary > div + div { border-left: 1px solid var(--line); }
.dash__summary dt { font-size: 14px; color: var(--ink-2); }
.dash__summary dd { display: flex; align-items: baseline; gap: 8px; margin: 8px 0 4px; font-size: 28px; font-weight: 600; line-height: 1.25; font-variant-numeric: tabular-nums; }
.dash__summary dd span { font-size: 13px; font-weight: 400; color: var(--ink-3); }
.dash__summary > .is-attention dd { color: var(--brand-gold-ink); }
.dash__summary a { display: inline-flex; align-items: center; min-height: 28px; font-size: 13px; }
.dash__today { margin-bottom: 28px; }
.today { list-style: none; margin: 0; padding: 0; }
.today li + li { border-top: 1px solid var(--line); }
.today a { display: grid; grid-template-columns: auto 1fr auto auto; align-items: center; gap: 16px; padding: 14px 20px; color: var(--ink); }
.today a:hover { text-decoration: none; background: var(--surface-2); }
.today__time { font-size: 14px; font-weight: 500; color: var(--el-color-primary); }
.today__name { font-size: 15px; font-weight: 500; }
.today__campus { color: var(--ink-3); font-size: 13px; }
.today__go { color: var(--ink-3); }
.task__kinds { display: flex; flex-wrap: wrap; gap: 8px 20px; margin-top: 12px; }
.task__kinds a { color: var(--el-color-primary); font-weight: 500; font-size: 14px; }
.task__rows { list-style: none; margin: 12px 0 0; padding: 0; display: grid; gap: 6px; }
.task__rows li { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 12px; font-size: 14px; }
.task__rows a { color: var(--el-color-primary); font-weight: 500; }
.task__rows span { color: var(--ink-3); font-size: 13px; overflow-wrap: anywhere; min-width: 0; }
.task__rows span.is-live { color: var(--el-color-danger); }
.dash__workspace { display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(260px, 1fr); gap: 24px; align-items: start; }
.section__title h2 { font-size: 17px; }
.task { display: flex; gap: 16px; padding: 24px; color: var(--ink); }
.task + .task { border-top: 1px solid var(--line); }
a.task:hover { text-decoration: none; background: var(--surface-2); }
.task--urgent .task__number { background: var(--el-color-warning-light-9); color: var(--brand-gold-ink); }
.task p strong { color: var(--ink); font-weight: 600; }
.task__number { flex-shrink: 0; display: grid; place-items: center; width: 36px; height: 36px; border-radius: var(--radius); background: var(--el-color-primary-light-9); color: var(--el-color-primary); font-weight: 600; font-size: 17px; }
.task h3 { font-size: 16px; }
.task p { margin-top: 6px; color: var(--ink-2); max-width: 60ch; line-height: 1.7; }
.task__action { display: inline-flex; margin-top: 12px; color: var(--el-color-primary); font-weight: 500; }
.dash__links a { display: flex; justify-content: space-between; align-items: center; gap: 16px; padding: 15px 0; border-bottom: 1px solid var(--line); color: var(--ink); }
.dash__links a:first-child { padding-top: 0; }
.dash__links a:hover { text-decoration: none; color: var(--el-color-primary); }
.dash__links strong { font-size: 14px; font-weight: 500; }
.dash__links small { display: block; margin-top: 4px; color: var(--ink-3); font-size: 13px; }
.dash__clear { padding: 28px 24px; }
.dash__clear p { color: var(--ink-3); margin-top: 8px; }
@media (max-width: 1100px) { .dash__workspace { grid-template-columns: minmax(0, 1fr); gap: 28px; } }
@media (max-width: 720px) {
  .dash__intro { align-items: flex-start; flex-direction: column; gap: 16px; }
  .dash__intro h2 { font-size: 24px; }
  .dash__primary { width: 100%; }
  .dash__summary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .dash__summary > div { padding: 16px 12px; }
  .dash__summary > div:nth-child(odd) { border-left: 0; }
  .dash__summary > div:nth-child(n+3) { border-top: 1px solid var(--line); }
  .dash__summary a { min-height: 44px; }
  .dash__summary a, .dash__links small, .dash__date { font-size: 14px; }
  .task { padding: 20px 16px; gap: 12px; }
  .today a { grid-template-columns: auto 1fr auto; gap: 4px 12px; padding: 14px 16px; }
  .today__time { grid-column: 1; grid-row: 1; }
  .today__name { grid-column: 2; grid-row: 1; }
  .today__campus { grid-column: 1 / 3; grid-row: 2; }
  .today__go { grid-column: 3; grid-row: 1 / span 2; align-self: center; }
}
</style>
