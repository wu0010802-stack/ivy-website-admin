<script setup lang="ts">
import { computed, ref, watch, type Component } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import * as Icons from '@element-plus/icons-vue'
import { useAuthStore } from '../stores/auth'
import { NAV_GROUPS } from '../router/nav'
import { campusLabels, roleLabel } from '../api/labels'
import { WEBSITE_ASSET_BASE } from '../config'

const authStore = useAuthStore()
const router = useRouter()
const route = useRoute()

const iconMap = Icons as unknown as Record<string, Component>
function iconOf(name?: string): Component | null {
  return name ? (iconMap[name] ?? null) : null
}

const visibleGroups = computed(() => {
  const role = authStore.user?.role ?? ''
  return NAV_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((i) => !i.roles || i.roles.includes(role)),
  })).filter((g) => g.items.length > 0)
})

// 明細頁（例如 /visit-requests/:id）要讓上層清單在側欄保持高亮
const activePath = computed(() => {
  const name = String(route.name ?? '')
  if (name === 'visit-detail') return '/visit-requests'
  return route.path
})

const pageTitle = computed(() => route.meta.title ?? '')

const drawerOpen = ref(false)
watch(
  () => route.fullPath,
  () => {
    drawerOpen.value = false
  },
)

const userLine = computed(() => {
  const u = authStore.user
  if (!u) return ''
  const scope =
    u.role === 'campus_admin' && u.campus_keys.length > 0 ? `・${campusLabels(u.campus_keys)}` : ''
  return `${roleLabel(u.role)}${scope}`
})

async function handleLogout() {
  await authStore.logout()
  router.push({ name: 'login' })
}
</script>

<template>
  <div class="shell">
    <a class="skip-link" href="#main">跳到主要內容</a>

    <aside class="side" :class="{ 'is-open': drawerOpen }" aria-label="主選單">
      <div class="side__brand">
        <img src="/favicon.svg" alt="" width="28" height="28" />
        <div>
          <strong>常春藤官網</strong>
          <span>管理後台</span>
        </div>
        <button class="side__close" type="button" aria-label="關閉選單" @click="drawerOpen = false">
          <el-icon><Icons.Close /></el-icon>
        </button>
      </div>

      <nav class="side__nav">
        <section v-for="group in visibleGroups" :key="group.key" class="side__group">
          <h2 class="side__group-label">{{ group.label }}</h2>
          <ul>
            <li v-for="item in group.items" :key="item.name">
              <router-link
                :to="item.path"
                class="side__link"
                :class="{ 'is-active': activePath === item.path }"
                :aria-current="activePath === item.path ? 'page' : undefined"
              >
                <el-icon v-if="iconOf(item.icon)" class="side__icon">
                  <component :is="iconOf(item.icon)" />
                </el-icon>
                <span>{{ item.title }}</span>
              </router-link>
            </li>
          </ul>
        </section>
      </nav>

      <div class="side__user" v-if="authStore.user">
        <div class="side__user-text">
          <strong :title="authStore.user.email">{{ authStore.user.email }}</strong>
          <span>{{ userLine }}</span>
        </div>
        <el-tooltip content="登出" placement="top">
          <el-button text circle aria-label="登出" @click="handleLogout">
            <el-icon><Icons.SwitchButton /></el-icon>
          </el-button>
        </el-tooltip>
      </div>
    </aside>

    <div class="side__scrim" v-if="drawerOpen" @click="drawerOpen = false" />

    <div class="main-col">
      <header class="top">
        <button class="top__menu" type="button" aria-label="開啟選單" @click="drawerOpen = true">
          <span class="top__menu-lines" aria-hidden="true" />
        </button>
        <h1 class="top__title">{{ pageTitle }}</h1>
        <div class="top__actions">
          <a class="top__site" :href="WEBSITE_ASSET_BASE" target="_blank" rel="noopener">
            查看官網
            <el-icon><Icons.TopRight /></el-icon>
          </a>
        </div>
      </header>

      <main id="main" class="main" tabindex="-1">
        <router-view />
      </main>
    </div>
  </div>
</template>

<style scoped>
.shell {
  display: grid;
  grid-template-columns: var(--side-w) minmax(0, 1fr);
  min-height: 100svh;
}

.skip-link {
  position: absolute;
  top: -100px;
  left: 16px;
  z-index: 100;
  padding: 8px 12px;
  border-radius: 6px;
  background: var(--ink);
  color: var(--surface);
}

.skip-link:focus {
  top: 12px;
}

/* 側欄：比內容面略深一階的中性色，深綠只給目前位置 */
.side {
  position: sticky;
  top: 0;
  display: flex;
  flex-direction: column;
  height: 100svh;
  background: var(--surface-3);
  border-right: 1px solid var(--line);
}

.side__brand {
  display: flex;
  align-items: center;
  gap: 10px;
  height: var(--top-h);
  padding: 0 16px;
  border-bottom: 1px solid var(--line);
}

.side__brand img {
  border-radius: 6px;
}

.side__brand div {
  display: flex;
  flex-direction: column;
  line-height: 1.2;
}

.side__brand strong {
  font-size: 14px;
  color: var(--ink);
}

.side__brand span {
  font-size: 11px;
  color: var(--ink-3);
}

.side__close {
  display: none;
  margin-left: auto;
  border: 0;
  background: none;
  color: var(--ink-2);
  cursor: pointer;
  padding: 8px;
  border-radius: 6px;
}

.side__nav {
  flex: 1;
  overflow-y: auto;
  padding: 12px 10px 16px;
}

.side__group + .side__group {
  margin-top: 12px;
}

.side__group-label {
  margin: 0 0 4px;
  padding: 0 10px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  color: var(--ink-3);
}

.side__nav ul {
  list-style: none;
  margin: 0;
  padding: 0;
}

.side__link {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 32px;
  padding: 0 10px;
  border-radius: 6px;
  color: var(--ink-2);
  font-size: 14px;
  transition:
    background-color 150ms var(--ease-out),
    color 150ms var(--ease-out);
}

.side__link:hover {
  text-decoration: none;
  background: color-mix(in oklch, var(--ink), transparent 94%);
  color: var(--ink);
}

.side__link.is-active {
  background: var(--surface);
  color: var(--el-color-primary);
  font-weight: 600;
  box-shadow: var(--shadow-sm);
}

.side__icon {
  font-size: 16px;
  color: var(--ink-3);
}

.side__link.is-active .side__icon {
  color: var(--el-color-primary);
}

.side__user {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 12px 12px 16px;
  border-top: 1px solid var(--line);
}

.side__user-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
  line-height: 1.3;
}

.side__user-text strong {
  font-size: 13px;
  font-weight: 500;
  color: var(--ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.side__user-text span {
  font-size: 12px;
  color: var(--ink-3);
}

.side__scrim {
  display: none;
}

.main-col {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.top {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  gap: 12px;
  height: var(--top-h);
  padding: 0 28px;
  background: color-mix(in oklch, var(--surface-2), transparent 15%);
  backdrop-filter: blur(8px);
  border-bottom: 1px solid var(--line);
}

.top__menu {
  display: none;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border: 0;
  background: none;
  color: var(--ink);
  margin-left: -8px;
  border-radius: 6px;
  cursor: pointer;
}

.top__menu-lines {
  position: relative;
  display: block;
  width: 20px;
  height: 2px;
  background: currentColor;
  border-radius: 2px;
}

.top__menu-lines::before,
.top__menu-lines::after {
  content: '';
  position: absolute;
  left: 0;
  width: 20px;
  height: 2px;
  background: currentColor;
  border-radius: 2px;
}

.top__menu-lines::before {
  top: -6px;
}

.top__menu-lines::after {
  top: 6px;
}

.top__title {
  font-size: 17px;
}

.top__actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 8px;
}

.top__site {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  color: var(--ink-2);
}

.main {
  flex: 1;
  padding: 24px 28px 48px;
  outline: none;
}

@media (max-width: 900px) {
  .shell {
    grid-template-columns: minmax(0, 1fr);
  }

  .side {
    position: fixed;
    inset: 0 auto 0 0;
    z-index: 30;
    width: min(300px, 86vw);
    transform: translateX(-100%);
    transition: transform 220ms var(--ease-out);
    box-shadow: none;
  }

  .side.is-open {
    transform: none;
    box-shadow: var(--shadow-md);
  }

  .side__close {
    display: inline-flex;
  }

  .side__scrim {
    display: block;
    position: fixed;
    inset: 0;
    z-index: 20;
    background: oklch(0.2 0.02 150 / 0.4);
  }

  .top {
    padding: 0 16px;
  }

  .top__menu {
    display: inline-flex;
  }

  .main {
    padding: 16px 16px 40px;
  }
}
</style>
