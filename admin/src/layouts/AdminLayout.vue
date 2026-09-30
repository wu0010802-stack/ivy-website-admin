<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { TopRight } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { useAuthStore } from '../stores/auth'
import { useOpenRequestsStore } from '../stores/openRequests'
import { NAV_GROUPS, canOpenPath } from '../router/nav'
import { WEBSITE_ASSET_BASE } from '../config'
import AdminSidebar from '../components/AdminSidebar.vue'

const auth = useAuthStore()
const openRequests = useOpenRequestsStore()
const router = useRouter()
const route = useRoute()
const mobileQuery = window.matchMedia('(max-width: 900px)')
const isMobile = ref(mobileQuery.matches)
const drawerOpen = ref(false)
const main = ref<HTMLElement | null>(null)
const menuButton = ref<HTMLButtonElement | null>(null)
const pageTitle = computed(() => route.meta.title ?? '')
// 官網首頁。正式站的 base 是空字串（後台和官網同網域），直接拿 base 當 href 會變成
// href=""，新分頁開的是目前這頁後台，所以一定要接上「/」。
const websiteHome = `${WEBSITE_ASSET_BASE.replace(/\/+$/, '')}/`
const websiteNote = '另開新分頁，顯示家長現在看到的版本；還沒發布的草稿不會出現'
// 側欄只留參觀案件的數字；家長的改期申請與給自己的內容通知未讀時，
// 改在頁首出現一個連結，任何頁面都看得到、點了直接進去。
const unreadLinks = computed(() => {
  const user = auth.user
  const links: { to: string; label: string; short: string; count: number }[] = []
  if (openRequests.reschedules > 0 && canOpenPath('/notifications', user)) {
    links.push({ to: '/notifications', label: '改期申請待核准', short: '改期', count: openRequests.reschedules })
  }
  if (openRequests.myNotices > 0 && canOpenPath('/releases', user)) {
    links.push({ to: '/releases', label: '內容通知未讀', short: '通知', count: openRequests.myNotices })
  }
  return links
})
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
// 換頁順便更新側欄的待處理數字（store 內 30 秒內不重抓）。
watch(() => route.path, () => { openRequests.refresh() }, { immediate: true })
watch(() => route.path, async () => {
  drawerOpen.value = false
  await nextTick()
  main.value?.scrollIntoView({ block: 'start' })
  main.value?.focus({ preventScroll: true })
})
// 從通知信、同事貼的網址進了沒有權限的頁面，會被送回起始頁（router 帶 denied）。
// 說一聲是權限的關係，不要讓人以為連結壞了；說完把 denied 從網址拿掉，重新整理
// 不會再跳一次。起始頁自己也可能同時改網址（分校內容頁會帶上 ?campus=），那次
// replace 會蓋掉這裡的、把 denied 帶回來，所以跟著 fullPath 看：還在就再拿一次，
// 提示只說一次。
let announcedDenied: string | null = null
watch(() => route.fullPath, () => {
  const denied = route.query.denied
  if (denied == null) {
    announcedDenied = null
    return
  }
  const name = (Array.isArray(denied) ? denied[0] : denied) ?? ''
  if (announcedDenied !== name) {
    announcedDenied = name
    const title = router.getRoutes().find(record => record.name === name)?.meta.title
    ElMessage.warning({
      message: `你的帳號沒有${title ? `「${title}」` : '這個頁面'}的權限，已回到起始頁；需要的話請洽總管理者`,
      duration: 6000,
      showClose: true,
    })
  }
  const { denied: _, ...rest } = route.query
  void router.replace({ query: rest })
}, { immediate: true })
// 先換到登入頁，真正的登出在 router 的 beforeEach 裡（見 stores/auth.ts 的
// logoutPending）：頁面有未儲存的修改時，離頁攔截會先問，選留在這頁就不登出。
async function handleLogout() {
  // 連按兩下只算一次：前一次還在等離頁確認或伺服器回應。
  if (auth.logoutPending) return
  auth.logoutPending = true
  try {
    const failure = await router.push({ name: 'login' })
    if (failure) {
      // 選了留在這頁：仍是登入狀態，什麼都不做。
      if (auth.user) return
      // 網路慢、登出還沒回應時點了別的連結：換頁取消了，但登出已經完成。不能留在
      // 沒有登入者的頁面上（之後的 401 都不會導回登入頁），補一次換到登入頁。
      void router.replace({ name: 'login' })
    }
  } catch {
    ElMessage.error('登出沒有完成（連線或伺服器錯誤），你仍是登入狀態，請再按一次登出')
    return
  } finally {
    auth.logoutPending = false
  }
  openRequests.reset()
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
          :aria-expanded="drawerOpen" aria-haspopup="dialog" @click="drawerOpen = true">
          <!-- 三條線的漢堡圖示；Element Plus 的 Menu 是四格方塊，看起來像「應用程式」。 -->
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false"><path d="M4 7h16M4 12h16M4 17h16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" /></svg>
        </button>
        <div class="top__heading"><span class="top__group">{{ groupLabel }}</span><h1>{{ pageTitle }}</h1></div>
        <nav v-if="unreadLinks.length" class="top__alerts" aria-label="未讀通知">
          <router-link v-for="link in unreadLinks" :key="link.to" :to="link.to" class="top__alert" :aria-label="`${link.label} ${link.count}`">
            <span class="top__alert-count num">{{ link.count > 99 ? '99+' : link.count }}</span><span class="top__alert-long">{{ link.label }}</span><span class="top__alert-short" aria-hidden="true">{{ link.short }}</span>
          </router-link>
        </nav>
        <a class="top__site" :href="websiteHome" target="_blank" rel="noopener" aria-describedby="top-site-note"
          :title="websiteNote">查看官網 <el-icon><TopRight /></el-icon></a>
        <!-- title 在觸控裝置看不到，報讀器改讀這一句；兩處同一句，報讀器不會念出兩種說法。 -->
        <span id="top-site-note" class="visually-hidden">{{ websiteNote }}</span>
      </header>
      <main id="main" ref="main" class="main" tabindex="-1"><router-view /></main>
    </div>
  </div>
</template>

<style scoped>
.shell { display: grid; grid-template-columns: var(--side-w) minmax(0, 1fr); min-height: 100svh; }
.skip-link { position: fixed; top: -100px; left: 16px; z-index: 3000; padding: 12px; border-radius: var(--radius); background: var(--ink); color: var(--surface); }
.skip-link:focus { top: 12px; }
/* overflow:hidden 是保險：側欄裡絕對定位的東西（例如數字的報讀文字）不能把整頁撐高。 */
.side { position: sticky; top: 0; height: 100svh; overflow: hidden; background: var(--sidebar-bg); }
.main-col { display: flex; flex-direction: column; min-width: 0; }
.top { position: sticky; top: 0; z-index: 10; display: flex; align-items: center; gap: 12px; min-height: var(--top-h); padding: 8px 28px; background: var(--surface); border-bottom: 1px solid var(--line); }
.top__heading { min-width: 0; display: grid; gap: 3px; }
.top__heading h1 { font-size: 18px; }
.top__group { font-size: 12px; color: var(--ink-3); }
.top__alerts { display: flex; flex-wrap: wrap; gap: 8px; margin-left: auto; }
.top__alert { display: inline-flex; align-items: center; gap: 6px; min-height: 36px; padding: 0 12px; border: 1px solid var(--brand-gold); border-radius: var(--radius); background: var(--surface); font-size: 13px; color: var(--ink); }
.top__alert:hover { background: var(--surface-2); text-decoration: none; }
.top__alert-count { min-width: 20px; padding: 0 6px; border-radius: 999px; background: var(--brand-gold); color: var(--ink); font-size: 12px; font-weight: 600; line-height: 20px; text-align: center; }
.top__alert-short { display: none; }
.top__alerts + .top__site { margin-left: 0; }
.top__site { margin-left: auto; flex-shrink: 0; display: inline-flex; align-items: center; gap: 6px; min-height: 36px; padding: 0 12px; border: 1px solid var(--line); border-radius: var(--radius); font-size: 13px; color: var(--ink-2); }
.top__site:hover { background: var(--surface-2); text-decoration: none; }
.top__menu { display: grid; place-items: center; flex-shrink: 0; width: 44px; height: 44px; padding: 0; border: 1px solid var(--line); background: var(--surface); color: var(--ink); border-radius: var(--radius); cursor: pointer; font-size: 20px; }
.main { flex: 1; min-width: 0; padding: 28px 28px 48px; scroll-margin-top: var(--top-h); outline: none; }
@media (max-width: 900px) {
  .shell { grid-template-columns: minmax(0, 1fr); }
  .top { padding: 0 16px; }
  .top__heading h1 { font-size: 18px; }
  .top__site { min-height: 44px; padding: 0 8px; }
  .top__alert { min-height: 44px; padding: 0 8px; white-space: nowrap; }
  .top__alert-long { display: none; }
  .top__alert-short { display: inline; }
  .top__heading { flex: 1; }
  .top__alerts { margin-left: 0; flex-wrap: nowrap; }
  .main { padding: 20px 16px 32px; }
}
@media (max-width: 360px) { .top { gap: 8px; padding: 0 12px; } .top__heading h1 { font-size: 16px; } }
</style>
