<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter, type RouteLocationRaw } from 'vue-router'
import { ArrowRight, Search } from '@element-plus/icons-vue'
import { roleLabel } from '../api/labels'
import PageHeader from '../components/PageHeader.vue'
import { canEditSharedContent, canOpenPath, normalizeSearch } from '../router/nav'
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
//
// 2026-11-20 改成可以展開的清單：原本 34 張卡片連同截圖一路攤開，桌機整頁約 16,000px，
// 想找一條只能一直捲。現在每類一個面板、每條一列，平常只看標題與誰能用，點標題才展開步驟與截圖；
// 另外加上搜尋。收起來的內容用 hidden="until-found"：瀏覽器的頁內尋找（⌘F）找得到，
// 找到時自己展開（beforematch 同步狀態）；不支援的瀏覽器當一般 hidden。

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

function whoCanUse(tip: Tip): string {
  if (!tip.roles) return '所有人'
  return TIP_ROLE_ORDER.filter(role => tip.roles!.includes(role)).map(roleLabel).join('、')
}

function visibleSteps(tip: Tip): string[] {
  return tip.steps
    .filter(step => typeof step === 'string' || !step.feature || auth.features?.[step.feature])
    .map(stepText)
}

// 搜尋比對標題、步驟、誰能用與分類名。按鍵兩種寫法都收（⌘K 與 Ctrl＋K），
// Windows 的人搜「ctrl」、Mac 的人搜「⌘」都找得到。空白分開的每個字都要對到。
// 不寫進網址：只是找東西用，要傳給同事時傳分類就夠了。
const query = ref('')
const terms = computed(() => normalizeSearch(query.value).split(/\s+/).filter(Boolean))
const searchText = new Map<string, string>()
function textOf(tip: Tip): string {
  let text = searchText.get(tip.id)
  if (text == null) {
    const plain = (value: string) => [true, false].map(apple => splitKeys(value, apple).map(part => part.value).join('')).join(' ')
    const section = TIP_SECTIONS.find(item => item.key === tip.section)?.title ?? ''
    text = normalizeSearch([plain(tip.title), ...tip.steps.map(step => plain(stepText(step))), whoCanUse(tip), tip.roleNote ?? '', section].join(' '))
    searchText.set(tip.id, text)
  }
  return text
}

const listedTips = computed(() => enabledTips.value.filter(tip =>
  (!onlyMine.value || canUse(tip)) && terms.value.every(term => textOf(tip).includes(term)),
))

// 分類鈕只列有內容的類別（招生關閉、勾了只列我能用的、或搜尋之後，可能整類都沒有）。
// 目前選的那一類就算是 0 也留著，不然按鈕消失，看不出清單為什麼是空的。
const tabs = computed(() => [
  { key: 'all' as const, title: '全部', count: listedTips.value.length },
  ...TIP_SECTIONS.map(section => ({
    key: section.key,
    title: section.title,
    count: listedTips.value.filter(tip => tip.section === section.key).length,
  })).filter(tab => tab.count > 0 || tab.key === sectionParam.value),
])

const sections = computed(() =>
  TIP_SECTIONS
    .filter(section => sectionParam.value === 'all' || section.key === sectionParam.value)
    .map(section => ({ ...section, tips: listedTips.value.filter(tip => tip.section === section.key) }))
    .filter(section => section.tips.length > 0),
)
const shownTips = computed(() => sections.value.flatMap(section => section.tips))

// 搜尋結果的數量給報讀器念（畫面上看得到清單變短，報讀器聽不到）。
const resultNote = computed(() => terms.value.length ? `找到 ${shownTips.value.length} 條小技巧` : '')

// ── 展開 ──
const openIds = ref(new Set<string>())
const isOpen = (tip: Tip) => openIds.value.has(tip.id)
function setOpen(id: string, open: boolean) {
  const next = new Set(openIds.value)
  if (open) next.add(id)
  else next.delete(id)
  openIds.value = next
}
const allOpen = computed(() => shownTips.value.length > 0 && shownTips.value.every(isOpen))
function toggleAll() {
  const open = !allOpen.value
  const next = new Set(openIds.value)
  for (const tip of shownTips.value) {
    if (open) next.add(tip.id)
    else next.delete(tip.id)
  }
  openIds.value = next
}

// 「前往」只給進得去的人：看不到那一頁的帳號點了會被導回起始頁，看起來像壞掉。
function linkOf(tip: Tip): { to: RouteLocationRaw; label: string } | null {
  if (!tip.to || !canOpenPath(tip.to.path, auth.user)) return null
  return { to: { path: tip.to.path, query: tip.to.query }, label: tip.to.label }
}

// 從別處連 #tip-<id> 進來時展開那一條、捲過去（第一次進頁面時路由的 scrollBehavior 還沒有這頁的內容）。
async function revealHash(hash: string) {
  const id = hash.slice(1)
  if (!id.startsWith('tip-')) return
  const tipId = id.slice(4)
  if (!TIPS.some(tip => tip.id === tipId)) return
  setOpen(tipId, true)
  await nextTick()
  document.getElementById(id)?.scrollIntoView({ block: 'start' })
}
onMounted(() => { void revealHash(route.hash) })
watch(() => route.hash, hash => { void revealHash(hash) })
</script>

<template>
  <div class="page tips">
    <PageHeader lead="後台有些功能要按特定的鍵、收在選單裡，或只在某些情況才出現。這裡一次列出來，每一條都寫了哪些角色能用。" />

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

    <div class="toolbar tips__toolbar">
      <el-input
        v-model="query"
        class="tips__search"
        placeholder="搜尋，例如：匯出、密碼、照片"
        aria-label="搜尋小技巧"
        clearable
        :prefix-icon="Search"
      />
      <el-checkbox :model-value="onlyMine" @update:model-value="setQuery({ mine: Boolean($event) })">只列我能用的</el-checkbox>
      <span class="toolbar__spacer" />
      <el-button v-if="shownTips.length" class="tips__expand-all" @click="toggleAll">{{ allOpen ? '全部收起' : '全部展開' }}</el-button>
    </div>
    <p class="visually-hidden" aria-live="polite">{{ resultNote }}</p>

    <div v-if="!sections.length" class="empty-note">
      <template v-if="terms.length">
        沒有符合「{{ query.trim() }}」的小技巧。<el-button link type="primary" @click="query = ''">清除搜尋</el-button>
      </template>
      <template v-else>這個分類沒有你能用的小技巧。</template>
    </div>

    <section
      v-for="section in sections"
      :key="section.key"
      class="tips__section panel"
      :aria-labelledby="`tips-${section.key}`"
    >
      <div class="tips__head">
        <h2 :id="`tips-${section.key}`" class="tips__section-title">{{ section.title }}</h2>
        <span class="tips__who-head" aria-hidden="true">誰能用</span>
      </div>
      <ul class="tips__list" role="list">
        <li
          v-for="tip in section.tips"
          :id="`tip-${tip.id}`"
          :key="tip.id"
          class="tip"
          :class="{ 'is-open': isOpen(tip) }"
        >
          <div class="tip__row">
            <h3 class="tip__heading">
              <button
                :id="`tip-${tip.id}-title`"
                type="button"
                class="tip__toggle"
                :aria-expanded="isOpen(tip)"
                :aria-controls="`tip-${tip.id}-body`"
                @click="setOpen(tip.id, !isOpen(tip))"
              >
                <el-icon class="tip__chevron" aria-hidden="true"><ArrowRight /></el-icon>
                <span class="tip__title">
                  <template v-for="(part, index) in splitKeys(tip.title, IS_APPLE)" :key="index">
                    <kbd v-if="part.kind === 'key'">{{ part.value }}</kbd><template v-else>{{ part.value }}</template>
                  </template>
                </span>
              </button>
            </h3>
            <p class="tip__who">
              <span class="tip__who-label">誰能用<span class="visually-hidden">：</span></span>{{ whoCanUse(tip) }}<template v-if="tip.roleNote">（{{ tip.roleNote }}）</template>
            </p>
          </div>
          <div
            :id="`tip-${tip.id}-body`"
            class="tip__body"
            :hidden.attr="isOpen(tip) ? undefined : 'until-found'"
            @beforematch="setOpen(tip.id, true)"
          >
            <div class="tip__content" :class="{ 'is-side': (shotOf(tip)?.width ?? Infinity) <= SIDE_MAX_WIDTH }">
              <div class="tip__text">
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
            </div>
          </div>
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
/* 每列兩欄：標題｜誰能用。面板標題列用同一組欄寬，「誰能用」只在上面寫一次。 */
.tips {
  --tip-pad-x: 20px;
  --tip-indent: 48px; /* 展開的內容對齊標題字，不對齊箭頭：pad-x＋箭頭 16＋間距 12 */
  --tip-who-w: 18em;
}

.tips__tabs {
  margin-bottom: 12px;
}

.tips__toolbar {
  margin-bottom: 20px;
}

.tips__search {
  width: 320px;
}

.tips__head,
.tip__row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) var(--tip-who-w);
  gap: 4px 24px;
  padding-inline: var(--tip-pad-x);
}

.tips__head {
  align-items: baseline;
  padding-block: 14px 12px;
  border-bottom: 1px solid var(--line);
  background: var(--surface-2);
}

.tips__section-title {
  font-size: var(--text-xl);
}

.tips__who-head {
  color: var(--ink-3);
  font-size: var(--text-xs);
}

.tips__list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.tip {
  scroll-margin-top: calc(var(--top-h) + 16px);
}

.tip + .tip {
  border-top: 1px solid var(--line);
}

/* 整列都能點：按鈕的 ::after 蓋住整列（含右邊的誰能用）；焦點框仍畫在按鈕上。 */
.tip__row {
  position: relative;
  align-items: baseline;
  padding-block: 12px;
  transition: background-color 150ms var(--ease-out);
}

/* 觸控裝置點過之後 :hover 會黏著，只給有滑鼠的裝置。 */
@media (hover: hover) {
  .tip__row:hover {
    background: var(--surface-2);
  }
}

.tip__heading {
  min-width: 0;
  font-size: var(--text-md);
  font-weight: 600;
  line-height: 1.6;
}

.tip__toggle {
  display: flex;
  align-items: baseline;
  gap: 12px;
  width: 100%;
  padding: 0;
  border: 0;
  background: none;
  color: var(--ink);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.tip__toggle::after {
  content: '';
  position: absolute;
  inset: 0;
}

.tip__chevron {
  flex-shrink: 0;
  align-self: center;
  width: 16px;
  color: var(--ink-3);
  font-size: var(--text-base);
  transition: transform 150ms var(--ease-out);
}

.tip.is-open .tip__chevron {
  transform: rotate(90deg);
  color: var(--ink-2);
}

.tip__title {
  min-width: 0;
}

.tip__who {
  margin: 0;
  color: var(--ink-2);
  font-size: var(--text-sm);
  line-height: 1.6;
}

/* 桌機的「誰能用」寫在面板標題列，每列只放角色；窄螢幕排到標題下面，前面要有字。 */
.tip__who-label {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

/* hidden="until-found" 收起時只有 content-visibility，盒子本身還在：間距放在裡面那層。 */
.tip__content {
  display: grid;
  gap: 16px 28px;
  padding: 2px var(--tip-pad-x) 20px var(--tip-indent);
}

@media (min-width: 1100px) {
  .tip__content.is-side {
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: start;
  }
}

.tip__text {
  min-width: 0;
  max-width: 72ch;
}

.tip__steps {
  margin: 0;
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

/* 截圖的 width／height 是 CSS 像素（拍的時候 2 倍），不放大超過原寸。 */
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
  font-weight: 500;
  line-height: 1.5;
  text-align: center;
  white-space: nowrap;
}

@media (max-width: 720px) {
  .tips {
    --tip-pad-x: 16px;
    --tip-indent: 44px;
  }

  .tips__search {
    width: 100%;
  }

  .tips__head,
  .tip__row {
    grid-template-columns: minmax(0, 1fr);
  }

  .tips__who-head {
    display: none;
  }

  .tip__who {
    padding-left: calc(var(--tip-indent) - var(--tip-pad-x));
  }

  .tip__who-label {
    position: static;
    width: auto;
    height: auto;
    margin: 0 8px 0 0;
    overflow: visible;
    clip-path: none;
    color: var(--ink-3);
  }
}

@media (prefers-reduced-motion: reduce) {
  .tip__row,
  .tip__chevron {
    transition: none;
  }
}
</style>
