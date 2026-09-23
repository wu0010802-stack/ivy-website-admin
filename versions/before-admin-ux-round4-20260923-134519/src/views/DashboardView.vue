<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { api } from '../api/client'
import { campusLabel, campusLabels, CONTENT_KIND_LABELS, formatTime } from '../api/labels'
import { useAuthStore } from '../stores/auth'

interface TodayVisit {
  id: string
  parent_name: string
  campus_key: string
  start_time: string
  end_time: string
}

interface DashboardSummary {
  today_visits: number
  today_visit_list?: TodayVisit[]
  pending_follow_up: number
  pending_publish: number
  pending_publish_kinds?: string[]
  campuses_without_active_booking: string[]
  failed_notifications: number
}

// 內容 kind 與編輯頁路由同形，只差底線與連字號（home_hero → /content/home-hero）。
function kindPath(kind: string): string {
  return `/content/${kind.replace(/_/g, '-')}`
}

const authStore = useAuthStore()
const summary = ref<DashboardSummary | null>(null)
const loading = ref(true)
const error = ref<string | null>(null)

async function load() {
  loading.value = true
  error.value = null
  try {
    summary.value = await api.get<DashboardSummary>('/admin/dashboard')
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

const hasTodo = computed(() => {
  const s = summary.value
  if (!s) return false
  return (
    s.pending_follow_up > 0 ||
    s.pending_publish > 0 ||
    s.failed_notifications > 0 ||
    s.campuses_without_active_booking.length > 0
  )
})

onMounted(load)
</script>

<template>
  <div class="page dashboard">
    <div class="dash__intro">
      <div><p class="dash__date">{{ todayLabel }}</p><h2>今天的工作</h2><p class="dash__lead">先確認參觀安排，再處理家長需求與官網更新。</p></div>
      <router-link class="dash__primary" to="/visit-requests?status=new">處理參觀需求 <span aria-hidden="true">→</span></router-link>
    </div>
    <el-alert v-if="error" type="error" :closable="false" show-icon :title="error">
      <el-button @click="load">重新載入</el-button>
    </el-alert>
    <el-skeleton v-else-if="loading" animated :rows="6" />
    <template v-else-if="summary">
      <dl class="dash__summary" aria-label="營運摘要">
        <div><dt>今日參觀</dt><dd>{{ summary.today_visits }}<span>組</span></dd><router-link to="/visit-requests?status=confirmed">查看已確認案件</router-link></div>
        <div><dt>到期待追蹤</dt><dd>{{ summary.pending_follow_up }}<span>件</span></dd><span class="hint">已到預定聯絡時間</span></div>
        <div><dt>未發布的草稿</dt><dd>{{ summary.pending_publish }}<span>篇</span></dd><span class="hint">儲存過但從未發布</span></div>
        <div><dt>通知寄送失敗</dt><dd>{{ summary.failed_notifications }}<span>則</span></dd><router-link to="/notifications">查看通知紀錄</router-link></div>
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
            <router-link v-if="summary.pending_follow_up > 0" class="task" to="/visit-requests">
              <span class="task__number">{{ summary.pending_follow_up }}</span>
              <div><h3>案件已到追蹤時間</h3><p>查看預定聯絡時間，完成追蹤後更新案件。</p><span class="task__action">查看全部案件 →</span></div>
            </router-link>
            <router-link v-if="summary.campuses_without_active_booking.length" class="task" to="/booking">
              <span class="task__number">{{ summary.campuses_without_active_booking.length }}</span>
              <div><h3>校區尚未開放預約</h3><p>{{ campusLabels(summary.campuses_without_active_booking) }}目前暫停或尚未設定預約方式，家長無法送出需求。</p><span class="task__action">檢查各校預約方式 →</span></div>
            </router-link>
            <router-link v-if="summary.failed_notifications > 0" class="task" to="/notifications">
              <span class="task__number">{{ summary.failed_notifications }}</span>
              <div><h3>通知需要確認</h3><p>查看寄送失敗原因，再決定是否重新寄送。</p><span class="task__action">查看通知 →</span></div>
            </router-link>
            <div v-if="summary.pending_publish > 0" class="task">
              <span class="task__number">{{ summary.pending_publish }}</span>
              <div>
                <h3>草稿尚未公開</h3>
                <p>這些內容存過草稿，官網顯示的還是舊版。檢查後再發布。</p>
                <span class="task__kinds">
                  <router-link v-for="kind in summary.pending_publish_kinds" :key="kind" :to="kindPath(kind)">
                    {{ CONTENT_KIND_LABELS[kind] ?? kind }} →
                  </router-link>
                </span>
              </div>
            </div>
            <div v-if="!hasTodo" class="dash__clear"><h3>目前沒有待處理事項</h3><p>可以查看參觀安排，或利用下方入口整理官網內容。</p></div>
          </div>
        </section>
        <section class="dash__shortcuts" aria-labelledby="shortcuts-title">
          <div class="section__title"><h2 id="shortcuts-title">常用工作</h2></div>
          <div class="dash__links">
            <router-link to="/slots"><span><strong>安排參觀時段</strong><small>開放時間與可接待人數</small></span><span aria-hidden="true">→</span></router-link>
            <router-link to="/content/home-hero"><span><strong>更新首頁文字</strong><small>調整家長進站看到的標語</small></span><span aria-hidden="true">→</span></router-link>
            <router-link to="/content/campus-profile"><span><strong>修改各校資料</strong><small>校園介紹與聯絡方式</small></span><span aria-hidden="true">→</span></router-link>
            <router-link to="/media"><span><strong>整理照片與影片</strong><small>上傳素材、補上圖片說明</small></span><span aria-hidden="true">→</span></router-link>
            <router-link v-if="authStore.user?.role === 'super_admin'" to="/users"><span><strong>管理使用者</strong><small>帳號與校區權限</small></span><span aria-hidden="true">→</span></router-link>
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
.dash__primary:hover { background: var(--el-color-primary-dark-2); text-decoration: none; }
.dash__summary { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); margin: 0 0 28px; border: 1px solid var(--line); border-radius: var(--radius-lg); background: var(--surface); box-shadow: var(--shadow-sm); }
.dash__summary > div { min-width: 0; padding: 20px; }
.dash__summary > div + div { border-left: 1px solid var(--line); }
.dash__summary dt { font-size: 14px; color: var(--ink-2); }
.dash__summary dd { display: flex; align-items: baseline; gap: 8px; margin: 8px 0 4px; font-size: 28px; font-weight: 600; line-height: 1.25; font-variant-numeric: tabular-nums; }
.dash__summary dd span { font-size: 13px; font-weight: 400; color: var(--ink-3); }
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
.dash__workspace { display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(260px, 1fr); gap: 24px; align-items: start; }
.section__title h2 { font-size: 17px; }
.task { display: flex; gap: 16px; padding: 24px; color: var(--ink); }
.task + .task { border-top: 1px solid var(--line); }
a.task:hover { text-decoration: none; background: var(--surface-2); }
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
