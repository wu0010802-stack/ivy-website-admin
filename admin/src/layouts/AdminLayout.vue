<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { TopRight, Menu } from '@element-plus/icons-vue'
import { useAuthStore } from '../stores/auth'
import { NAV_GROUPS } from '../router/nav'
import { WEBSITE_ASSET_BASE } from '../config'
import AdminSidebar from '../components/AdminSidebar.vue'

const auth = useAuthStore()
const router = useRouter()
const route = useRoute()
const mobileQuery = window.matchMedia('(max-width: 900px)')
const isMobile = ref(mobileQuery.matches)
const drawerOpen = ref(false)
const main = ref<HTMLElement | null>(null)
const menuButton = ref<HTMLButtonElement | null>(null)
const pageTitle = computed(() => route.meta.title ?? '')
// 內容分成首頁／分校頁／全站三個子組，麵包屑顯示共用的「官網內容」，
// 沒有區段的分組才用自己的名稱。
const groupLabel = computed(() => {
  const group = NAV_GROUPS.find(group => group.items.some(item =>
    item.path === route.path || (route.name === 'visit-detail' && item.name === 'visit-requests'),
  ))
  return group?.section ?? group?.label ?? '管理後台'
})
function updateViewport(event: MediaQueryListEvent) {
  isMobile.value = event.matches
  drawerOpen.value = false
}
onMounted(() => mobileQuery.addEventListener('change', updateViewport))
onBeforeUnmount(() => mobileQuery.removeEventListener('change', updateViewport))
watch(() => route.path, async () => {
  drawerOpen.value = false
  await nextTick()
  main.value?.scrollIntoView({ block: 'start' })
  main.value?.focus({ preventScroll: true })
})
async function handleLogout() {
  await auth.logout()
  router.push({ name: 'login' })
}
</script>

<template>
  <div class="shell">
    <a class="skip-link" href="#main">跳到主要內容</a>
    <aside v-if="!isMobile" class="side"><AdminSidebar @logout="handleLogout" /></aside>
    <el-drawer v-else v-model="drawerOpen" title="主選單" direction="ltr" :size="'min(320px, 88vw)'"
      :with-header="false" class="admin-nav-drawer" @close-auto-focus="menuButton?.focus()">
      <AdminSidebar mobile @close="drawerOpen = false" @logout="handleLogout" />
    </el-drawer>
    <div class="main-col">
      <header class="top">
        <button v-if="isMobile" ref="menuButton" class="top__menu" type="button" aria-label="開啟選單"
          :aria-expanded="drawerOpen" aria-haspopup="dialog" @click="drawerOpen = true"><el-icon><Menu /></el-icon></button>
        <div class="top__heading"><span class="top__group">{{ groupLabel }}</span><h1>{{ pageTitle }}</h1></div>
        <a class="top__site" :href="WEBSITE_ASSET_BASE" target="_blank" rel="noopener" title="開的是家長現在看到的版本；還沒發布的草稿不會出現在這裡">查看官網 <el-icon><TopRight /></el-icon></a>
      </header>
      <main id="main" ref="main" class="main" tabindex="-1"><router-view /></main>
    </div>
  </div>
</template>

<style scoped>
.shell { display: grid; grid-template-columns: var(--side-w) minmax(0, 1fr); min-height: 100svh; }
.skip-link { position: fixed; top: -100px; left: 16px; z-index: 3000; padding: 12px; border-radius: var(--radius); background: var(--ink); color: var(--surface); }
.skip-link:focus { top: 12px; }
.side { position: sticky; top: 0; height: 100svh; background: var(--sidebar-bg); }
.main-col { display: flex; flex-direction: column; min-width: 0; }
.top { position: sticky; top: 0; z-index: 10; display: flex; align-items: center; gap: 12px; min-height: var(--top-h); padding: 8px 28px; background: var(--surface); border-bottom: 1px solid var(--line); }
.top__heading { min-width: 0; display: grid; gap: 3px; }
.top__heading h1 { font-size: 18px; }
.top__group { font-size: 12px; color: var(--ink-3); }
.top__site { margin-left: auto; flex-shrink: 0; display: inline-flex; align-items: center; gap: 6px; min-height: 36px; padding: 0 12px; border: 1px solid var(--line); border-radius: var(--radius); font-size: 13px; color: var(--ink-2); }
.top__site:hover { background: var(--surface-2); text-decoration: none; }
.top__menu { display: grid; place-items: center; flex-shrink: 0; width: 44px; height: 44px; padding: 0; border: 1px solid var(--line); background: var(--surface); color: var(--ink); border-radius: var(--radius); cursor: pointer; font-size: 20px; }
.main { flex: 1; min-width: 0; padding: 28px 28px 48px; scroll-margin-top: var(--top-h); outline: none; }
@media (max-width: 900px) {
  .shell { grid-template-columns: minmax(0, 1fr); }
  .top { padding: 0 16px; }
  .top__heading h1 { font-size: 18px; }
  .top__site { min-height: 44px; padding: 0 8px; }
  .main { padding: 20px 16px 32px; }
}
@media (max-width: 360px) { .top { gap: 8px; padding: 0 12px; } .top__heading h1 { font-size: 16px; } }
</style>
