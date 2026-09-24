<script setup lang="ts">
import { computed, ref, watch, type Component } from 'vue'
import { useRoute } from 'vue-router'
import * as Icons from '@element-plus/icons-vue'
import { canSeeNavItem, NAV_GROUPS } from '../router/nav'
import { useAuthStore } from '../stores/auth'
import { useOpenRequestsStore } from '../stores/openRequests'
import { campusLabels, roleLabel } from '../api/labels'
import ChangePasswordDialog from './ChangePasswordDialog.vue'

defineProps<{ mobile?: boolean }>()
const emit = defineEmits<{ close: []; logout: [] }>()
const auth = useAuthStore()
const openRequests = useOpenRequestsStore()
const route = useRoute()
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
const icons = Icons as unknown as Record<string, Component>
const activePath = computed(() => route.name === 'visit-detail' ? '/visit-requests' : route.path)
const groups = computed(() => NAV_GROUPS.map(group => {
  const allowed = group.items.filter(item => canSeeNavItem(item, auth.user))
  const q = query.value.trim()
  if (!q) return { ...group, items: allowed }
  // 功能名先比：搜「素材」要直接給素材庫，不是把「全站與素材」整組攤開。
  const hits = allowed.filter(item => item.title.includes(q))
  if (hits.length) return { ...group, items: hits }
  // 功能名都沒中才看分組或區段名，讓搜「參觀預約」能看到整組。
  const byGroup = group.label.includes(q) || (group.section ?? '').includes(q)
  return { ...group, items: byGroup ? allowed : [] }
}).filter(group => group.items.length))
const hasQuery = computed(() => Boolean(query.value.trim()))
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
const userLine = computed(() => {
  const user = auth.user
  if (!user) return ''
  return `${roleLabel(user.role)}${user.role === 'campus_admin' ? `・${campusLabels(user.campus_keys)}` : ''}`
})
</script>

<template>
  <div class="sidebar">
    <div class="sidebar__brand">
      <img src="/favicon.svg" alt="" width="32" height="32" />
      <div><strong>常春藤官網</strong><span>管理後台</span></div>
      <button v-if="mobile" class="sidebar__close" type="button" aria-label="關閉選單" @click="emit('close')">
        <el-icon><Icons.Close /></el-icon>
      </button>
    </div>
    <div class="sidebar__search">
      <el-input v-model="query" aria-label="搜尋後台功能" placeholder="搜尋功能" :prefix-icon="Icons.Search" clearable />
    </div>
    <nav class="sidebar__nav" aria-label="主選單">
      <template v-for="block in blocks" :key="block.key">
      <p v-if="block.section" class="sidebar__section">{{ block.section }}</p>
      <section v-for="group in block.groups" :key="group.key" class="sidebar__group" :class="{ 'is-nested': block.section }">
        <h2>
          <button type="button" class="sidebar__group-toggle" :disabled="hasQuery" :aria-expanded="hasQuery || expanded[group.key]"
            :aria-controls="`nav-${group.key}`" @click="expanded[group.key] = !expanded[group.key]">
            {{ group.label }}
            <el-icon class="sidebar__chevron" :class="{ 'is-open': hasQuery || expanded[group.key] }"><Icons.ArrowDown /></el-icon>
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
    <div v-if="auth.user" class="sidebar__user">
      <router-link to="/account" class="sidebar__account" :class="{ 'is-active': route.path === '/account' }"
        :aria-current="route.path === '/account' ? 'page' : undefined"
        :aria-label="`我的帳號：${auth.user.email}`" :title="auth.user.email">
        <span class="sidebar__avatar" aria-hidden="true">{{ auth.user.email.slice(0, 1).toUpperCase() }}</span>
        <div class="sidebar__user-text"><strong>{{ auth.user.email }}</strong><span>{{ userLine }}</span></div>
      </router-link>
      <el-button text circle aria-label="更改密碼" title="更改密碼" @click="passwordOpen = true"><el-icon><Icons.Key /></el-icon></el-button>
      <el-button text circle aria-label="登出" title="登出" @click="emit('logout')"><el-icon><Icons.SwitchButton /></el-icon></el-button>
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
.sidebar__brand { display: flex; flex-shrink: 0; align-items: center; gap: 12px; min-height: var(--top-h); padding: 0 20px; }
.sidebar__brand div { display: grid; gap: 2px; }
.sidebar__brand strong { font-size: 15px; font-weight: 600; }
.sidebar__brand span { font-size: 12px; color: var(--sidebar-muted); }
.sidebar__brand img { border-radius: var(--radius); flex-shrink: 0; }
.sidebar__search { padding: 12px 16px 16px; }
.sidebar__nav { flex: 1; min-height: 0; overflow-y: auto; padding: 0 12px 20px; overscroll-behavior: contain; }
.sidebar__group + .sidebar__group { margin-top: 12px; }
.sidebar__section { margin: 20px 0 4px; padding: 12px 12px 0; border-top: 1px solid var(--sidebar-line); color: var(--sidebar-muted); font-size: 12px; font-weight: 600; letter-spacing: .04em; }
.sidebar__section + .sidebar__group { margin-top: 0; }
.sidebar__group.is-nested { margin-top: 0; }
.sidebar__group.is-nested .sidebar__group-toggle { padding-left: 20px; }
.sidebar__group.is-nested .sidebar__link { margin-left: 8px; }
.sidebar__group-toggle { display: flex; align-items: center; justify-content: space-between; width: 100%; min-height: 40px; padding: 10px 12px; border: 0; border-radius: var(--radius); background: transparent; color: var(--sidebar-muted); font: inherit; font-size: 13px; cursor: pointer; }
.sidebar__group-toggle:hover:not(:disabled) { background: var(--sidebar-hover); color: var(--sidebar-ink); }
.sidebar__group-toggle:disabled { cursor: default; }
.sidebar__chevron { font-size: 12px; transform: rotate(-90deg); }
.sidebar__chevron.is-open { transform: none; }
.sidebar__nav ul { list-style: none; margin: 0; padding: 0; }
.sidebar__link { display: flex; align-items: center; gap: 12px; min-height: 40px; margin-block: 2px; padding: 8px 12px; border-radius: var(--radius); color: var(--sidebar-ink); font-size: 14px; line-height: 1.5; transition: background-color 150ms var(--ease-out), color 150ms var(--ease-out); }
.sidebar__link:hover { background: var(--sidebar-hover); color: var(--sidebar-ink); text-decoration: none; }
.sidebar__link.is-active { background: var(--sidebar-active-bg); color: var(--sidebar-active-ink); font-weight: 600; }
.sidebar__link .el-icon { font-size: 17px; }
/* 暖黃＝待注意（見 style.css 開頭）；深色側欄上用實心小膠囊才看得到。 */
.sidebar__badge { margin-left: auto; min-width: 22px; padding: 0 7px; border-radius: 999px; background: var(--brand-gold); color: var(--sidebar-bg); font-size: 12px; font-weight: 600; line-height: 20px; text-align: center; }
.sidebar__empty { padding: 20px 8px; color: var(--sidebar-muted); }
.sidebar__user { display: flex; align-items: center; gap: 10px; padding: 16px 12px max(16px, env(safe-area-inset-bottom)); border-top: 1px solid var(--sidebar-line); }
.sidebar__account { display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0; margin: -6px; padding: 6px; border-radius: var(--radius); color: var(--sidebar-ink); }
.sidebar__account:hover { background: var(--sidebar-hover); color: var(--sidebar-ink); text-decoration: none; }
.sidebar__account.is-active { background: var(--sidebar-active-bg); color: var(--sidebar-active-ink); }
.sidebar__avatar { display: grid; place-items: center; flex-shrink: 0; width: 32px; height: 32px; border: 1px solid var(--sidebar-line); border-radius: 50%; background: var(--sidebar-hover); color: var(--sidebar-active-ink); font-weight: 600; }
.sidebar__user-text { display: grid; min-width: 0; flex: 1; gap: 2px; }
.sidebar__user-text strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; font-weight: 500; }
.sidebar__user-text span { font-size: 12px; color: var(--sidebar-muted); }
.sidebar__close { display: grid; place-items: center; flex-shrink: 0; margin-left: auto; width: 44px; height: 44px; border: 0; border-radius: var(--radius); background: transparent; color: var(--sidebar-ink); cursor: pointer; }
.sidebar__close:hover { background: var(--sidebar-hover); }
@media (forced-colors: active) {
  .sidebar__link.is-active { outline: 2px solid Highlight; outline-offset: -2px; }
}
@media (max-width: 900px) {
  .sidebar__link, .sidebar__group-toggle { min-height: 44px; }
  .sidebar__group-toggle, .sidebar__brand span, .sidebar__user-text span { font-size: 14px; }
}
</style>
