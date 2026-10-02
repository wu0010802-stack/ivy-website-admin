<script setup lang="ts">
import { computed, ref, watch, type Component } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  ArrowDown, Avatar, Bell, Bottom, Calendar, ChatDotRound, ChatDotSquare, ChatLineSquare, Clock, Close, DataLine,
  Document as DocumentIcon, EditPen, Files, Grid, HomeFilled, Key, List, Location as LocationIcon,
  Notification as NotificationIcon, Phone, Picture, Postcard, Reading, School, Search, Setting, Sunny, Switch,
  SwitchButton, Tickets, Timer, TrendCharts, User,
} from '@element-plus/icons-vue'
import { canListNavItem, landingPath, NAV_GROUPS, navItemMatchScore, normalizeSearch, SEARCH_ONLY_GROUP } from '../router/nav'
import { useAuthStore } from '../stores/auth'
import { useOpenRequestsStore } from '../stores/openRequests'
import { campusLabels, roleLabel, staffLabel, staffWithEmail } from '../api/labels'
import ChangePasswordDialog from './ChangePasswordDialog.vue'
import crestMarkUrl from '../assets/brand/ivy-crest-mark.webp'

defineProps<{ mobile?: boolean }>()
const emit = defineEmits<{ close: []; logout: [] }>()
const auth = useAuthStore()
const openRequests = useOpenRequestsStore()
const route = useRoute()
const router = useRouter()
const query = ref('')
const passwordOpen = ref(false)
// 每天要用的總覽與參觀預約預設展開，內容三組與系統收起；使用者自己的
// 開合記在瀏覽器裡，下次進來不必重開。私密視窗或封鎖 site data 時讀寫
// 都會丟例外，接住就好，收合只是便利。
const STORAGE_KEY = 'ivy-admin-nav-expanded'
const DEFAULT_EXPANDED: Record<string, boolean> = {
  overview: true, visits: true, home: false, campus: false, site: false, system: false,
}
function readExpanded(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return { ...DEFAULT_EXPANDED, ...(JSON.parse(raw) as Record<string, boolean>) }
  } catch {
    /* 讀不到就用預設 */
  }
  return { ...DEFAULT_EXPANDED }
}
const expanded = ref<Record<string, boolean>>(readExpanded())
watch(expanded, value => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
  } catch {
    /* 存不了不影響操作 */
  }
}, { deep: true })
// nav.ts 用名稱指定圖示。逐一 import 而不是整包 import *：整包會把兩百多個
// 用不到的圖示都打包進來。新增側欄項目時要把圖示加進這裡（有測試檢查）。
const icons: Record<string, Component> = {
  Avatar, Bell, Bottom, Calendar, ChatDotRound, ChatDotSquare, ChatLineSquare, Clock, DataLine, Document: DocumentIcon,
  EditPen, Files, Grid, HomeFilled, List, Location: LocationIcon, Notification: NotificationIcon, Phone, Picture,
  Postcard, Reading, School, Setting, Sunny, Switch, Tickets, Timer, TrendCharts, User,
}
const activePath = computed(() => route.name === 'visit-detail' ? '/visit-requests' : route.path)
const normalizedQuery = computed(() => normalizeSearch(query.value))
const groups = computed(() => {
  const q = normalizedQuery.value
  // 「我的帳號」不在側欄選單裡（入口是底部的使用者區塊），只在搜尋時出現。
  const results = (q ? [...NAV_GROUPS, SEARCH_ONLY_GROUP] : NAV_GROUPS).map(group => {
    const allowed = group.items.filter(item => canListNavItem(item, auth.user, auth.features))
    if (!q) return { ...group, items: allowed, score: 0 }
    // 功能名與關鍵字先比：搜「素材」要直接給素材庫，不是把「全站與素材」整組攤開；
    // 搜「預約」要帶出參觀案件、參觀場次，不只名稱裡有「預約」的兩項。
    const hits = allowed.map(item => ({ item, score: navItemMatchScore(item, q) })).filter(hit => hit.score > 0)
    if (hits.length) {
      hits.sort((a, b) => b.score - a.score)
      return { ...group, items: hits.map(hit => hit.item), score: hits[0]!.score }
    }
    // 這組沒有功能中才看分組或區段名，讓搜「參觀預約」能看到整組。
    const byGroup = [group.label, group.section ?? ''].some(label => label && normalizeSearch(label).includes(q))
    return { ...group, items: byGroup ? allowed : [], score: 0 }
  }).filter(group => group.items.length)
  // 最接近的一組排前面（sort 是穩定排序，同分維持側欄原本的順序）。
  return q ? results.sort((a, b) => b.score - a.score) : results
})
const hasQuery = computed(() => Boolean(normalizedQuery.value))
// 搜尋框按 Enter 直接前往第一筆結果。中文輸入法選字時按的 Enter 不算
// （isComposing；Safari 在選字結束那一下是 keyCode 229）。沒打字時不動作：
// 否則會跳到側欄第一項，手機清掉搜尋字後按鍵盤的「前往」也會換頁。
function openFirstResult(event: KeyboardEvent) {
  if (!hasQuery.value || event.isComposing || event.keyCode === 229) return
  const first = groups.value[0]?.items[0]
  if (!first) return
  if (first.path === activePath.value) {
    query.value = ''
    emit('close')
    return
  }
  void router.push(first.path)
}
// 相鄰且同 section 的分組併成一塊，共用一個區段標題。
const blocks = computed(() => {
  const out: { key: string; section?: string; groups: typeof groups.value }[] = []
  for (const group of groups.value) {
    const last = out[out.length - 1]
    if (group.section && last && last.section === group.section) last.groups.push(group)
    else out.push({ key: group.key, section: group.section, groups: [group] })
  }
  return out
})
watch(activePath, path => {
  const group = NAV_GROUPS.find(group => group.items.some(item => item.path === path))
  if (group) expanded.value[group.key] = true
  query.value = ''
}, { immediate: true })
// 點 logo 回到這個角色的起始頁（總管理者是營運總覽，其他角色是第一個看得到的功能）。
const homePath = computed(() => landingPath(auth.user?.role))
// 帳號區寫同事看到的名字（沒設定顯示名稱時是 Email @ 前面那段），完整 Email 在 title。
// 頭像取名字第一個字；表情符號這類兩個 UTF-16 單位的字不能切半，用 Array.from。
const userName = computed(() => staffLabel(auth.user, ''))
const userInitial = computed(() => Array.from(userName.value)[0] ?? '')
// 有指定校區的角色都帶校區（櫃台・義華、編輯・仁武），共用電腦或跨校支援時一眼
// 看得出是哪一校的帳號，和「我的帳號」頁一致。總管理者管全部校區，不帶。
const userLine = computed(() => {
  const user = auth.user
  if (!user) return ''
  const campuses = user.role === 'super_admin' ? '' : campusLabels(user.campus_keys)
  return campuses ? `${roleLabel(user.role)}・${campuses}` : roleLabel(user.role)
})
</script>

<template>
  <div class="sidebar">
    <div class="sidebar__brand">
      <router-link :to="homePath" class="sidebar__home" title="回到起始頁">
        <img :src="crestMarkUrl" alt="" width="41" height="44" />
        <span class="sidebar__brand-text"><strong>常春藤官網</strong><span>管理後台</span></span>
      </router-link>
      <button v-if="mobile" class="sidebar__close" type="button" aria-label="關閉選單" @click="emit('close')">
        <el-icon><Close /></el-icon>
      </button>
    </div>
    <div class="sidebar__search">
      <el-input v-model="query" aria-label="搜尋後台功能" placeholder="搜尋功能" :prefix-icon="Search" clearable
        @keydown.enter="openFirstResult" />
    </div>
    <nav class="sidebar__nav" aria-label="主選單">
      <template v-for="block in blocks" :key="block.key">
      <p v-if="block.section" class="sidebar__section">{{ block.section }}</p>
      <section v-for="group in block.groups" :key="group.key" class="sidebar__group" :class="{ 'is-nested': block.section }">
        <h2>
          <button type="button" class="sidebar__group-toggle" :disabled="hasQuery" :aria-expanded="hasQuery || expanded[group.key]"
            :aria-controls="`nav-${group.key}`" @click="expanded[group.key] = !expanded[group.key]">
            {{ group.label }}
            <el-icon class="sidebar__chevron" :class="{ 'is-open': hasQuery || expanded[group.key] }"><ArrowDown /></el-icon>
          </button>
        </h2>
        <ul v-show="hasQuery || expanded[group.key]" :id="`nav-${group.key}`">
          <li v-for="item in group.items" :key="item.name">
            <router-link :to="item.path" class="sidebar__link" :class="{ 'is-active': activePath === item.path }"
              :aria-current="activePath === item.path ? 'page' : undefined">
              <el-icon v-if="item.icon && icons[item.icon]" aria-hidden="true"><component :is="icons[item.icon]" /></el-icon>
              <span>{{ item.title }}</span>
              <span v-if="item.badge === 'open-requests' && openRequests.total > 0" class="sidebar__badge num"
                :title="`新需求 ${openRequests.newRequests} 件、待園方確認 ${openRequests.awaiting} 件`">
                {{ openRequests.total > 99 ? '99+' : openRequests.total }}<span class="visually-hidden"> 件待處理</span>
              </span>
            </router-link>
          </li>
        </ul>
      </section>
      </template>
      <div v-if="!groups.length" class="sidebar__empty" role="status">
        <p>找不到符合的功能</p>
        <el-button text @click="query = ''">清除搜尋</el-button>
      </div>
    </nav>
    <div v-if="auth.user" class="sidebar__user" :class="{ 'is-mobile': mobile }">
      <router-link to="/account" class="sidebar__account" :class="{ 'is-active': route.path === '/account' }"
        :aria-current="route.path === '/account' ? 'page' : undefined"
        :aria-label="`我的帳號：${staffWithEmail(auth.user)}`" :title="`${auth.user.email}（${userLine}）`">
        <span class="sidebar__avatar" aria-hidden="true">{{ userInitial.toUpperCase() }}</span>
        <div class="sidebar__user-text"><strong>{{ userName }}</strong><span>{{ userLine }}</span></div>
      </router-link>
      <!-- 手機抽屜：觸控沒有 tooltip，圖示旁直接寫字。 -->
      <div v-if="mobile" class="sidebar__user-actions">
        <el-button text @click="passwordOpen = true"><el-icon><Key /></el-icon><span>更改密碼</span></el-button>
        <el-button text @click="emit('logout')"><el-icon><SwitchButton /></el-icon><span>登出</span></el-button>
      </div>
      <template v-else>
        <el-button text circle aria-label="更改密碼" title="更改密碼" @click="passwordOpen = true"><el-icon><Key /></el-icon></el-button>
        <el-button text circle aria-label="登出" title="登出" @click="emit('logout')"><el-icon><SwitchButton /></el-icon></el-button>
      </template>
      <ChangePasswordDialog v-model="passwordOpen" />
    </div>
  </div>
</template>

<style scoped>
.sidebar {
  /* 只覆寫側欄內的 Element Plus 控制項；drawer 外的表單仍使用淺色主題。 */
  --el-text-color-primary: var(--sidebar-ink);
  --el-text-color-regular: var(--sidebar-ink);
  --el-text-color-secondary: var(--sidebar-muted);
  --el-text-color-placeholder: var(--sidebar-muted);
  --el-color-primary: var(--sidebar-active-ink);
  --el-color-primary-light-3: var(--sidebar-active-ink);
  --el-border-color: var(--sidebar-line);
  --el-border-color-hover: var(--sidebar-muted);
  --el-fill-color-blank: var(--sidebar-hover);
  --el-fill-color-light: var(--sidebar-active-bg);
  color-scheme: dark;
  display: flex; flex-direction: column; height: 100%; min-height: 0;
  background: var(--sidebar-bg); color: var(--sidebar-ink);
}
.sidebar :focus-visible { outline-color: var(--sidebar-active-ink); }
/* 品牌列與右側頂欄同高、同一條底線，兩邊的橫線接成一條。 */
.sidebar__brand { display: flex; flex-shrink: 0; align-items: center; gap: 8px; min-height: var(--top-h); padding: 0 12px; border-bottom: 1px solid var(--sidebar-line); }
.sidebar__home { display: flex; flex: 1; align-items: center; gap: 12px; min-width: 0; min-height: 52px; padding: 4px 8px; border-radius: var(--radius); color: var(--sidebar-ink); transition: background-color 150ms var(--ease-out); }
.sidebar__home img { flex-shrink: 0; width: auto; height: 44px; }
.sidebar__brand-text { display: grid; gap: 2px; min-width: 0; }
.sidebar__brand-text strong { font-size: 15px; font-weight: 600; line-height: 1.3; }
.sidebar__brand-text span { font-size: 12px; color: var(--sidebar-muted); }
.sidebar__search { padding: 16px 16px 16px; }
.sidebar__nav { flex: 1; min-height: 0; overflow-y: auto; padding: 0 12px 20px; overscroll-behavior: contain; }
.sidebar__group + .sidebar__group { margin-top: 12px; }
.sidebar__section { margin: 20px 0 4px; padding: 12px 12px 0; border-top: 1px solid var(--sidebar-line); color: var(--sidebar-muted); font-size: 12px; font-weight: 600; letter-spacing: .04em; }
.sidebar__section + .sidebar__group { margin-top: 0; }
.sidebar__group.is-nested { margin-top: 0; }
.sidebar__group.is-nested .sidebar__group-toggle { padding-left: 20px; }
.sidebar__group.is-nested .sidebar__link { margin-left: 8px; }
.sidebar__group-toggle { display: flex; align-items: center; justify-content: space-between; width: 100%; min-height: 40px; padding: 10px 12px; border: 0; border-radius: var(--radius); background: transparent; color: var(--sidebar-muted); font: inherit; font-size: 13px; cursor: pointer; }
.sidebar__group-toggle:disabled { cursor: default; }
.sidebar__chevron { font-size: 12px; transform: rotate(-90deg); }
.sidebar__chevron.is-open { transform: none; }
.sidebar__nav ul { list-style: none; margin: 0; padding: 0; }
/* position:relative：數字裡的報讀文字（.visually-hidden 是絕對定位）要以連結為準、
   跟著選單一起被捲動區裁切。沒有這行時它以整個側欄為準，下方分組展開後會把短頁面
   撐高約 400px 的空白。 */
.sidebar__link { position: relative; display: flex; align-items: center; gap: 12px; min-height: 40px; margin-block: 2px; padding: 8px 12px; border-radius: var(--radius); color: var(--sidebar-ink); font-size: 14px; line-height: 1.5; transition: background-color 150ms var(--ease-out), color 150ms var(--ease-out); }
.sidebar__link.is-active { background: var(--sidebar-active-bg); color: var(--sidebar-active-ink); font-weight: 600; }
.sidebar__link .el-icon { font-size: 17px; }
/* 暖黃＝待注意（見 style.css 開頭）；深色側欄上用實心小膠囊才看得到。 */
.sidebar__badge { margin-left: auto; min-width: 22px; padding: 0 7px; border-radius: 999px; background: var(--brand-gold); color: var(--sidebar-bg); font-size: 12px; font-weight: 600; line-height: 20px; text-align: center; }
.sidebar__empty { padding: 20px 8px; color: var(--sidebar-muted); }
.sidebar__user { display: flex; align-items: center; gap: 10px; padding: 16px 12px max(16px, env(safe-area-inset-bottom)); border-top: 1px solid var(--sidebar-line); }
.sidebar__account { display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0; margin: -6px; padding: 6px; border-radius: var(--radius); color: var(--sidebar-ink); }
.sidebar__account.is-active { background: var(--sidebar-active-bg); color: var(--sidebar-active-ink); }
.sidebar__avatar { display: grid; place-items: center; flex-shrink: 0; width: 32px; height: 32px; border: 1px solid var(--sidebar-line); border-radius: 50%; background: var(--sidebar-hover); color: var(--sidebar-active-ink); font-weight: 600; }
.sidebar__user-text { display: grid; min-width: 0; flex: 1; gap: 2px; }
.sidebar__user-text strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; font-weight: 500; }
.sidebar__user-text span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; color: var(--sidebar-muted); }
/* 更改密碼、登出只有圖示，14px 的鑰匙看起來像符號，放大到能一眼認出。 */
.sidebar__user .el-button .el-icon { font-size: 18px; }
/* 手機抽屜：帳號一行、下面兩顆帶字的按鈕各占一半。 */
.sidebar__user.is-mobile { flex-wrap: wrap; row-gap: 14px; }
.sidebar__user.is-mobile .sidebar__account { flex-basis: 100%; }
.sidebar__user-actions { display: flex; gap: 8px; width: 100%; }
.sidebar__user-actions .el-button { flex: 1; min-height: 44px; margin: 0; border: 1px solid var(--sidebar-line); font-size: 14px; }
.sidebar__user-actions .el-button .el-icon { margin-right: 6px; }
.sidebar__close { display: grid; place-items: center; flex-shrink: 0; margin-left: auto; width: 44px; height: 44px; border: 0; border-radius: var(--radius); background: transparent; color: var(--sidebar-ink); cursor: pointer; }
/* 滑鼠才有 hover 底色；觸控點開抽屜後手指的位置不會留下一塊亮底。 */
.sidebar__home:hover, .sidebar__link:hover, .sidebar__account:hover { text-decoration: none; }
@media (hover: hover) {
  .sidebar__home:hover, .sidebar__link:not(.is-active):hover, .sidebar__account:not(.is-active):hover, .sidebar__close:hover,
  .sidebar__group-toggle:hover:not(:disabled) { background: var(--sidebar-hover); color: var(--sidebar-ink); }
}
@media (forced-colors: active) {
  .sidebar__link.is-active { outline: 2px solid Highlight; outline-offset: -2px; }
}
@media (max-width: 900px) {
  .sidebar__link, .sidebar__group-toggle { min-height: 44px; }
  .sidebar__group-toggle, .sidebar__brand-text span, .sidebar__user-text span { font-size: 14px; }
}
</style>
