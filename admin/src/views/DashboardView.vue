<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { api } from '../api/client'
import { apiErrorCode, apiErrorMessage } from '../api/errors'
import { notifyError } from '../composables/notify'
import { confirmAttendance, submitAttendance, type AttendanceKind } from '../composables/visitAttendance'
import { attentionListPath, campusLabel, campusLabels, contentEditorPath, contentItemLabel, formatDateTime, formatHoldRemaining, formatShortSlotWhen, formatTime, visitDisplay } from '../api/labels'
import type { VisitRequestDetailOut } from '../api/types'
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
  new_requests?: number
  awaiting_confirmation?: number
  next_hold_expires_at?: string | null
  pending_reschedule_requests?: number
  my_unread_notifications?: number
  needs_attention?: number
  pending_follow_up: number
  // 招生待追蹤（2026-10-04 參觀後追蹤規格 7.7）：招生入學開啟且有 admissions.read 才有這兩個鍵。
  admissions_follow_up_due?: number
  admissions_follow_up_due_by_campus?: Record<string, number>
  pending_publish: number
  pending_publish_kinds?: string[]
  pending_publish_items?: PendingPublishItem[]
  content_media_issues?: MediaIssue[]
  failed_publish_jobs?: FailedPublishJob[]
  pending_review?: number
  campuses_without_active_booking: string[]
  // 開放家長選時段，但官網現在沒有任何可預約的場次（2026-09-25 起）。
  campuses_slots_without_openings?: string[]
  // 開放線上表單，但「預約文案」沒有發布中的同意文字：官網對家長顯示暫停（2026-09-26 起）。
  failed_notifications: number
  // 指派給我、還沒結案的件數（2026-10-03 第八輪，和列表 ?assignee=me&open=1 同一批）。
  my_open_cases?: number
  // 承辦人帳號已停用、還沒結案的件數；只有能重新指派的人（booking.manage）才有。
  inactive_assignee_open_cases?: number
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
// 我承辦的案件：最多列 5 筆（最早送出的在前），其餘點「查看全部」。不算待辦。
const MINE_LIMIT = 5
const MINE_LIST_PATH = '/visit-requests?assignee=me&open=1&order=oldest'
const mine = ref<VisitRequestDetailOut[]>([])
const myOpenCases = computed(() => summary.value?.my_open_cases ?? 0)
const inactiveAssigneeCases = computed(() => summary.value?.inactive_assignee_open_cases ?? 0)
async function loadMine() {
  if (!(myOpenCases.value > 0 && can('booking.read'))) {
    mine.value = []
    return
  }
  try {
    mine.value = await api.get<VisitRequestDetailOut[]>(`/admin/visit-requests?assignee=me&open=true&order=oldest&page_size=${MINE_LIMIT}`)
  } catch {
    // 讀不到名單時這一區不顯示；總覽其他部分照常。
    mine.value = []
  }
}
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
    void loadMine()
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
// 今天的參觀依現在時間標示：場次時間是台北的「HH:MM:SS」，跟台北現在的「HH:MM」比字串即可。
// 清單只有已確認、還沒標記到場的案件（標完就離開清單），所以結束了的一定還沒標記。
const nowClock = computed(() => clockFormatter.format(new Date(clockNow.value)))
function visitPhase(visit: TodayVisit): 'ended' | 'ongoing' | '' {
  const now = nowClock.value
  if (formatTime(visit.end_time) <= now) return 'ended'
  if (formatTime(visit.start_time) <= now) return 'ongoing'
  return ''
}
const VISIT_PHASE_LABELS = { ended: '已結束・待標記到場', ongoing: '進行中' } as const
// 今天的名單直接標記到場（2026-10-05 第九輪）：場次開始後（進行中、已結束）才出現，同案件列表；
// 先確認一次，寫出家長與場次。標完就離開名單（後端只列還沒標記的），重讀彙總。
const canHandleVisits = computed(() => can('booking.handle'))
const attendanceBusy = ref<string | null>(null)
async function markTodayAttendance(visit: TodayVisit, kind: AttendanceKind) {
  const row = { status: 'confirmed', parent_name: visit.parent_name, slot: { slot_date: taipeiDay(clockNow.value), start_time: visit.start_time, end_time: visit.end_time } }
  const withAdmissions = kind === 'complete' && Boolean(authStore.features.admissions)
  if (attendanceBusy.value || !(await confirmAttendance(kind, row, withAdmissions))) return
  attendanceBusy.value = visit.id
  try {
    await submitAttendance(visit.id, kind)
    ElMessage.success(kind === 'no_show' ? `已標記 ${visit.parent_name} 未到場` : `已標記 ${visit.parent_name} 已到場${withAdmissions ? '，招生訪視已建立' : ''}`)
  } catch (err) {
    notifyError(apiErrorCode(err) === 'INVALID_TRANSITION' ? `${visit.parent_name} 這筆剛被其他人處理過，名單已更新` : apiErrorMessage(err, '操作失敗'))
  } finally {
    attendanceBusy.value = null
    await load({ quiet: true })
  }
}
// 「今日參觀」的入口：有名單就捲到同頁「今天的參觀」，跟數字同一批人（第四輪：數字的入口要同定義）。
// router 沒有 scrollBehavior，帶 hash 的 router-link 不會捲，自己捲；焦點移到標題，鍵盤使用者接著往下讀。
const todayHeading = ref<HTMLElement | null>(null)
function showTodayList() {
  const heading = todayHeading.value
  if (!heading) return
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  heading.scrollIntoView?.({ block: 'start', behavior: reduce ? 'auto' : 'smooth' })
  heading.focus({ preventScroll: true })
}
const holdRemaining = computed(() => formatHoldRemaining(summary.value?.next_hold_expires_at, clockNow.value))

// 草稿、排程這類清單只要知道哪一天幾點，不寫年份：「09/28 21:45」。
function shortDateTime(value: string | null | undefined): string {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : shortDateTimeFormatter.format(date).replace(/\s+/g, ' ')
}

const newRequests = computed(() => summary.value?.new_requests ?? 0)
const awaiting = computed(() => summary.value?.awaiting_confirmation ?? 0)
// 摘要格數：今日參觀、到期待追蹤固定兩格，舊案的兩格有數字才加進來。
const summaryCols = computed(() => 2 + (newRequests.value > 0 ? 1 : 0) + (awaiting.value > 0 ? 1 : 0))
const reschedules = computed(() => summary.value?.pending_reschedule_requests ?? 0)
// 給自己的內容通知（送審、核准或退回、排程沒有發布）還沒讀的則數：側欄不掛數字，改在總覽與頁首提醒。
const myNotices = computed(() => summary.value?.my_unread_notifications ?? 0)
// 關了時段、設了休假日或停用分校，但家長還要來的案件：不聯絡的話家長會照原時間到園。
const needsAttention = computed(() => summary.value?.needs_attention ?? 0)
const followUpDue = computed(() => summary.value?.pending_follow_up ?? 0)
// 招生待追蹤：連到第一個有到期的校區的「待追蹤」分頁；多校時列出各校筆數（只列大於 0 的）。
const admissionsDue = computed(() => summary.value?.admissions_follow_up_due ?? 0)
const admissionsDueCampuses = computed(() =>
  Object.entries(summary.value?.admissions_follow_up_due_by_campus ?? {}).filter(([, count]) => count > 0),
)
const admissionsDuePath = computed(() => {
  const first = admissionsDueCampuses.value[0]?.[0]
  return first ? `/admissions?tab=followups&campus=${first}` : '/admissions?tab=followups'
})
const awaitingAttendance = computed(() => summary.value?.awaiting_attendance ?? 0)
// 主按鈕帶去最急的一批：有占位待確認就先處理（逾期會自動釋出名額），
// 再來是場次關了家長還要來、改期申請、新需求、到期追蹤。按鈕上的字講的是
// 點進去那一批，數字也只算那一批，不把幾批加總之後只帶去其中一批。
// 最早送出的先處理，占位也是最早到期的在前面。
const primary = computed(() => {
  if (awaiting.value > 0) return { to: '/visit-requests?status=pending_confirmation&order=oldest', label: '確認場次預約', count: awaiting.value }
  // 待辦清單最上面那項：不聯絡的話家長會照原時間到園。
  if (needsAttention.value > 0) return { to: attentionListPath(), label: '聯絡要改期的家長', count: needsAttention.value }
  // 家長在等園方回覆能不能改期，原時段也可能快到了，排在新需求前面。
  if (reschedules.value > 0) return { to: '/notifications', label: '核准改期申請', count: reschedules.value }
  if (newRequests.value > 0) return { to: '/visit-requests?status=new&order=oldest', label: '聯絡新需求', count: newRequests.value }
  if (followUpDue.value > 0) return { to: '/visit-requests?due=1', label: '追蹤到期案件', count: followUpDue.value }
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

// 引導語只提自己做得到的事：櫃台沒有內容權限，不提官網更新。
const lead = computed(() => {
  if (canEditContent.value) return '先確認參觀安排，再處理家長需求與官網更新。'
  if (can('booking.handle')) return '先確認今天的參觀，再聯絡新需求與待確認的家長。'
  return '查看今天的參觀安排與還沒處理的案件。'
})

// 常用工作：一樣只列點得進去的。櫃台看得到時段但不能新增，改成「查看」；
// 櫃台常接電話或現場預約，補登從案件列表的「補登案件」進去。
const shortcuts = computed(() =>
  [
    ...(can('booking.handle') && !canEditContent.value
      ? [{ to: '/visit-requests', title: '查看參觀案件', hint: '電話或現場預約用「補登案件」記下來' }]
      : []),
    // 參觀場次一頁同時是場次設定與接待月曆（2026-09-30 合併），只放一個入口。
    canManageBooking.value
      ? { to: '/visit-calendar', title: '設定參觀場次', hint: '固定場次、名額與每天誰要來' }
      : { to: '/visit-calendar', title: '查看參觀場次', hint: '各場名額與每天誰要來' },
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
    openCount.value > 0 ||
    inactiveAssigneeCases.value > 0 ||
    reschedules.value > 0 ||
    (myNotices.value > 0 && canOpen('/releases')) ||
    needsAttention.value > 0 ||
    s.pending_follow_up > 0 ||
    admissionsDue.value > 0 ||
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
      <div><p class="dash__date">{{ todayLabel }}</p><h2>今天的工作</h2><p class="dash__lead">{{ lead }}</p></div>
      <router-link class="dash__primary" :to="primary.to">{{ primary.label }}<span v-if="primary.count" class="dash__primary-count num">{{ primary.count }}<span class="visually-hidden"> 件</span></span> <span aria-hidden="true">→</span></router-link>
    </div>
    <el-alert v-if="error" type="error" :closable="false" show-icon :title="error">
      <el-button @click="load()">重新載入</el-button>
    </el-alert>
    <el-skeleton v-else-if="loading" animated :rows="6" />
    <template v-else-if="summary">
      <!-- 家長自選場次後，「新需求待聯絡」「待園方確認」只剩改版前的舊案會有數字（2026-10-05 起
           有數字才出現）：恆為 0 的兩格不再占掉手機首屏一半；有舊案或日後改回人工確認時自動回來。 -->
      <dl class="dash__summary" aria-label="營運摘要" :style="{ '--summary-cols': summaryCols }">
        <div v-if="newRequests > 0" class="is-attention"><dt>新需求待聯絡</dt><dd>{{ newRequests }}<span>件</span></dd><dd class="dash__more"><router-link to="/visit-requests?status=new&order=oldest">查看新需求</router-link></dd></div>
        <div v-if="awaiting > 0" class="is-attention"><dt>待園方確認</dt><dd>{{ awaiting }}<span>件</span></dd><dd class="dash__more"><router-link to="/visit-requests?status=pending_confirmation&order=oldest">{{ holdRemaining ? `最早一筆${holdRemaining}` : '查看待確認案件' }}</router-link></dd></div>
        <div><dt>今日參觀</dt><dd>{{ summary.today_visits }}<span>組</span></dd><dd class="dash__more"><a v-if="summary.today_visit_list?.length" href="#today-title" @click.prevent="showTodayList">看今天的名單</a><router-link v-else to="/visit-requests?group=upcoming&order=oldest">查看預約正常的案件</router-link></dd></div>
        <div><dt>到期待追蹤</dt><dd>{{ summary.pending_follow_up }}<span>件</span></dd><dd class="dash__more"><router-link to="/visit-requests?due=1">查看到期案件</router-link></dd></div>
      </dl>
      <section v-if="summary.today_visit_list?.length" class="dash__today" aria-labelledby="today-title">
        <div class="section__title"><h2 id="today-title" ref="todayHeading" tabindex="-1">今天的參觀</h2><span class="hint">點一筆查看聯絡紀錄與電話</span></div>
        <ol class="panel today">
          <li v-for="visit in summary.today_visit_list" :key="visit.id" :class="visitPhase(visit) && `is-${visitPhase(visit)}`">
            <router-link :to="`/visit-requests/${visit.id}`">
              <time class="today__time num">{{ formatTime(visit.start_time) }}–{{ formatTime(visit.end_time) }}</time>
              <strong class="today__name">{{ visit.parent_name }}</strong>
              <span class="today__campus">{{ campusLabel(visit.campus_key) }}<template v-if="visitPhase(visit)"><span aria-hidden="true">・</span><span class="today__phase">{{ VISIT_PHASE_LABELS[visitPhase(visit) as 'ended' | 'ongoing'] }}</span></template></span>
              <span class="today__go" aria-hidden="true">→</span>
            </router-link>
            <!-- 按鈕不能包在連結裡：和連結並排在同一列。 -->
            <span v-if="canHandleVisits && visitPhase(visit)" class="today__attendance" role="group" :aria-label="`${visit.parent_name} 到了嗎？`">
              <el-button size="small" type="primary" plain :loading="attendanceBusy === visit.id" :disabled="Boolean(attendanceBusy)" :aria-label="`標記 ${visit.parent_name} 已到場`" @click="markTodayAttendance(visit, 'complete')">到了</el-button>
              <el-button size="small" :disabled="Boolean(attendanceBusy)" :aria-label="`標記 ${visit.parent_name} 未到場`" @click="markTodayAttendance(visit, 'no_show')">沒來</el-button>
            </span>
          </li>
        </ol>
      </section>
      <section v-if="mine.length" class="dash__mine" aria-labelledby="mine-title">
        <div class="section__title">
          <h2 id="mine-title">我承辦的案件</h2>
          <router-link class="dash__mine-all" :to="MINE_LIST_PATH">查看全部 {{ myOpenCases }} 件 <span aria-hidden="true">→</span></router-link>
        </div>
        <ol class="panel today mine">
          <li v-for="row in mine" :key="row.id">
            <router-link :to="`/visit-requests/${row.id}`">
              <strong class="today__name">{{ row.parent_name }}</strong>
              <span class="today__campus">{{ visitDisplay(row).label }}<template v-if="row.slot"><span aria-hidden="true">・</span>{{ formatShortSlotWhen(row.slot) }}</template></span>
              <span class="today__go" aria-hidden="true">→</span>
            </router-link>
          </li>
        </ol>
      </section>
      <div class="dash__workspace">
        <section class="dash__tasks" aria-labelledby="tasks-title">
          <div class="section__title">
            <h2 id="tasks-title">待辦與提醒</h2>
            <div class="dash__updated">
              <span class="hint" :class="{ 'is-failed': refreshFailed }">{{ refreshFailed ? `沒有更新成功，仍是 ${updatedLabel} 的資料` : `更新於 ${updatedLabel}` }}</span>
              <el-button text :loading="refreshing" @click="load({ quiet: true })">重新整理</el-button>
            </div>
          </div>
          <!-- 背景重讀（切回分頁也會發生）只把待辦區標成忙碌，不讓整頁暫時不唸。 -->
          <div class="panel dash__task-list" :class="{ 'is-refreshing': refreshing }" :aria-busy="refreshing">
            <router-link v-if="needsAttention > 0" class="task task--urgent" :to="attentionListPath()" v-bind="taskAria('attention')">
              <span id="task-attention-n" class="task__number">{{ needsAttention }}</span>
              <div><h3 id="task-attention-t">場次已關閉或分校停用，家長還要來</h3><p id="task-attention-d">這些案件的場次已關閉（含休假日），或分校已停用但還沒結案。請聯絡家長改期到其他場次或取消，避免家長照原時間到園；那一場其實照常接待的話，重新開放場次並把名額調成已占用的組數。</p><span id="task-attention-a" class="task__action">查看待人工處理的案件 <span aria-hidden="true">→</span></span></div>
            </router-link>
            <router-link v-if="awaiting > 0" class="task task--urgent" to="/visit-requests?status=pending_confirmation&order=oldest" v-bind="taskAria('awaiting')">
              <span id="task-awaiting-n" class="task__number">{{ awaiting }}</span>
              <div><h3 id="task-awaiting-t">場次預約等園方確認</h3><p id="task-awaiting-d">家長已選好場次，名額先保留著；逾期沒確認會自動釋出。<template v-if="summary.next_hold_expires_at">最早一筆要在 <strong class="num">{{ formatDateTime(summary.next_hold_expires_at) }}</strong> 前確認。</template></p><span id="task-awaiting-a" class="task__action">從最早送出的開始確認 <span aria-hidden="true">→</span></span></div>
            </router-link>
            <router-link v-if="reschedules > 0" class="task task--urgent" to="/notifications" v-bind="taskAria('reschedule')">
              <span id="task-reschedule-n" class="task__number">{{ reschedules }}</span>
              <div><h3 id="task-reschedule-t">家長申請改期，等你核准</h3><p id="task-reschedule-d">家長用管理連結申請換場次；核准前原場次仍有效。核准或退回後請告知家長。</p><span id="task-reschedule-a" class="task__action">查看改期申請 <span aria-hidden="true">→</span></span></div>
            </router-link>
            <router-link v-if="newRequests > 0" class="task" to="/visit-requests?status=new&order=oldest" v-bind="taskAria('new')">
              <span id="task-new-n" class="task__number">{{ newRequests }}</span>
              <div><h3 id="task-new-t">新的參觀需求還沒聯絡</h3><p id="task-new-d">家長送出後在等園方回電。聯絡後記一筆紀錄，談好時間就排入場次。</p><span id="task-new-a" class="task__action">從最早送出的開始聯絡 <span aria-hidden="true">→</span></span></div>
            </router-link>
            <router-link v-if="summary.pending_follow_up > 0" class="task" to="/visit-requests?due=1" v-bind="taskAria('due')">
              <span id="task-due-n" class="task__number">{{ summary.pending_follow_up }}</span>
              <div><h3 id="task-due-t">案件已到追蹤時間</h3><p id="task-due-d">之前記下「下次聯絡」的案件到期了。聯絡後在案件裡新增紀錄，需要再追就填新的日期。</p><span id="task-due-a" class="task__action">查看到期案件 <span aria-hidden="true">→</span></span></div>
            </router-link>
            <router-link v-if="admissionsDue > 0" class="task" :to="admissionsDuePath" v-bind="taskAria('admissions-due')">
              <span id="task-admissions-due-n" class="task__number">{{ admissionsDue }}</span>
              <div>
                <h3 id="task-admissions-due-t">參觀後該聯絡的家長</h3>
                <p id="task-admissions-due-d">
                  招生訪視排的下次聯絡到了。聯絡後按「記錄聯絡」，再決定下次什麼時候聯絡或不用再追。
                  <template v-if="admissionsDueCampuses.length > 1">{{ admissionsDueCampuses.map(([key, count]) => `${campusLabel(key)} ${count}`).join('、') }}。</template>
                </p>
                <span id="task-admissions-due-a" class="task__action">到招生入學的待追蹤 <span aria-hidden="true">→</span></span>
              </div>
            </router-link>
            <router-link v-if="awaitingAttendance > 0" class="task" to="/visit-requests?group=past&status=confirmed" v-bind="taskAria('arrival')">
              <span id="task-arrival-n" class="task__number">{{ awaitingAttendance }}</span>
              <div><h3 id="task-arrival-t">參觀時間過了，還沒標記到場</h3><p id="task-arrival-d">家長來了就標記「已到場」，沒來就標記「未到場」；沒標記的話，成效統計的到場數字會偏低。</p><span id="task-arrival-a" class="task__action">查看待標記的案件 <span aria-hidden="true">→</span></span></div>
            </router-link>
            <router-link v-if="inactiveAssigneeCases > 0" class="task" to="/visit-requests?assignee=inactive&open=1" v-bind="taskAria('orphaned')">
              <span id="task-orphaned-n" class="task__number">{{ inactiveAssigneeCases }}</span>
              <div><h3 id="task-orphaned-t">承辦人已停用，案件還沒結案</h3><p id="task-orphaned-d">這些案件的承辦人帳號已經停用，沒有人會收到提醒。請點進去重新指派給其他同事。</p><span id="task-orphaned-a" class="task__action">查看要重新指派的案件 <span aria-hidden="true">→</span></span></div>
            </router-link>
            <router-link v-if="myNotices > 0 && canOpen('/releases')" class="task" to="/releases" v-bind="taskAria('notices')">
              <span id="task-notices-n" class="task__number">{{ myNotices }}</span>
              <div><h3 id="task-notices-t">有內容通知還沒看</h3><p id="task-notices-d">送審、核准或退回，以及排程沒有發布的通知。退回的會寫明原因。</p><span id="task-notices-a" class="task__action">查看內容通知 <span aria-hidden="true">→</span></span></div>
            </router-link>
            <router-link v-if="campusesWithoutBooking.length && canOpen('/booking')" class="task" to="/booking" v-bind="taskAria('booking')">
              <span id="task-booking-n" class="task__number">{{ campusesWithoutBooking.length }}</span>
              <div><h3 id="task-booking-t">校區尚未開放預約</h3><p id="task-booking-d">{{ campusLabels(campusesWithoutBooking) }}目前暫停或尚未設定預約方式，家長無法送出需求。</p><span id="task-booking-a" class="task__action">檢查各校預約方式 <span aria-hidden="true">→</span></span></div>
            </router-link>
            <div v-else-if="campusesWithoutBooking.length" class="task">
              <span class="task__number">{{ campusesWithoutBooking.length }}</span>
              <div><h3>校區尚未開放預約</h3><p>{{ campusLabels(campusesWithoutBooking) }}目前暫停或尚未設定預約方式，家長無法從官網送出需求。預約方式由校區管理者設定。</p></div>
            </div>
            <router-link v-if="slotsWithoutOpenings.length" class="task" to="/visit-calendar" v-bind="taskAria('slots')">
              <span id="task-slots-n" class="task__number">{{ slotsWithoutOpenings.length }}</span>
              <div v-if="canManageBooking"><h3 id="task-slots-t">開放選場次，但沒有可預約的場次</h3><p id="task-slots-d">{{ campusLabels(slotsWithoutOpenings) }}官網顯示「目前沒有開放的參觀場次」，家長送不出預約。請新增場次或每週開放規則，或改用其他預約方式。</p><span id="task-slots-a" class="task__action">設定參觀場次 <span aria-hidden="true">→</span></span></div>
              <div v-else><h3 id="task-slots-t">開放選場次，但沒有可預約的場次</h3><p id="task-slots-d">{{ campusLabels(slotsWithoutOpenings) }}官網顯示「目前沒有開放的參觀場次」，家長送不出預約。新增場次或每週開放規則由校區管理者處理。</p><span id="task-slots-a" class="task__action">查看參觀場次 <span aria-hidden="true">→</span></span></div>
            </router-link>
            <router-link v-if="summary.failed_notifications > 0" class="task" to="/notifications" v-bind="taskAria('notify')">
              <span id="task-notify-n" class="task__number">{{ summary.failed_notifications }}</span>
              <div><h3 id="task-notify-t">通知寄送失敗</h3><p id="task-notify-d">自動重試後仍沒送出的 Email 或 LINE 通知。查看失敗原因，修好設定後重新寄送。</p><span id="task-notify-a" class="task__action">查看並重新寄送 <span aria-hidden="true">→</span></span></div>
            </router-link>
            <div v-if="failedJobs.length > 0" class="task task--urgent">
              <span class="task__number">{{ failedJobs.length }}</span>
              <div>
                <h3>排程發布沒有執行</h3>
                <p>時間到了但檢查沒通過，官網還是舊內容。看過原因、修好後直接發布或重新排程；決定不發布就在編輯頁按「知道了」。</p>
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
                <p>有內容送上來等審核（件數可能包含你無法開啟的內容），但清單沒有讀到，這裡暫時列不出是哪幾項。</p>
                <el-button class="task__retry" :loading="reviewsLoading" @click="loadReviews()">重新載入送審清單</el-button>
              </div>
            </div>
            <div v-if="visibleReviews.length > 0" class="task">
              <span class="task__number">{{ visibleReviews.length }}</span>
              <div>
                <h3>內容等你審核</h3>
                <p>內容編輯送上來的修改，核准後才會出現在官網；需要修改就退回並寫原因。</p>
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
                <p>引用的照片或影片已從素材庫刪除，或還在處理、處理失敗。官網上的版本有問題時家長會看到備用圖；草稿有問題則發布不了。請換一張素材。</p>
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
                <p>這些內容存過草稿，官網顯示的還是舊版或預設文字。檢查後再發布。</p>
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
            <div v-else-if="!hasTodo" class="dash__clear"><h3>目前沒有待處理事項</h3><p>{{ canEditContent ? '可以查看參觀安排，或利用下方入口整理官網內容。' : '可以查看參觀案件與參觀場次。' }}</p></div>
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
.dash__date { color: var(--ink-3); font-size: var(--text-sm); margin-bottom: 8px; }
.dash__intro h2 { font-size: var(--text-xl); }
.dash__lead { margin-top: 8px; color: var(--ink-2); }
.dash__primary { display: inline-flex; align-items: center; justify-content: center; gap: 20px; flex-shrink: 0; min-height: 44px; padding: 0 18px; border-radius: var(--radius); background: var(--el-color-primary); color: var(--surface); font-weight: 500; }
.dash__primary-count { min-width: 24px; margin-left: -12px; padding: 0 7px; border-radius: 999px; background: var(--surface); color: var(--el-color-primary); font-size: var(--text-sm); font-weight: 600; line-height: 22px; text-align: center; }
.dash__primary:hover { background: var(--el-color-primary-dark-2); text-decoration: none; }
.dash__summary { display: grid; grid-template-columns: repeat(var(--summary-cols, 4), minmax(0, 1fr)); margin: 0 0 28px; border: 1px solid var(--line); border-radius: var(--radius-lg); background: var(--surface); box-shadow: var(--shadow-sm); }
.dash__summary > div { min-width: 0; padding: 20px; }
.dash__summary > div + div { border-left: 1px solid var(--line); }
.dash__summary dt { font-size: var(--text-base); color: var(--ink-2); }
.dash__summary dd { display: flex; align-items: baseline; gap: 8px; margin: 8px 0 4px; font-size: var(--text-5xl); font-weight: 600; line-height: 1.25; font-variant-numeric: tabular-nums; }
.dash__summary dd span { font-size: var(--text-sm); font-weight: 400; color: var(--ink-3); }
.dash__summary > .is-attention dd { color: var(--brand-gold-ink); }
/* 連結也包在 dd 裡：<dl> 的每組只能有 dt、dd（axe definition-list）。 */
.dash__summary dd.dash__more { display: block; margin: 0; font-size: var(--text-sm); font-weight: 400; line-height: inherit; }
.dash__summary a { display: inline-flex; align-items: center; min-height: 28px; font-size: var(--text-sm); }
.dash__today { margin-bottom: 28px; }
.dash__mine { margin-bottom: 28px; }
.dash__mine-all { font-size: var(--text-sm); text-decoration: underline; }
.mine a { grid-template-columns: minmax(0, 1fr) auto auto; }
/* 從「看今天的名單」捲過來時，標題不要被頂欄蓋住。 */
.dash__today h2 { scroll-margin-top: calc(var(--top-h) + 16px); outline: none; }
.today { list-style: none; margin: 0; padding: 0; }
.today li + li { border-top: 1px solid var(--line); }
.today li { display: flex; align-items: center; }
.today li > a { flex: 1; min-width: 0; }
.today__attendance { display: flex; flex-shrink: 0; gap: 6px; padding-right: 20px; }
.today__attendance .el-button + .el-button { margin-left: 0; }
.today a { display: grid; grid-template-columns: auto 1fr auto auto; align-items: center; gap: 16px; padding: 14px 20px; color: var(--ink); }
.today a:hover { text-decoration: none; background: var(--surface-2); }
.today__time { font-size: var(--text-base); font-weight: 500; color: var(--el-color-primary); }
.today__name { font-size: var(--text-md); font-weight: 500; }
.today__campus { color: var(--ink-3); font-size: var(--text-sm); }
.today__go { color: var(--ink-3); }
/* 結束了還沒標記的灰掉；狀態另外寫成字，不只靠顏色。 */
.today .is-ended .today__time, .today .is-ended .today__name { color: var(--ink-3); }
.today .is-ended .today__phase { color: var(--brand-gold-ink); }
.today .is-ongoing .today__phase { color: var(--el-color-primary); font-weight: 500; }
.task__kinds { display: flex; flex-wrap: wrap; gap: 8px 20px; margin-top: 12px; }
.task__kinds a { color: var(--el-color-primary); font-weight: 500; font-size: var(--text-base); }
.task__rows { list-style: none; margin: 12px 0 0; padding: 0; display: grid; gap: 6px; }
.task__rows li { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 12px; font-size: var(--text-base); }
.task__rows a { color: var(--el-color-primary); font-weight: 500; }
.task__rows li > span { color: var(--ink-3); font-size: var(--text-sm); overflow-wrap: anywhere; min-width: 0; }
.task__rows li > span.is-live { color: var(--el-color-danger); }
.dash__workspace { display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(260px, 1fr); gap: 24px; align-items: start; }
.section__title h2 { font-size: var(--text-xl); }
.task { display: flex; gap: 16px; padding: 24px; color: var(--ink); }
.task + .task { border-top: 1px solid var(--line); }
a.task:hover { text-decoration: none; background: var(--surface-2); }
.task--urgent .task__number { background: var(--el-color-warning-light-9); color: var(--brand-gold-ink); }
.task p strong { color: var(--ink); font-weight: 600; }
.task__number { flex-shrink: 0; display: grid; place-items: center; width: 36px; height: 36px; border-radius: var(--radius); background: var(--el-color-primary-light-9); color: var(--admin-accent-hover); font-weight: 600; font-size: var(--text-xl); }
.task h3 { font-size: var(--text-lg); }
.task p { margin-top: 6px; color: var(--ink-2); max-width: 60ch; line-height: 1.7; }
.task__action { display: inline-flex; gap: 4px; margin-top: 12px; color: var(--el-color-primary); font-weight: 500; }
.task__retry { margin-top: 12px; }
.dash__tasks .section__title { align-items: center; }
.dash__updated { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 0 4px; }
.dash__updated .hint.is-failed { color: var(--el-color-warning-dark-2); }
/* 背景重讀時保留舊資料，只淡一點表示正在更新。 */
.dash__task-list { transition: opacity 180ms var(--ease-out); }
.dash__task-list.is-refreshing { opacity: .6; }
.dash__links a { display: flex; justify-content: space-between; align-items: center; gap: 16px; padding: 15px 0; border-bottom: 1px solid var(--line); color: var(--ink); }
.dash__links a:first-child { padding-top: 0; }
.dash__links a:hover { text-decoration: none; color: var(--el-color-primary); }
.dash__links strong { font-size: var(--text-base); font-weight: 500; }
.dash__links small { display: block; margin-top: 4px; color: var(--ink-3); font-size: var(--text-sm); }
.dash__clear { padding: 28px 24px; }
.dash__clear p { color: var(--ink-3); margin-top: 8px; }
.dash__checking { padding: 28px 24px; color: var(--ink-3); }
@media (max-width: 1100px) { .dash__workspace { grid-template-columns: minmax(0, 1fr); gap: 28px; } }
@media (max-width: 720px) {
  .dash__intro { align-items: flex-start; flex-direction: column; gap: 16px; }
  .dash__primary { width: 100%; }
  .dash__summary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .dash__summary > div { padding: 16px 12px; }
  .dash__summary > div:nth-child(odd) { border-left: 0; }
  .dash__summary > div:nth-child(n+3) { border-top: 1px solid var(--line); }
  .dash__summary a { min-height: 44px; }
  .dash__summary a, .dash__links small, .dash__date { font-size: var(--text-base); }
  .task { padding: 20px 16px; gap: 12px; }
  /* 草稿、素材、待審裡的內容連結與「查看全站排程」這類連結，手機點擊範圍至少 44px。 */
  .task__rows a, .task__kinds a, a.task__action { display: inline-flex; align-items: center; gap: 4px; min-height: 44px; }
  .task__rows { gap: 4px; }
  .task__rows li { flex-direction: column; align-items: flex-start; gap: 0; }
  /* 灰字往上靠，和連結的 44px 點擊範圍重疊 8px；連結疊在上面，重疊那段點下去仍是連結。 */
  .task__rows li > span { margin-top: -8px; }
  .task__rows a { position: relative; z-index: 1; }
  .task__kinds { gap: 0 20px; margin-top: 4px; }
  a.task__action { margin-top: 4px; }
  .today a { grid-template-columns: auto 1fr auto; gap: 4px 12px; padding: 14px 16px; }
  .today__time { grid-column: 1; grid-row: 1; }
  .today__name { grid-column: 2; grid-row: 1; }
  .today__campus { grid-column: 1 / 3; grid-row: 2; }
  .today__go { grid-column: 3; grid-row: 1 / span 2; align-self: center; }
  /* 手機：按鈕換到名字下面一整列，各占一半、44px 高。 */
  .today li { flex-wrap: wrap; }
  .today li > a { flex-basis: 100%; }
  .today__attendance { flex-basis: 100%; padding: 0 16px 14px; }
  .today__attendance .el-button { flex: 1 1 0; min-height: 44px; }
}
</style>
