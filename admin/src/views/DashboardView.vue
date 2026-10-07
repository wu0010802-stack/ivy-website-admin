<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { api } from '../api/client'
import { apiErrorCode, apiErrorMessage } from '../api/errors'
import { notifyError } from '../composables/notify'
import { confirmAttendance, submitAttendance, type AttendanceKind } from '../composables/visitAttendance'
import { ARRIVAL_FORM_CANCEL_TEXT, useArrivalAdmissionsForm } from '../composables/useArrivalAdmissionsForm'
import RecordDialog from '../components/admissions/RecordDialog.vue'
import { BOOKING_MODE_LABELS, attentionListPath, campusLabel, campusLabels, contentEditorPath, contentItemLabel, formatTime } from '../api/labels'
import { usePermissions } from '../composables/usePermissions'
import { canOpenPath } from '../router/nav'
import { useAuthStore } from '../stores/auth'
import { STALE_MS, useOpenRequestsStore } from '../stores/openRequests'

interface TodayVisit {
  id: string
  parent_name: string
  campus_key: string
  start_time: string
  end_time: string
  // 2026-10-06 行程板：孩子、電話、狀態（已到場、未到場也留在名單）；舊版 API 沒有。
  child_name?: string | null
  phone?: string | null
  status?: string
}

// 本週五校（今天起七天）：已預約幾組、還可約幾組（只有自選場次的校有數字）。
interface WeekCampus {
  campus_key: string
  mode: string
  booked: number
  open: number | null
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
  // 已確認、場次時間已過、還沒標記到場（和案件列表「時間已過」裡的「尚未確認到場」同一批）。
  awaiting_attendance?: number
  pending_reschedule_requests?: number
  my_unread_notifications?: number
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
  week_campuses?: WeekCampus[]
  // 開放線上表單，但「預約文案」沒有發布中的同意文字：官網對家長顯示暫停（2026-09-26 起）。
  failed_notifications: number
}

interface PendingReview { kind: string; campus_key: string | null; revision_id: string; submitted_by_email: string | null }
const reviews = ref<PendingReview[]>([])
// 待審清單讀不到時不能當成「沒有待審」：留一列提醒，也不能說「目前沒有待處理事項」。
const reviewsFailed = ref(false)
// 待審清單在彙總之後才背景讀：還沒回來、手上也沒有清單時算「還不知道」，
// 同樣不能先說「目前沒有待處理事項」再變成「內容等你審核」。
const reviewsLoading = ref(false)
let reviewsRequest = 0

const authStore = useAuthStore()
const openRequests = useOpenRequestsStore()
const { can } = usePermissions()
const summary = ref<DashboardSummary | null>(null)
const loading = ref(true)
const error = ref<string | null>(null)
// 背景重讀（切回這個分頁、按「重新整理」）：畫面保留舊資料，不閃骨架。
const refreshing = ref(false)
const refreshFailed = ref(false)
const loadedAt = ref<number | null>(null)
// 30 秒走一次的時鐘：占位倒數與上方的日期跟著走，開著過夜也會換日。
const clockNow = ref(Date.now())

// 總覽上的連結只放點得進去的（第 27 條）：進不去的頁面會被導回總覽本身，
// 看起來像按了沒反應。櫃台進不了內容頁與「各校預約方式」，沒有「全站共用
// 內容」授權的分校管理者進不了共用內容頁。
const canOpen = (path: string) => canOpenPath(path, authStore.user)
// 時段、每週規則與預約方式由校區管理者設定（booking.manage），櫃台只能看。
const canManageBooking = computed(() => can('booking.manage'))
// 待發布、素材與排程這類內容提醒只給能編內容的人；每一列再看進不進得了編輯頁。
const canEditContent = computed(() => can('content.manage'))

// 彙總和側欄數字共用 store 的同一個請求（外殼換頁時可能已經在讀），
// 進一次總覽只打一次 /admin/dashboard。quiet：已經有資料時在背景重讀。
async function load(options: { quiet?: boolean } = {}) {
  const quiet = Boolean(options.quiet) && summary.value !== null
  if (quiet) {
    refreshing.value = true
  } else {
    loading.value = true
    error.value = null
  }
  try {
    summary.value = await openRequests.loadSummary<DashboardSummary>()
    loadedAt.value = Date.now()
    clockNow.value = Date.now()
    error.value = null
    refreshFailed.value = false
    // 待審清單在背景補上，最急的參觀數字不用等它。
    void loadReviews()
  } catch {
    if (quiet) refreshFailed.value = true
    else error.value = '無法讀取總覽資料'
  } finally {
    loading.value = false
    refreshing.value = false
  }
}

// 待審清單只列自己能發布的內容，沒有發布權的人不用讀。
async function loadReviews() {
  const request = ++reviewsRequest
  if (!((summary.value?.pending_review ?? 0) > 0 && can('content.publish'))) {
    reviews.value = []
    reviewsFailed.value = false
    reviewsLoading.value = false
    return
  }
  reviewsLoading.value = true
  try {
    const list = await api.get<PendingReview[]>('/admin/content-reviews')
    if (request !== reviewsRequest) return
    reviews.value = Array.isArray(list) ? list : []
    reviewsFailed.value = false
  } catch {
    if (request !== reviewsRequest) return
    reviews.value = []
    reviewsFailed.value = true
  } finally {
    if (request === reviewsRequest) reviewsLoading.value = false
  }
}
const reviewsUnknown = computed(() => reviewsLoading.value && reviews.value.length === 0)

// 不固定輪詢最重的彙總查詢：切回這個分頁或視窗時，距離上次讀取超過 30 秒才在背景重讀。
function onReturn() {
  if (document.visibilityState === 'hidden') return
  clockNow.value = Date.now()
  if (loading.value || refreshing.value || loadedAt.value === null) return
  if (Date.now() - loadedAt.value > STALE_MS) void load({ quiet: true })
}

// 開著過夜：日期換了，「今天的參觀」與各項件數也要換成新的一天，不能上面寫今天、
// 下面還是昨天的資料。每換一天只自動重讀一次（讀不到也不每 30 秒重試），不是輪詢；
// 分頁在背景時不讀，切回來由 onReturn 重讀。
let dayReloadedFor = ''
function tick() {
  clockNow.value = Date.now()
  if (document.visibilityState === 'hidden') return
  if (loadedAt.value === null || loading.value || refreshing.value) return
  const today = taipeiDay(clockNow.value)
  if (taipeiDay(loadedAt.value) === today || dayReloadedFor === today) return
  dayReloadedFor = today
  void load({ quiet: true })
}

let clock: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  void load()
  clock = setInterval(tick, 30_000)
  document.addEventListener('visibilitychange', onReturn)
  window.addEventListener('focus', onReturn)
})
onBeforeUnmount(() => {
  clearInterval(clock)
  document.removeEventListener('visibilitychange', onReturn)
  window.removeEventListener('focus', onReturn)
})

const TAIPEI = 'Asia/Taipei'
const todayFormatter = new Intl.DateTimeFormat('zh-TW', { month: 'long', day: 'numeric', weekday: 'long', timeZone: TAIPEI })
const clockFormatter = new Intl.DateTimeFormat('zh-TW', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: TAIPEI })
const shortDateTimeFormatter = new Intl.DateTimeFormat('zh-TW', {
  month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: TAIPEI,
})
const dayFormatter = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: TAIPEI })
function taipeiDay(time: number): string {
  return dayFormatter.format(new Date(time))
}
const todayLabel = computed(() => todayFormatter.format(new Date(clockNow.value)))
// 資料不是今天讀的（開著過夜、換日後重讀失敗）就連日期一起寫：「更新於 09/29 17:30」。
const updatedLabel = computed(() => {
  if (loadedAt.value === null) return ''
  const loaded = new Date(loadedAt.value)
  return taipeiDay(loadedAt.value) === taipeiDay(clockNow.value)
    ? clockFormatter.format(loaded)
    : shortDateTimeFormatter.format(loaded).replace(/\s+/g, ' ')
})
// 今天的參觀依狀態與現在時間標示：已到場、未到場直接看狀態（整天留在名單上）；還沒標記的
// 看場次時間——場次時間是台北的「HH:MM:SS」，跟台北現在的「HH:MM」比字串即可。
const nowClock = computed(() => clockFormatter.format(new Date(clockNow.value)))
type VisitPhase = 'done' | 'no_show' | 'ended' | 'ongoing' | ''
function visitPhase(visit: TodayVisit): VisitPhase {
  if (visit.status === 'completed') return 'done'
  if (visit.status === 'no_show') return 'no_show'
  const now = nowClock.value
  if (formatTime(visit.end_time) <= now) return 'ended'
  if (formatTime(visit.start_time) <= now) return 'ongoing'
  return ''
}
const VISIT_PHASE_LABELS: Record<Exclude<VisitPhase, ''>, string> = { done: '已到場', no_show: '未到場', ended: '還沒標記', ongoing: '進行中' }
// 還沒標記到場的，場次開始後才給「到了／沒來」（同案件列表）。
const attendanceDue = (visit: TodayVisit) => visitPhase(visit) === 'ended' || visitPhase(visit) === 'ongoing'
// 上午／下午分組：12:00 以前算上午。
const todayGroups = computed(() => {
  const list = summary.value?.today_visit_list ?? []
  const groups = [
    { key: 'am', label: '上午', rows: list.filter((visit) => formatTime(visit.start_time) < '12:00') },
    { key: 'pm', label: '下午', rows: list.filter((visit) => formatTime(visit.start_time) >= '12:00') },
  ]
  return groups.filter((group) => group.rows.length > 0)
})
// 摘要句：「義華 2 組、明華 1 組，1 組結束了還沒標記」。沒有名單（沒有案件讀取權）只寫總數。
const todaySummary = computed(() => {
  const s = summary.value
  if (!s) return ''
  const list = s.today_visit_list ?? []
  if (list.length === 0) return s.today_visits > 0 ? `${s.today_visits} 組` : '今天沒有參觀。'
  const byCampus = new Map<string, number>()
  for (const visit of list) byCampus.set(visit.campus_key, (byCampus.get(visit.campus_key) ?? 0) + 1)
  const parts = [...byCampus].map(([key, count]) => `${campusLabel(key)} ${count} 組`).join('、')
  const unmarked = list.filter((visit) => visitPhase(visit) === 'ended').length
  return unmarked > 0 ? `${parts}，${unmarked} 組結束了還沒標記` : parts
})

// 今天的名單直接標記到場（2026-10-05 第九輪）：場次開始後（進行中、已結束）才出現，同案件列表；
// 先確認一次，寫出家長與場次。標完就離開名單（後端只列還沒標記的），重讀彙總。
const canHandleVisits = computed(() => can('booking.handle'))
const attendanceBusy = ref<string | null>(null)
// 標記已到場後接著打開招生資料表單（2026-10-06，同案件列表）：表單上方寫出已到場，不另跳成功訊息。
const arrival = useArrivalAdmissionsForm()
const { open: arrivalOpen, record: arrivalRecord, options: arrivalOptions, lead: arrivalLead } = arrival
async function markTodayAttendance(visit: TodayVisit, kind: AttendanceKind) {
  const row = { status: 'confirmed', parent_name: visit.parent_name, slot: { slot_date: taipeiDay(clockNow.value), start_time: visit.start_time, end_time: visit.end_time } }
  const withAdmissions = kind === 'complete' && Boolean(authStore.features.admissions)
  const opensForm = withAdmissions && arrival.opensForm.value
  if (attendanceBusy.value || !(await confirmAttendance(kind, row, withAdmissions, opensForm))) return
  attendanceBusy.value = visit.id
  try {
    await submitAttendance(visit.id, kind)
    if (opensForm) void arrival.openFor(visit)
    else ElMessage.success(kind === 'no_show' ? `已標記 ${visit.parent_name} 未到場` : `已標記 ${visit.parent_name} 已到場${withAdmissions ? '，招生訪視已建立' : ''}`)
  } catch (err) {
    notifyError(apiErrorCode(err) === 'INVALID_TRANSITION' ? `${visit.parent_name} 這筆剛被其他人處理過，名單已更新` : apiErrorMessage(err, '操作失敗'))
  } finally {
    attendanceBusy.value = null
    await load({ quiet: true })
  }
}

// 草稿、排程這類清單只要知道哪一天幾點，不寫年份：「09/28 21:45」。
function shortDateTime(value: string | null | undefined): string {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : shortDateTimeFormatter.format(date).replace(/\s+/g, ' ')
}

const reschedules = computed(() => summary.value?.pending_reschedule_requests ?? 0)
// 給自己的內容通知（送審、核准或退回、排程沒有發布）還沒讀的則數：側欄不掛數字，改在總覽與頁首提醒。
const myNotices = computed(() => summary.value?.my_unread_notifications ?? 0)
// 關了時段、設了休假日或停用分校，但家長還要來的案件：不聯絡的話家長會照原時間到園。
const needsAttention = computed(() => summary.value?.needs_attention ?? 0)
const followUpDue = computed(() => summary.value?.pending_follow_up ?? 0)
const awaitingAttendance = computed(() => summary.value?.awaiting_attendance ?? 0)
// 主按鈕帶去最急的一批：場次關了家長還要來，再來是改期申請、到期追蹤。按鈕上的字講的是
// 點進去那一批，數字也只算那一批，不把幾批加總之後只帶去其中一批。
const primary = computed(() => {
  // 待辦清單最上面那項：不聯絡的話家長會照原時間到園。
  if (needsAttention.value > 0) return { to: attentionListPath(), label: '聯絡要改期的家長', count: needsAttention.value }
  // 家長在等園方回覆能不能改期，原時段也可能快到了。
  if (reschedules.value > 0) return { to: '/notifications', label: '核准改期申請', count: reschedules.value }
  if (followUpDue.value > 0) return { to: '/visit-requests?due=1', label: '追蹤到期案件', count: followUpDue.value }
  return { to: '/visit-requests', label: '查看參觀案件', count: 0 }
})
const slotsWithoutOpenings = computed(() => summary.value?.campuses_slots_without_openings ?? [])
// 本週五校（2026-10-06）：有這張表就不再放「校區尚未開放預約」提醒卡，未開放的校在表裡給開放入口。
const weekCampuses = computed(() => summary.value?.week_campuses ?? [])
const campusesWithoutBooking = computed(() => (weekCampuses.value.length ? [] : summary.value?.campuses_without_active_booking ?? []))
function weekModeText(row: WeekCampus): string {
  if (row.mode === 'paused') return '未開放'
  return BOOKING_MODE_LABELS[row.mode]?.replace(/（.*）$/, '').replace(/官方帳號|洽詢|預約網站/, '') || row.mode
}
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

// 常用：一列文字連結（2026-10-06 行程板），只列點得進去的。櫃台常接電話或現場預約，
// 補登從案件列表的「補登案件」進去；參觀場次一頁同時是場次設定與接待月曆，只放一個入口。
const shortcuts = computed(() =>
  [
    ...(can('booking.handle') ? [{ to: '/visit-requests', title: '補登案件' }] : []),
    { to: '/visit-calendar', title: canManageBooking.value ? '設定參觀場次' : '查看參觀場次' },
    { to: '/content/home-hero', title: '更新首頁文字' },
    { to: '/content/campus-profile', title: '修改各校資料' },
    { to: '/media', title: '上傳素材' },
    { to: '/users', title: '管理使用者' },
  ].filter((link) => canOpen(link.to)),
)

function mediaIssueText(issue: MediaIssue): string {
  const parts: string[] = []
  if (issue.missing) parts.push(`${issue.missing} 個已刪除`)
  if (issue.not_ready) parts.push(`${issue.not_ready} 個還沒處理好`)
  return `${issue.live ? '官網上' : '草稿'}${parts.join('、')}`
}

// 不寫版本號（第四輪文案）：園方只要知道有沒有發布過、什麼時候存的。
function pendingPublishText(item: PendingPublishItem): string {
  const state = item.published_version === null ? '從未發布' : '有修改尚未發布'
  const saved = shortDateTime(item.updated_at)
  return saved ? `${state}・${saved} 儲存` : state
}

function failedJobText(job: FailedPublishJob): string {
  const when = shortDateTime(job.publish_at)
  return `${when ? `排定 ${when} 發布的草稿` : '排定發布的草稿'}沒有執行${job.error ? `：${job.error}` : ''}`
}

// 待辦整列是連結：報讀器只唸數字、標題與要去哪裡，說明段落放在描述裡。
function taskAria(key: string) {
  return {
    'aria-labelledby': `task-${key}-n task-${key}-t task-${key}-a`,
    'aria-describedby': `task-${key}-d`,
  }
}

const hasTodo = computed(() => {
  const s = summary.value
  if (!s) return false
  return (
    reschedules.value > 0 ||
    (myNotices.value > 0 && canOpen('/releases')) ||
    needsAttention.value > 0 ||
    s.pending_follow_up > 0 ||
    awaitingAttendance.value > 0 ||
    pendingPublishCount.value > 0 ||
    visibleReviews.value.length > 0 ||
    reviewsFailed.value ||
    s.failed_notifications > 0 ||
    mediaIssues.value.length > 0 ||
    failedJobs.value.length > 0 ||
    campusesWithoutBooking.value.length > 0 ||
    slotsWithoutOpenings.value.length > 0
  )
})
</script>

<template>
  <div class="page dashboard" :aria-busy="loading">
    <div class="dash__intro">
      <div>
        <div class="dash__head"><h2 id="today-title" ref="todayHeading" class="dash__title" tabindex="-1">今天的參觀</h2><span class="dash__date">{{ todayLabel }}</span></div>
        <p v-if="summary" class="dash__sum">{{ todaySummary }}</p>
      </div>
      <router-link class="dash__primary" :to="primary.to">{{ primary.label }}<span v-if="primary.count" class="dash__primary-count num">{{ primary.count }}<span class="visually-hidden"> 件</span></span> <span aria-hidden="true">→</span></router-link>
    </div>
    <el-alert v-if="error" type="error" :closable="false" show-icon :title="error">
      <el-button @click="load()">重新載入</el-button>
    </el-alert>
    <el-skeleton v-else-if="loading" animated :rows="6" />
    <template v-else-if="summary">
      <div class="dash__board">
        <div class="dash__main">
          <section class="dash__today" aria-labelledby="today-title">
            <ol v-if="summary.today_visit_list?.length" class="panel today">
              <template v-for="group in todayGroups" :key="group.key">
                <li class="today__group" aria-hidden="true">{{ group.label }}</li>
                <li v-for="visit in group.rows" :key="visit.id" class="today__row" :class="visitPhase(visit) && `is-${visitPhase(visit)}`">
                  <div class="today__time">
                    <time class="num">{{ formatTime(visit.start_time) }}</time>
                    <span v-if="visitPhase(visit)" class="today__phase">{{ VISIT_PHASE_LABELS[visitPhase(visit) as Exclude<VisitPhase, ''>] }}</span>
                  </div>
                  <div class="today__who">
                    <router-link class="today__name" :to="`/visit-requests/${visit.id}`">{{ visit.parent_name }}<template v-if="visit.child_name"><span aria-hidden="true">・</span><span class="today__child">{{ visit.child_name }}</span></template></router-link>
                    <div class="today__meta">
                      <span>{{ campusLabel(visit.campus_key) }}</span>
                      <a v-if="visit.phone" class="num" :href="`tel:${visit.phone}`">{{ visit.phone }}</a>
                    </div>
                  </div>
                  <!-- 按鈕不能包在連結裡：和連結並排在同一列。 -->
                  <span v-if="canHandleVisits && attendanceDue(visit)" class="today__attendance" role="group" :aria-label="`${visit.parent_name} 到了嗎？`">
                    <el-button size="small" type="primary" plain :loading="attendanceBusy === visit.id" :disabled="Boolean(attendanceBusy)" :aria-label="`標記 ${visit.parent_name} 已到場`" @click="markTodayAttendance(visit, 'complete')">到了</el-button>
                    <el-button size="small" :disabled="Boolean(attendanceBusy)" :aria-label="`標記 ${visit.parent_name} 未到場`" @click="markTodayAttendance(visit, 'no_show')">沒來</el-button>
                  </span>
                </li>
              </template>
            </ol>
            <p v-else-if="summary.today_visits > 0" class="panel today__empty">今天有 {{ summary.today_visits }} 組參觀。<router-link to="/visit-requests?group=upcoming">查看案件</router-link></p>
            <p v-else class="panel today__empty">今天沒有參觀。<router-link to="/visit-requests?group=upcoming">查看接下來的案件</router-link></p>
          </section>
        </div>

        <aside class="dash__rail">
          <section v-if="weekCampuses.length" class="panel dash__week" aria-labelledby="week-title">
            <div class="panel__head"><h2 id="week-title">本週五校</h2><span class="hint">今天起 7 天</span></div>
            <table>
              <thead><tr><th scope="col">校區</th><th scope="col">已預約</th><th scope="col">還可約</th><th scope="col"><span class="visually-hidden">前往</span></th></tr></thead>
              <tbody>
                <tr v-for="row in weekCampuses" :key="row.campus_key" :class="{ 'is-off': row.mode !== 'slots' }">
                  <th scope="row">{{ campusLabel(row.campus_key) }}</th>
                  <td class="num">{{ row.mode === 'slots' || row.booked ? row.booked : '—' }}</td>
                  <td :class="{ num: row.open !== null }">{{ row.open !== null ? row.open : weekModeText(row) }}</td>
                  <td>
                    <router-link v-if="row.mode === 'slots'" :to="`/visit-calendar?campus=${row.campus_key}`">場次</router-link>
                    <router-link v-else-if="canOpen('/booking')" to="/booking">開放</router-link>
                  </td>
                </tr>
              </tbody>
            </table>
          </section>

          <section class="dash__tasks" aria-labelledby="tasks-title">
            <div class="panel__head">
              <h2 id="tasks-title">要處理</h2>
              <div class="dash__updated">
                <span class="hint" :class="{ 'is-failed': refreshFailed }">{{ refreshFailed ? `沒有更新成功，仍是 ${updatedLabel} 的資料` : `更新於 ${updatedLabel}` }}</span>
                <el-button text size="small" :loading="refreshing" @click="load({ quiet: true })">重新整理</el-button>
              </div>
            </div>
            <!-- 背景重讀（切回分頁也會發生）只把待辦區標成忙碌，不讓整頁暫時不唸。 -->
            <div class="panel dash__task-list" :class="{ 'is-refreshing': refreshing }" :aria-busy="refreshing">
              <router-link v-if="needsAttention > 0" class="task task--urgent" :to="attentionListPath()" v-bind="taskAria('attention')">
                <span id="task-attention-n" class="task__number">{{ needsAttention }}</span>
                <div><h3 id="task-attention-t">場次已關閉或分校停用，家長還要來</h3><p id="task-attention-d">請聯絡家長改期或取消，避免家長照原時間到園。</p><span id="task-attention-a" class="task__action">查看</span></div>
              </router-link>
              <router-link v-if="reschedules > 0" class="task task--urgent" to="/notifications" v-bind="taskAria('reschedule')">
                <span id="task-reschedule-n" class="task__number">{{ reschedules }}</span>
                <div><h3 id="task-reschedule-t">家長申請改期，等你核准</h3><span id="task-reschedule-d" class="visually-hidden">核准前原場次仍有效</span><span id="task-reschedule-a" class="task__action">查看</span></div>
              </router-link>
              <router-link v-if="summary.pending_follow_up > 0" class="task" to="/visit-requests?due=1" v-bind="taskAria('due')">
                <span id="task-due-n" class="task__number">{{ summary.pending_follow_up }}</span>
                <div><h3 id="task-due-t">到期待追蹤</h3><span id="task-due-d" class="visually-hidden">之前記下「下次聯絡」的案件到期了</span><span id="task-due-a" class="task__action">查看</span></div>
              </router-link>
              <router-link v-if="awaitingAttendance > 0" class="task" to="/visit-requests?group=past&status=confirmed" v-bind="taskAria('arrival')">
                <span id="task-arrival-n" class="task__number">{{ awaitingAttendance }}</span>
                <div><h3 id="task-arrival-t">參觀時間過了，還沒標記到場</h3><span id="task-arrival-d" class="visually-hidden">沒標記的話，成效統計的到場數字會偏低</span><span id="task-arrival-a" class="task__action">查看</span></div>
              </router-link>
              <router-link v-if="myNotices > 0 && canOpen('/releases')" class="task" to="/releases" v-bind="taskAria('notices')">
                <span id="task-notices-n" class="task__number">{{ myNotices }}</span>
                <div><h3 id="task-notices-t">有內容通知還沒看</h3><span id="task-notices-d" class="visually-hidden">送審、核准或退回，以及排程沒有發布的通知</span><span id="task-notices-a" class="task__action">查看</span></div>
              </router-link>
              <router-link v-if="campusesWithoutBooking.length && canOpen('/booking')" class="task" to="/booking" v-bind="taskAria('booking')">
                <span id="task-booking-n" class="task__number">{{ campusesWithoutBooking.length }}</span>
                <div><h3 id="task-booking-t">校區尚未開放預約</h3><p id="task-booking-d">{{ campusLabels(campusesWithoutBooking) }}目前暫停或尚未設定預約方式，家長無法送出需求。</p><span id="task-booking-a" class="task__action">檢查各校預約方式</span></div>
              </router-link>
              <div v-else-if="campusesWithoutBooking.length" class="task">
                <span class="task__number">{{ campusesWithoutBooking.length }}</span>
                <div><h3>校區尚未開放預約</h3><p>{{ campusLabels(campusesWithoutBooking) }}目前暫停或尚未設定預約方式，家長無法從官網送出需求。預約方式由校區管理者設定。</p></div>
              </div>
              <router-link v-if="slotsWithoutOpenings.length" class="task" to="/visit-calendar" v-bind="taskAria('slots')">
                <span id="task-slots-n" class="task__number">{{ slotsWithoutOpenings.length }}</span>
                <div v-if="canManageBooking"><h3 id="task-slots-t">開放選場次，但沒有可預約的場次</h3><p id="task-slots-d">{{ campusLabels(slotsWithoutOpenings) }}官網顯示「目前沒有開放的參觀場次」，家長送不出預約。請新增場次或每週開放規則。</p><span id="task-slots-a" class="task__action">設定參觀場次</span></div>
                <div v-else><h3 id="task-slots-t">開放選場次，但沒有可預約的場次</h3><p id="task-slots-d">{{ campusLabels(slotsWithoutOpenings) }}官網顯示「目前沒有開放的參觀場次」，家長送不出預約。新增場次或每週開放規則由校區管理者處理。</p><span id="task-slots-a" class="task__action">查看參觀場次</span></div>
              </router-link>
              <router-link v-if="summary.failed_notifications > 0" class="task" to="/notifications" v-bind="taskAria('notify')">
                <span id="task-notify-n" class="task__number">{{ summary.failed_notifications }}</span>
                <div><h3 id="task-notify-t">通知寄送失敗</h3><span id="task-notify-d" class="visually-hidden">自動重試後仍沒送出的 Email 或 LINE 通知</span><span id="task-notify-a" class="task__action">重新寄送</span></div>
              </router-link>
              <div v-if="failedJobs.length > 0" class="task task--urgent">
                <span class="task__number">{{ failedJobs.length }}</span>
                <div>
                  <h3>排程發布沒有執行</h3>
                  <p>時間到了但檢查沒通過，官網還是舊內容。修好後直接發布或重新排程；不發布就在編輯頁按「知道了」。</p>
                  <ul class="task__rows">
                    <li v-for="job in failedJobs" :key="job.id">
                      <router-link :to="contentEditorPath(job.kind, job.campus_key)">{{ contentItemLabel(job.kind, job.campus_key) }} <span aria-hidden="true">→</span></router-link>
                      <span>{{ failedJobText(job) }}</span>
                    </li>
                  </ul>
                  <router-link v-if="canOpen('/releases')" class="task__action" to="/releases?tab=schedules">查看全站排程 <span aria-hidden="true">→</span></router-link>
                </div>
              </div>
              <div v-if="reviewsFailed" class="task">
                <span class="task__number">{{ summary.pending_review }}</span>
                <div>
                  <h3>送審清單讀取失敗</h3>
                  <p>有內容送上來等審核，但清單沒有讀到，暫時列不出是哪幾項。</p>
                  <el-button class="task__retry" :loading="reviewsLoading" @click="loadReviews()">重新載入送審清單</el-button>
                </div>
              </div>
              <div v-if="visibleReviews.length > 0" class="task">
                <span class="task__number">{{ visibleReviews.length }}</span>
                <div>
                  <h3>內容等你審核</h3>
                  <span class="task__kinds">
                    <router-link v-for="r in visibleReviews" :key="r.revision_id" :to="contentEditorPath(r.kind, r.campus_key)">
                      {{ contentItemLabel(r.kind, r.campus_key) }} <span aria-hidden="true">→</span>
                    </router-link>
                  </span>
                </div>
              </div>
              <div v-if="mediaIssues.length > 0" class="task">
                <span class="task__number">{{ mediaIssues.length }}</span>
                <div>
                  <h3>內容缺少素材或素材還沒處理好</h3>
                  <ul class="task__rows">
                    <li v-for="issue in mediaIssues" :key="`${issue.kind}-${issue.campus_key ?? ''}`">
                      <router-link :to="contentEditorPath(issue.kind, issue.campus_key)">{{ contentItemLabel(issue.kind, issue.campus_key) }} <span aria-hidden="true">→</span></router-link>
                      <span :class="{ 'is-live': issue.live }">{{ mediaIssueText(issue) }}</span>
                    </li>
                  </ul>
                  <router-link v-if="canOpen('/media')" class="task__action" to="/media">查看素材庫 <span aria-hidden="true">→</span></router-link>
                </div>
              </div>
              <div v-if="pendingPublishCount > 0" class="task">
                <span class="task__number">{{ pendingPublishCount }}</span>
                <div>
                  <h3>草稿尚未公開</h3>
                  <ul v-if="pendingPublishItems.length" class="task__rows">
                    <li v-for="item in pendingPublishItems" :key="`${item.kind}-${item.campus_key ?? ''}`">
                      <router-link :to="contentEditorPath(item.kind, item.campus_key)">{{ contentItemLabel(item.kind, item.campus_key) }} <span aria-hidden="true">→</span></router-link>
                      <span>{{ pendingPublishText(item) }}</span>
                    </li>
                  </ul>
                  <span v-else class="task__kinds">
                    <router-link v-for="kind in pendingPublishKinds" :key="kind" :to="contentEditorPath(kind)">
                      {{ contentItemLabel(kind) }} <span aria-hidden="true">→</span>
                    </router-link>
                  </span>
                </div>
              </div>
              <p v-if="!hasTodo && reviewsUnknown" class="dash__checking">正在讀取送審清單…</p>
              <div v-else-if="!hasTodo" class="dash__clear"><h3>目前沒有待處理事項</h3></div>
            </div>
          </section>
        </aside>
      </div>

      <nav class="dash__links" aria-label="常用">
        <span class="hint">常用</span>
        <router-link v-for="link in shortcuts" :key="link.title" :to="link.to">{{ link.title }}</router-link>
      </nav>
    </template>
    <!-- 一直掛著：RecordDialog 在打開的那一刻（open 變 true）才把 record 帶進表單。 -->
    <RecordDialog
      v-if="canHandleVisits"
      v-model="arrivalOpen"
      mode="edit"
      :campus-key="arrivalRecord?.campus_key ?? ''"
      :record="arrivalRecord"
      :options="arrivalOptions"
      :lead="arrivalLead"
      :cancel-text="ARRIVAL_FORM_CANCEL_TEXT"
    />
  </div>
</template>

<style scoped>
.dash__intro { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; margin-bottom: 20px; }
.dash__head { display: flex; align-items: baseline; gap: 14px; flex-wrap: wrap; }
.dash__title { font-size: var(--text-3xl); outline: none; scroll-margin-top: calc(var(--top-h) + 16px); }
.dash__date { color: var(--ink-3); font-size: var(--text-base); }
.dash__sum { margin-top: 6px; color: var(--ink-2); }
.dash__primary { display: inline-flex; align-items: center; justify-content: center; gap: 20px; flex-shrink: 0; min-height: 44px; padding: 0 18px; border-radius: var(--radius); background: var(--el-color-primary); color: var(--surface); font-weight: 500; }
.dash__primary-count { min-width: 24px; margin-left: -12px; padding: 0 7px; border-radius: 999px; background: var(--surface); color: var(--el-color-primary); font-size: var(--text-sm); font-weight: 600; line-height: 22px; text-align: center; }
.dash__primary:hover { background: var(--el-color-primary-dark-2); text-decoration: none; }

.dash__board { display: grid; grid-template-columns: minmax(0, 1fr) 340px; gap: 24px; align-items: start; }
.dash__main { display: grid; gap: 28px; min-width: 0; }
.dash__rail { display: grid; gap: 20px; min-width: 0; }
.panel__head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 20px; border-bottom: 1px solid var(--line); }
.panel__head h2 { font-size: var(--text-lg); }
.dash__tasks .panel__head { padding: 0 0 10px; border-bottom: 0; }

/* 今天的參觀：上午／下午分組，一列一組家庭，時間在左、到了／沒來在右。 */
.today { list-style: none; margin: 0; padding: 0; }
.today__group { padding: 8px 20px; font-size: var(--text-xs); font-weight: 600; color: var(--ink-3); background: var(--surface-2); border-top: 1px solid var(--line); }
.today__group:first-child { border-top: 0; border-radius: var(--radius-lg) var(--radius-lg) 0 0; }
.today__row { display: grid; grid-template-columns: 88px minmax(0, 1fr) auto; align-items: center; gap: 16px; padding: 14px 20px; border-top: 1px solid var(--line); }
.today__time time { display: block; font-size: var(--text-lg); font-weight: 600; }
.today__phase { display: block; font-size: var(--text-xs); color: var(--ink-3); }
.today__name { font-size: var(--text-md); font-weight: 600; color: var(--ink); }
.today__child { font-weight: 400; color: var(--ink-2); }
.today__meta { display: flex; flex-wrap: wrap; gap: 2px 12px; margin-top: 2px; font-size: var(--text-sm); color: var(--ink-2); }
.today__attendance { display: flex; flex-shrink: 0; gap: 6px; }
.today__attendance .el-button + .el-button { margin-left: 0; }
.today .is-ongoing { background: var(--el-color-success-light-9); }
.today .is-ongoing .today__phase { color: var(--status-live-ink); font-weight: 500; }
.today .is-ended .today__time time, .today .is-ended .today__phase { color: var(--brand-gold-ink); }
.today .is-done .today__phase { color: var(--status-live-ink); }
.today .is-done .today__time time, .today .is-no_show .today__time time, .today .is-done .today__name, .today .is-no_show .today__name { color: var(--ink-3); }
.today__empty { margin: 0; padding: 20px; color: var(--ink-2); }
.today__empty a { margin-left: 8px; }


/* 本週五校：小表，數字靠右。 */
.dash__week table { width: 100%; border-collapse: collapse; font-size: var(--text-sm); }
.dash__week th, .dash__week td { padding: 9px 20px; text-align: right; border-top: 1px solid var(--line); }
.dash__week thead th { border-top: 0; padding-top: 10px; padding-bottom: 6px; font-size: var(--text-xs); font-weight: 600; color: var(--ink-3); }
.dash__week th[scope="row"], .dash__week th:first-child { text-align: left; font-weight: 600; }
.dash__week th + th, .dash__week td + td { padding-left: 8px; }
.dash__week .is-off td { color: var(--ink-3); }

/* 要處理：一列一件，數字、標題、查看。 */
.task { display: flex; gap: 12px; align-items: flex-start; padding: 12px 16px; color: var(--ink); }
.task + .task { border-top: 1px solid var(--line); }
.task > div { flex: 1; min-width: 0; display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 10px; }
a.task:hover { text-decoration: none; background: var(--surface-2); }
.task--urgent .task__number { background: var(--el-color-warning-light-9); color: var(--brand-gold-ink); }
.task__number { flex-shrink: 0; display: grid; place-items: center; min-width: 28px; height: 28px; padding: 0 6px; border-radius: var(--radius); background: var(--el-color-primary-light-9); color: var(--admin-accent-hover); font-weight: 600; font-size: var(--text-sm); }
.task h3 { font-size: var(--text-base); font-weight: 500; flex: 1 1 auto; }
.task p { flex-basis: 100%; order: 1; color: var(--ink-2); font-size: var(--text-sm); line-height: 1.6; max-width: 60ch; }
.task__sub { color: var(--ink-3); font-size: var(--text-sm); }
.task__action { color: var(--el-color-primary); font-weight: 500; font-size: var(--text-sm); }
.task__kinds, .task__rows { flex-basis: 100%; order: 2; }
.task__kinds { display: flex; flex-wrap: wrap; gap: 6px 16px; margin-top: 6px; }
.task__kinds a, .task__rows a { color: var(--el-color-primary); font-weight: 500; font-size: var(--text-sm); }
.task__rows { list-style: none; margin: 6px 0 0; padding: 0; display: grid; gap: 4px; }
.task__rows li { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 10px; }
.task__rows li > span { color: var(--ink-3); font-size: var(--text-sm); overflow-wrap: anywhere; min-width: 0; }
.task__rows li > span.is-live { color: var(--el-color-danger); }
.task__retry { margin-top: 8px; order: 3; }
.dash__updated { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 0 4px; }
.dash__updated .hint.is-failed { color: var(--el-color-warning-dark-2); }
/* 背景重讀時保留舊資料，只淡一點表示正在更新。 */
.dash__task-list { transition: opacity 180ms var(--ease-out); }
.dash__task-list.is-refreshing { opacity: .6; }
.dash__clear { padding: 16px; color: var(--ink-3); }
.dash__clear h3 { font-size: var(--text-base); font-weight: 500; }
.dash__checking { padding: 16px; color: var(--ink-3); }

/* 常用：一列文字連結。 */
.dash__links { display: flex; flex-wrap: wrap; gap: 8px 20px; margin-top: 28px; }
.dash__links .hint { flex-basis: 100%; }
.dash__links a { font-weight: 500; }

@media (max-width: 1100px) { .dash__board { grid-template-columns: minmax(0, 1fr); } }
@media (max-width: 720px) {
  .dash__intro { flex-direction: column; gap: 14px; }
  .dash__primary { width: 100%; }
  .dash__title { font-size: var(--text-2xl); }
  .today__row { grid-template-columns: 72px minmax(0, 1fr); gap: 8px 12px; padding: 14px 16px; }
  .today__meta a { display: inline-flex; align-items: center; min-height: 44px; }
  /* 手機：按鈕換到名字下面一整列，各占一半、44px 高。 */
  .today__attendance { grid-column: 1 / -1; }
  .today__attendance .el-button { flex: 1 1 0; min-height: 44px; }
  .task { padding: 12px 14px; }
  .task__kinds a, .task__rows a, a.task__action { display: inline-flex; align-items: center; min-height: 44px; }
  .dash__links a { display: inline-flex; align-items: center; min-height: 44px; }
}
</style>
