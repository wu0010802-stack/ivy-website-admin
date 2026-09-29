<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api, ApiError } from '../api/client'
import {
  contentEditorPath,
  contentItemLabel,
  formatDateTime,
  publishJobStatus,
  releaseSourceLabel,
  userNotificationLabel,
} from '../api/labels'
import type { PublishJobListOut, ReleaseOut, ReleasePageOut, ReleaseRestoreOut, UserNotificationOut } from '../api/types'
import { usePermissions } from '../composables/usePermissions'
import { useOpenRequestsStore } from '../stores/openRequests'
import PageHeader from '../components/PageHeader.vue'
import StatusTag from '../components/StatusTag.vue'

// 全站發布紀錄（規格 L85、L155、L323）：官網每次換內容一筆，列出和前一次相比
// 換掉了哪些內容；總管理者可以把整站換回某次發布（存成新的一筆，不刪歷史）。
// 另外兩塊：全站排程（可取消）與給自己的內容通知（送審、核准或退回、排程沒執行）。
const route = useRoute()
const router = useRouter()
const { can } = usePermissions()
const openRequests = useOpenRequestsStore()
const canRestore = computed(() => can('content.release_restore'))

type Tab = 'releases' | 'schedules'
const tab = ref<Tab>(route.query.tab === 'schedules' ? 'schedules' : 'releases')
watch(tab, (value) => {
  void router.replace({ query: { ...route.query, tab: value === 'schedules' ? 'schedules' : undefined } })
})
watch(() => route.query.tab, (value) => { tab.value = value === 'schedules' ? 'schedules' : 'releases' })

let alive = true
onBeforeUnmount(() => { alive = false })

function apiDetail(err: unknown): { code?: string; message?: string; items?: { kind: string; campus_key: string | null; message: string }[] } {
  if (!(err instanceof ApiError)) return {}
  const detail = err.detail
  if (typeof detail === 'string') return { message: detail }
  return detail && typeof detail === 'object' ? (detail as ReturnType<typeof apiDetail>) : {}
}

// ---------------------------------------------------------------------------
// 給自己的通知
// ---------------------------------------------------------------------------

const notices = ref<UserNotificationOut[]>([])
const noticesError = ref('')
const noticeBusy = ref<string | null>(null)
const unreadNotices = computed(() => notices.value.filter((n) => !n.read_at).length)

async function loadNotices() {
  noticesError.value = ''
  try {
    const rows = await api.get<UserNotificationOut[]>('/admin/my-notifications')
    if (alive) notices.value = rows
  } catch {
    if (alive) noticesError.value = '無法讀取給你的通知，請重新整理。'
  }
}

function noticeDetail(n: UserNotificationOut): string {
  const parts: string[] = []
  if (n.revision_version) parts.push(`第 ${n.revision_version} 版`)
  if (n.publish_at) parts.push(`排程 ${formatDateTime(n.publish_at)}`)
  if (n.actor_email) parts.push(n.kind === 'content_review_submitted' ? `${n.actor_email} 送審` : n.actor_email)
  return parts.join('・')
}

function noticeReason(n: UserNotificationOut): string {
  if (n.error) return n.error
  if (n.note) return n.kind === 'content_review_rejected' ? `退回原因：${n.note}` : `備註：${n.note}`
  return ''
}

async function markNoticeRead(n: UserNotificationOut) {
  if (n.read_at || noticeBusy.value) return
  noticeBusy.value = n.id
  try {
    const updated = await api.post<UserNotificationOut>(`/admin/my-notifications/${n.id}/read`)
    n.read_at = updated.read_at ?? new Date().toISOString()
    openRequests.myNotices = Math.max(0, openRequests.myNotices - 1)
  } catch {
    if (alive) ElMessage.error('標記失敗，請重試')
  } finally {
    noticeBusy.value = null
  }
}

async function markAllNoticesRead() {
  if (noticeBusy.value || unreadNotices.value === 0) return
  noticeBusy.value = 'all'
  try {
    await api.post('/admin/my-notifications/read-all')
    const now = new Date().toISOString()
    for (const n of notices.value) if (!n.read_at) n.read_at = now
    openRequests.myNotices = 0
  } catch {
    if (alive) ElMessage.error('標記失敗，請重試')
  } finally {
    noticeBusy.value = null
  }
}

// 點通知連到編輯頁時順便標成已讀（不等結果，失敗下次再標）。
function openNotice(n: UserNotificationOut) {
  if (!n.read_at) void markNoticeRead(n)
}

// ---------------------------------------------------------------------------
// 發布紀錄
// ---------------------------------------------------------------------------

const releases = ref<ReleaseOut[]>([])
const nextBefore = ref<string | null>(null)
const releasesLoading = ref(false)
const releasesError = ref('')
const moreLoading = ref(false)
const restoringId = ref<string | null>(null)
let releaseVersion = 0

async function loadReleases() {
  const version = ++releaseVersion
  releasesLoading.value = true
  releasesError.value = ''
  try {
    const page = await api.get<ReleasePageOut>('/admin/releases?limit=30')
    if (!alive || version !== releaseVersion) return
    releases.value = page.items
    nextBefore.value = page.next_before
  } catch {
    if (alive && version === releaseVersion) releasesError.value = '無法讀取發布紀錄，請重試。'
  } finally {
    if (alive && version === releaseVersion) releasesLoading.value = false
  }
}

async function loadMore() {
  if (!nextBefore.value || moreLoading.value) return
  const version = releaseVersion
  moreLoading.value = true
  try {
    const page = await api.get<ReleasePageOut>(`/admin/releases?limit=30&before=${encodeURIComponent(nextBefore.value)}`)
    if (!alive || version !== releaseVersion) return
    const seen = new Set(releases.value.map((r) => r.id))
    releases.value = [...releases.value, ...page.items.filter((r) => !seen.has(r.id))]
    nextBefore.value = page.next_before
  } catch {
    if (alive) ElMessage.error('讀取更早的紀錄失敗，請重試')
  } finally {
    if (alive) moreLoading.value = false
  }
}

const currentRelease = computed(() => releases.value.find((r) => r.is_current) ?? null)

function restoredFromLabel(release: ReleaseOut): string {
  const source = releases.value.find((r) => r.id === release.restored_from_release_id)
  return source ? `還原成 ${formatDateTime(source.created_at)} 那次發布的內容` : '還原成較早一次發布的內容'
}

function versionChange(change: ReleaseOut['changes'][number]): string {
  return change.previous_revision_version === null
    ? `第一次上線（第 ${change.revision_version} 版）`
    : `第 ${change.previous_revision_version} 版 → 第 ${change.revision_version} 版`
}

async function restoreRelease(release: ReleaseOut) {
  if (!canRestore.value || restoringId.value || release.is_current) return
  const lines = [
    `會把官網每一項內容換回 ${formatDateTime(release.created_at)} 那次發布時的版本，存成一筆新的發布紀錄。`,
    '那次之後才第一次上線的內容維持現狀；各頁的草稿、預約設定、時段與案件都不會變。',
    '原本的紀錄都會保留，之後可以再還原回來。',
  ]
  try {
    await ElMessageBox.confirm(lines.join('\n'), '整站還原到這次發布？', {
      confirmButtonText: '整站還原',
      cancelButtonText: '先不要',
      type: 'warning',
      customStyle: { whiteSpace: 'pre-line' },
    })
  } catch {
    return
  }
  restoringId.value = release.id
  try {
    const result = await api.post<ReleaseRestoreOut>(`/admin/releases/${release.id}/restore`, {
      expected_current_release_id: currentRelease.value?.id ?? null,
    })
    if (!alive) return
    ElMessage.success(
      result.kept_count
        ? `已還原 ${result.changed_count} 項內容；${result.kept_count} 項之後才上線的內容維持現狀`
        : `已還原 ${result.changed_count} 項內容`,
    )
    await loadReleases()
  } catch (err) {
    if (!alive) return
    const detail = apiDetail(err)
    if (detail.code === 'RELEASE_NOT_RESTORABLE' && detail.items?.length) {
      const list = detail.items.map((p) => `・${contentItemLabel(p.kind, p.campus_key)}：${p.message}`).join('\n')
      void ElMessageBox.alert(`${detail.message ?? '有些內容不能發布，整站沒有變動'}\n${list}`, '沒有還原', {
        type: 'error',
        customStyle: { whiteSpace: 'pre-line' },
      })
    } else {
      ElMessage.error(detail.message ?? '還原失敗，請重試')
    }
    await loadReleases()
  } finally {
    if (alive) restoringId.value = null
  }
}

// ---------------------------------------------------------------------------
// 全站排程
// ---------------------------------------------------------------------------

const jobs = ref<PublishJobListOut[]>([])
const jobsLoading = ref(false)
const jobsError = ref('')
const cancellingId = ref<string | null>(null)
const upcomingJobs = computed(() => jobs.value.filter((j) => j.status === 'scheduled'))
const finishedJobs = computed(() => jobs.value.filter((j) => j.status !== 'scheduled'))

async function loadJobs() {
  jobsLoading.value = true
  jobsError.value = ''
  try {
    const rows = await api.get<PublishJobListOut[]>('/admin/publish-jobs')
    if (alive) jobs.value = rows
  } catch {
    if (alive) jobsError.value = '無法讀取排程，請重試。'
  } finally {
    if (alive) jobsLoading.value = false
  }
}

async function cancelJob(job: PublishJobListOut) {
  if (!job.can_cancel || cancellingId.value) return
  try {
    await ElMessageBox.confirm(
      `取消後 ${formatDateTime(job.publish_at)} 不會發布${contentItemLabel(job.kind, job.campus_key)}第 ${job.revision_version} 版。`,
      '取消這個排程？',
      { confirmButtonText: '取消排程', cancelButtonText: '先不要', type: 'warning' },
    )
  } catch {
    return
  }
  cancellingId.value = job.id
  const query = job.campus_key ? `?campus_key=${encodeURIComponent(job.campus_key)}` : ''
  try {
    await api.delete(`/admin/content-items/${job.kind}/schedules/${job.id}${query}`)
    if (alive) ElMessage.success('已取消排程')
  } catch (err) {
    if (alive) ElMessage.error(apiDetail(err).message ?? '取消失敗，請重試')
  } finally {
    if (alive) cancellingId.value = null
    await loadJobs()
  }
}

function refreshAll() {
  void loadNotices()
  void loadReleases()
  void loadJobs()
}

refreshAll()
</script>

<template>
  <div class="page publishing">
    <PageHeader lead="官網每次換內容都會留下一筆紀錄：誰在什麼時候發布了哪些內容。排好時間的發布也列在這裡，可以取消。">
      <template #actions>
        <el-button :disabled="releasesLoading || jobsLoading" @click="refreshAll">重新整理</el-button>
      </template>
    </PageHeader>

    <el-alert v-if="noticesError" :title="noticesError" type="error" show-icon :closable="false" class="inline-error" />
    <section v-if="notices.length" class="panel notices" aria-labelledby="notices-title">
      <div class="panel__head">
        <h2 id="notices-title">給你的通知<span v-if="unreadNotices" class="notices__count">（{{ unreadNotices }} 則未讀）</span></h2>
        <el-button text :disabled="unreadNotices === 0 || noticeBusy !== null" :loading="noticeBusy === 'all'" @click="markAllNoticesRead">全部標記已讀</el-button>
      </div>
      <ul class="notices__list">
        <li v-for="n in notices.slice(0, 20)" :key="n.id" class="notice" :class="{ 'is-read': n.read_at }">
          <span v-if="!n.read_at" class="notice__dot" aria-label="未讀" />
          <div class="notice__body">
            <strong>{{ userNotificationLabel(n.kind) }}</strong>
            <router-link v-if="n.content_kind" :to="contentEditorPath(n.content_kind, n.campus_key)" class="notice__link" @click="openNotice(n)">
              {{ contentItemLabel(n.content_kind, n.campus_key) }} →
            </router-link>
            <span v-if="noticeDetail(n)" class="notice__meta">{{ noticeDetail(n) }}</span>
            <span v-if="noticeReason(n)" class="notice__reason">{{ noticeReason(n) }}</span>
          </div>
          <div class="notice__side">
            <span class="num notice__time">{{ formatDateTime(n.created_at) }}</span>
            <el-button v-if="!n.read_at" size="small" text :loading="noticeBusy === n.id" :disabled="noticeBusy !== null" @click="markNoticeRead(n)">標記已讀</el-button>
          </div>
        </li>
      </ul>
    </section>

    <el-radio-group v-model="tab" class="publishing__tabs" aria-label="檢視">
      <el-radio-button value="releases">發布紀錄</el-radio-button>
      <el-radio-button value="schedules">排程發布<template v-if="upcomingJobs.length">（{{ upcomingJobs.length }}）</template></el-radio-button>
    </el-radio-group>

    <template v-if="tab === 'releases'">
      <p class="hint publishing__lead">
        每一筆列出和前一次相比換掉的內容<template v-if="!canRestore">；你只看得到自己負責的校區與共用內容</template>。單一內容要改回舊版，到該內容的「版本紀錄」還原。<template v-if="canRestore">一次發錯多項時，可以用「整站還原」把官網換回某次發布的樣子。</template>
      </p>
      <el-alert v-if="releasesError" :title="releasesError" type="error" show-icon :closable="false" class="inline-error">
        <el-button @click="loadReleases">重新載入</el-button>
      </el-alert>
      <el-skeleton v-else-if="releasesLoading && !releases.length" :rows="6" animated />
      <el-empty v-else-if="!releases.length" description="還沒有任何發布紀錄" />
      <ol v-else class="panel releases" aria-label="發布紀錄">
        <li v-for="release in releases" :key="release.id" class="release">
          <div class="release__head">
            <div class="release__when">
              <strong class="num">{{ formatDateTime(release.created_at) }}</strong>
              <span class="release__by">{{ releaseSourceLabel(release.source) }}・{{ release.created_by_email || '系統' }}</span>
            </div>
            <div class="release__tags">
              <el-tag v-if="release.is_current" type="success" size="small" disable-transitions>官網目前版本</el-tag>
              <el-tag v-if="release.source === 'release_restore'" type="warning" size="small" disable-transitions>整站還原</el-tag>
            </div>
          </div>
          <p v-if="release.source === 'release_restore'" class="release__restored">{{ restoredFromLabel(release) }}</p>
          <ul v-if="release.changes.length" class="release__changes">
            <li v-for="change in release.changes" :key="change.content_item_id">
              <router-link :to="contentEditorPath(change.kind, change.campus_key)">{{ contentItemLabel(change.kind, change.campus_key) }}</router-link>
              <span class="num release__version">{{ versionChange(change) }}</span>
            </li>
          </ul>
          <p v-else class="hint">內容和前一次相同（重新發布同一版）。</p>
          <div v-if="canRestore && !release.is_current" class="release__actions">
            <el-button size="small" :loading="restoringId === release.id" :disabled="restoringId !== null" @click="restoreRelease(release)">整站還原到這次</el-button>
          </div>
        </li>
      </ol>
      <div v-if="nextBefore" class="publishing__more">
        <el-button :loading="moreLoading" @click="loadMore">載入更早的紀錄</el-button>
      </div>
    </template>

    <template v-else>
      <el-alert v-if="jobsError" :title="jobsError" type="error" show-icon :closable="false" class="inline-error">
        <el-button @click="loadJobs">重新載入</el-button>
      </el-alert>
      <el-skeleton v-else-if="jobsLoading && !jobs.length" :rows="4" animated />
      <template v-else>
        <section class="panel jobs" aria-labelledby="upcoming-title">
          <div class="panel__head"><h2 id="upcoming-title">等待發布（{{ upcomingJobs.length }}）</h2></div>
          <p v-if="!upcomingJobs.length" class="jobs__empty">目前沒有排好時間的發布。到內容編輯頁按「排程發布」就會出現在這裡。</p>
          <ul v-else class="jobs__list">
            <li v-for="job in upcomingJobs" :key="job.id" class="job">
              <div class="job__main">
                <router-link :to="contentEditorPath(job.kind, job.campus_key)"><strong>{{ contentItemLabel(job.kind, job.campus_key) }}</strong></router-link>
                <span class="job__meta"><span class="num">{{ formatDateTime(job.publish_at) }}</span> 發布第 {{ job.revision_version }} 版<template v-if="job.created_by_email">・{{ job.created_by_email }} 排程</template></span>
              </div>
              <el-button v-if="job.can_cancel" size="small" :loading="cancellingId === job.id" :disabled="cancellingId !== null" @click="cancelJob(job)">取消排程</el-button>
            </li>
          </ul>
        </section>
        <section v-if="finishedJobs.length" class="panel jobs" aria-labelledby="finished-title">
          <div class="panel__head"><h2 id="finished-title">最近結束的排程</h2></div>
          <ul class="jobs__list">
            <li v-for="job in finishedJobs" :key="job.id" class="job">
              <div class="job__main">
                <span class="job__title">
                  <router-link :to="contentEditorPath(job.kind, job.campus_key)"><strong>{{ contentItemLabel(job.kind, job.campus_key) }}</strong></router-link>
                  <StatusTag :meta="publishJobStatus(job.status)" />
                </span>
                <span class="job__meta">排程 <span class="num">{{ formatDateTime(job.publish_at) }}</span>・第 {{ job.revision_version }} 版<template v-if="job.created_by_email">・{{ job.created_by_email }}</template></span>
                <span v-if="job.error" class="job__error" :class="{ 'is-failed': job.status === 'failed' }">{{ job.error }}</span>
              </div>
            </li>
          </ul>
        </section>
      </template>
    </template>
  </div>
</template>

<style scoped>
.publishing__tabs { margin-bottom: 16px; }
.publishing__lead { margin: 0 0 12px; max-width: 72ch; }
.publishing__more { display: flex; justify-content: center; margin-top: 16px; }

.notices { margin-bottom: 20px; }
.notices__count { margin-left: 4px; font-size: 14px; font-weight: 400; color: var(--ink-2); }
.notices__list { list-style: none; margin: 0; padding: 0; }
.notice { display: flex; align-items: flex-start; gap: 10px; padding: 14px 24px; }
.notice + .notice { border-top: 1px solid var(--line); }
.notice.is-read { color: var(--ink-3); }
.notice__dot { flex-shrink: 0; width: 8px; height: 8px; margin-top: 8px; border-radius: 50%; background: var(--el-color-primary); }
.notice.is-read .notice__body { padding-left: 18px; }
.notice__body { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
.notice__body strong { overflow-wrap: anywhere; }
.notice__link { font-size: 14px; }
.notice__meta { font-size: 13px; color: var(--ink-3); overflow-wrap: anywhere; }
.notice__reason { font-size: 13px; color: var(--ink-2); overflow-wrap: anywhere; }
.notice__side { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; flex-shrink: 0; }
.notice__time { font-size: 13px; color: var(--ink-3); }

.releases { list-style: none; margin: 0; padding: 0; }
.release { padding: 16px 24px; }
.release + .release { border-top: 1px solid var(--line); }
.release__head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.release__when { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.release__by { font-size: 13px; color: var(--ink-3); overflow-wrap: anywhere; }
.release__tags { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 6px; }
.release__restored { margin: 6px 0 0; font-size: 13px; color: var(--ink-2); }
.release__changes { list-style: none; margin: 10px 0 0; padding: 0; display: grid; gap: 4px; }
.release__changes li { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 12px; font-size: 14px; }
.release__version { font-size: 13px; color: var(--ink-3); }
.release__actions { margin-top: 12px; }

.jobs { margin-bottom: 20px; }
.jobs__empty { margin: 0; padding: 16px 24px; color: var(--ink-3); }
.jobs__list { list-style: none; margin: 0; padding: 0; }
.job { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 24px; }
.job + .job { border-top: 1px solid var(--line); }
.job__main { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.job__title { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.job__meta { font-size: 13px; color: var(--ink-3); overflow-wrap: anywhere; }
.job__error { font-size: 13px; color: var(--ink-2); overflow-wrap: anywhere; }
.job__error.is-failed { color: var(--el-color-danger); }

@media (max-width: 720px) {
  .notice, .release, .job { padding: 14px 16px; }
  .notice { flex-wrap: wrap; }
  .notice__side { flex-direction: row; align-items: center; width: 100%; justify-content: space-between; padding-left: 18px; }
  .job { flex-direction: column; align-items: stretch; }
  .job .el-button { min-height: 44px; }
  .release__head { flex-direction: column; }
  .release__tags { justify-content: flex-start; }
  .release__actions .el-button { width: 100%; min-height: 44px; }
}
</style>
