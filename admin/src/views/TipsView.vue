<script setup lang="ts">
import { computed, nextTick, onMounted } from 'vue'
import { useRoute, useRouter, type RouteLocationRaw } from 'vue-router'
import { roleLabel } from '../api/labels'
import PageHeader from '../components/PageHeader.vue'
import { canEditSharedContent, canOpenPath } from '../router/nav'
import { useAuthStore } from '../stores/auth'
import manifest from '../assets/tips/manifest.json'
import {
  IS_APPLE,
  TIPS,
  TIP_ROLE_ORDER,
  TIP_SECTIONS,
  splitKeys,
  stepText,
  type Tip,
  type TipSectionKey,
} from '../tips/tips'

// 使用小技巧（2026-11-10）：只列不容易自己發現的功能。所有人都進得來，每條寫出哪些角色能用；
// 分類與「只列我能用的」寫進網址（router.replace），傳給同事打開是同一份。

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

const shotUrls = import.meta.glob('../assets/tips/*.webp', { eager: true, query: '?url', import: 'default' }) as Record<string, string>
const sizes = manifest as Record<string, { width: number; height: number } | undefined>

// 窄的截圖（側欄、抽屜、單張卡片）放在文字右邊；寬的放在文字下面、用原本的大小，字才看得清楚。
const SIDE_MAX_WIDTH = 560

function shotOf(tip: Tip): { src: string; width: number; height: number } | null {
  if (!tip.image) return null
  const src = shotUrls[`../assets/tips/${tip.image}.webp`]
  const size = sizes[tip.image]
  return src && size ? { src, ...size } : null
}

// 部署開關沒開的功能，誰都用不到，整條不列。
const enabledTips = computed(() => TIPS.filter(tip => !tip.feature || auth.features?.[tip.feature]))

function canUse(tip: Tip): boolean {
  const user = auth.user
  if (!user) return false
  if (!tip.roles || tip.roles.includes(user.role)) return true
  return Boolean(tip.shared && canEditSharedContent(user))
}

const sectionParam = computed<TipSectionKey | 'all'>(() => {
  const value = route.query.section
  return TIP_SECTIONS.some(section => section.key === value) ? (value as TipSectionKey) : 'all'
})
const onlyMine = computed(() => route.query.mine === '1')

function setQuery(next: { section?: TipSectionKey | 'all'; mine?: boolean }) {
  const section = next.section ?? sectionParam.value
  const mine = next.mine ?? onlyMine.value
  void router.replace({
    query: { ...route.query, section: section === 'all' ? undefined : section, mine: mine ? '1' : undefined },
    hash: '',
  }).catch(() => {})
}

const listedTips = computed(() => enabledTips.value.filter(tip => !onlyMine.value || canUse(tip)))

// 分類鈕只列有內容的類別（招生關閉、或勾了只列我能用的之後可能整類都沒有）。
const tabs = computed(() => [
  { key: 'all' as const, title: '全部', count: listedTips.value.length },
  ...TIP_SECTIONS.map(section => ({
    key: section.key,
    title: section.title,
    count: listedTips.value.filter(tip => tip.section === section.key).length,
  })).filter(tab => tab.count > 0),
])

const sections = computed(() =>
  TIP_SECTIONS
    .filter(section => sectionParam.value === 'all' || section.key === sectionParam.value)
    .map(section => ({ ...section, tips: listedTips.value.filter(tip => tip.section === section.key) }))
    .filter(section => section.tips.length > 0),
)

function whoCanUse(tip: Tip): string {
  if (!tip.roles) return '所有人'
  return TIP_ROLE_ORDER.filter(role => tip.roles!.includes(role)).map(roleLabel).join('、')
}

function visibleSteps(tip: Tip): string[] {
  return tip.steps
    .filter(step => typeof step === 'string' || !step.feature || auth.features?.[step.feature])
    .map(stepText)
}

// 「前往」只給進得去的人：看不到那一頁的帳號點了會被導回起始頁，看起來像壞掉。
function linkOf(tip: Tip): { to: RouteLocationRaw; label: string } | null {
  if (!tip.to || !canOpenPath(tip.to.path, auth.user)) return null
  return { to: { path: tip.to.path, query: tip.to.query }, label: tip.to.label }
}

// 從別處連 #tip-<id> 進來時捲到那一條（第一次進頁面時路由的 scrollBehavior 還沒有這頁的內容）。
onMounted(async () => {
  const id = route.hash.slice(1)
  if (!id.startsWith('tip-')) return
  await nextTick()
  document.getElementById(id)?.scrollIntoView({ block: 'start' })
})
</script>

<template>
  <div class="page tips">
    <PageHeader lead="後台有些功能要按特定的鍵、收在選單裡，或只在某些情況才出現。這裡一次列出來，每一條都寫了哪些角色能用。" />

    <div class="tips__toolbar">
      <div class="status-tabs tips__tabs" role="group" aria-label="小技巧分類">
        <button
          v-for="tab in tabs"
          :key="tab.key"
          type="button"
          class="status-tab"
          :class="{ 'is-active': sectionParam === tab.key }"
          :aria-pressed="sectionParam === tab.key"
          @click="setQuery({ section: tab.key })"
        >{{ tab.title }}<span class="status-tab__count num">{{ tab.count }}<span class="visually-hidden"> 條</span></span></button>
      </div>
      <el-checkbox :model-value="onlyMine" @update:model-value="setQuery({ mine: Boolean($event) })">只列我能用的</el-checkbox>
    </div>

    <p v-if="!sections.length" class="empty-note">這個分類沒有你能用的小技巧。</p>

    <section v-for="section in sections" :key="section.key" class="tips__section" :aria-labelledby="`tips-${section.key}`">
      <h2 :id="`tips-${section.key}`" class="tips__section-title">{{ section.title }}</h2>
      <article
        v-for="tip in section.tips"
        :id="`tip-${tip.id}`"
        :key="tip.id"
        class="tip panel"
        :class="{ 'has-shot': shotOf(tip), 'is-side': (shotOf(tip)?.width ?? Infinity) <= SIDE_MAX_WIDTH }"
        :aria-labelledby="`tip-${tip.id}-title`"
      >
        <div class="tip__text">
          <h3 :id="`tip-${tip.id}-title`" class="tip__title">
            <template v-for="(part, index) in splitKeys(tip.title, IS_APPLE)" :key="index">
              <kbd v-if="part.kind === 'key'">{{ part.value }}</kbd><template v-else>{{ part.value }}</template>
            </template>
          </h3>
          <p class="tip__who">
            <span class="tip__who-label">誰能用<span class="visually-hidden">：</span></span>{{ whoCanUse(tip) }}<template v-if="tip.roleNote">（{{ tip.roleNote }}）</template>
          </p>
          <component :is="visibleSteps(tip).length > 1 ? 'ol' : 'div'" class="tip__steps">
            <component :is="visibleSteps(tip).length > 1 ? 'li' : 'p'" v-for="(step, index) in visibleSteps(tip)" :key="index">
              <template v-for="(part, partIndex) in splitKeys(step, IS_APPLE)" :key="partIndex">
                <kbd v-if="part.kind === 'key'">{{ part.value }}</kbd><template v-else>{{ part.value }}</template>
              </template>
            </component>
          </component>
          <router-link v-if="linkOf(tip)" :to="linkOf(tip)!.to" class="tip__link">前往{{ linkOf(tip)!.label }}</router-link>
        </div>
        <figure v-if="shotOf(tip)" class="tip__shot">
          <img
            :src="shotOf(tip)!.src"
            :width="shotOf(tip)!.width"
            :height="shotOf(tip)!.height"
            :alt="tip.imageAlt ?? ''"
            loading="lazy"
            decoding="async"
          />
        </figure>
      </article>
    </section>
  </div>
</template>

<style scoped>
.tips__toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 16px;
  margin-bottom: 8px;
}

.tips__tabs {
  margin-bottom: 0;
}

.tips__section {
  margin-top: 28px;
}

.tips__section-title {
  margin-bottom: 12px;
  font-size: var(--text-xl);
}

.tip {
  display: grid;
  gap: 16px 28px;
  padding: 20px 24px;
  scroll-margin-top: calc(var(--top-h) + 16px);
}

.tip + .tip {
  margin-top: 16px;
}

/* 截圖的 width／height 是 CSS 像素（拍的時候 2 倍），不放大超過原寸。窄的截圖在寬螢幕放文字右邊。 */
@media (min-width: 1100px) {
  .tip.is-side {
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: start;
  }
}

.tip__text {
  min-width: 0;
  max-width: 72ch;
}

.tip__title {
  font-size: var(--text-lg);
  line-height: 1.5;
}

.tip__who {
  margin-top: 6px;
  color: var(--ink-2);
  font-size: var(--text-sm);
}

.tip__who-label {
  margin-right: 8px;
  color: var(--ink-3);
}

.tip__steps {
  margin: 12px 0 0;
  color: var(--ink);
  line-height: 1.7;
}

ol.tip__steps {
  padding-left: 1.4em;
}

ol.tip__steps li + li {
  margin-top: 6px;
}

.tip__link {
  display: inline-block;
  margin-top: 12px;
  font-size: var(--text-sm);
}

.tip__link::after {
  content: ' →' / '';
}

.tip__shot {
  margin: 0;
  min-width: 0;
}

.tip__shot img {
  display: block;
  max-width: 100%;
  height: auto;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface-2);
}

kbd {
  display: inline-block;
  min-width: 1.6em;
  margin: 0 2px;
  padding: 0 6px;
  border: 1px solid var(--line-strong);
  border-bottom-width: 2px;
  border-radius: 4px;
  background: var(--surface-2);
  color: var(--ink);
  font: inherit;
  font-size: 0.9em;
  line-height: 1.5;
  text-align: center;
  white-space: nowrap;
}

@media (max-width: 900px) {
  .tip {
    padding: 16px;
  }
}
</style>
