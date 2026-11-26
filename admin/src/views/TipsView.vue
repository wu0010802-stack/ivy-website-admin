<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter, type RouteLocationRaw } from 'vue-router'
import { ElMessage } from 'element-plus'
import { ArrowRight, Link as LinkIcon, Search, ZoomIn } from '@element-plus/icons-vue'
import { roleLabel } from '../api/labels'
import PageHeader from '../components/PageHeader.vue'
import TipText from '../components/TipText.vue'
import { notifyWarning } from '../composables/notify'
import { canEditSharedContent, canOpenPath, normalizeSearch } from '../router/nav'
import { useAuthStore } from '../stores/auth'
import manifest from '../assets/tips/manifest.json'
import {
  IS_APPLE,
  TIPS,
  TIP_ROLE_ORDER,
  TIP_SECTIONS,
  matchSnippet,
  splitKeys,
  stepText,
  tipSearchParts,
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
//
// 2026-11-26：搜尋多收同義詞（tips.ts 的 keywords）、標出符合的字、選了分類時說其他分類還有幾條；
// 展開的那一條寫進網址（#tip-<id>），按「前往」再回上一頁還在同一條，另外可以複製連結給同事；
// 截圖被縮小時可以點開看原本的大小。

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

const shotUrls = import.meta.glob('../assets/tips/*.webp', { eager: true, query: '?url', import: 'default' }) as Record<string, string>
const sizes = manifest as Record<string, { width: number; height: number } | undefined>

// 窄的截圖（側欄、抽屜、單張卡片）放在文字右邊；寬的放在文字下面、用原本的大小，字才看得清楚。
const SIDE_MAX_WIDTH = 560
// 截圖顯示不到原本的七成五才給「放大」：手機上寬截圖只剩三成、字看不清楚；
// 筆電縮到八成還讀得了，不必多一顆按鈕。
const ZOOM_BELOW = 0.75

interface Shot { src: string; width: number; height: number; alt: string }

function shotOf(tip: Tip): Shot | null {
  if (!tip.image) return null
  const src = shotUrls[`../assets/tips/${tip.image}.webp`]
  const size = sizes[tip.image]
  return src && size ? { src, ...size, alt: tip.imageAlt ?? '' } : null
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

// 搜尋比對標題、步驟、keywords（畫面上沒寫的同義詞）、誰能用與分類名。按鍵兩種寫法都收（⌘K 與 Ctrl＋K），
// Windows 的人搜「ctrl」、Mac 的人搜「⌘」都找得到。空白分開的每個字都要對到。
// 不寫進網址：只是找東西用，要傳給同事時傳分類或那一條的連結就夠了。
const query = ref('')
const terms = computed(() => normalizeSearch(query.value).split(/\s+/).filter(Boolean))
const searchText = new Map<string, string>()
function textOf(tip: Tip): string {
  let text = searchText.get(tip.id)
  if (text == null) {
    const section = TIP_SECTIONS.find(item => item.key === tip.section)?.title ?? ''
    text = normalizeSearch([...tipSearchParts(tip), whoCanUse(tip), tip.roleNote ?? '', section].join(' '))
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

const shownTips = computed(() =>
  listedTips.value.filter(tip => sectionParam.value === 'all' || tip.section === sectionParam.value),
)

// 頁首從參觀案件、官網內容這些頁點進來時已經選好一類；這時搜尋只找那一類，
// 別類有符合的要講出來，不能只寫「沒有符合」（搜「密碼」在參觀案件類是 0 條、帳號類有）。
const sectionTitle = computed(() => TIP_SECTIONS.find(section => section.key === sectionParam.value)?.title ?? '')
const elsewhere = computed(() => (terms.value.length ? listedTips.value.length - shownTips.value.length : 0))

// 搜尋結果的數量給報讀器念（畫面上看得到清單變短，報讀器聽不到）。
const resultNote = computed(() => {
  if (!terms.value.length) return ''
  return `找到 ${shownTips.value.length} 條小技巧${elsewhere.value ? `，其他分類還有 ${elsewhere.value} 條` : ''}`
})

// ── 展開 ──
const openIds = ref(new Set<string>())
function setOpen(id: string, open: boolean) {
  const next = new Set(openIds.value)
  if (open) next.add(id)
  else next.delete(id)
  openIds.value = next
}
const allOpen = computed(() => shownTips.value.length > 0 && shownTips.value.every(tip => openIds.value.has(tip.id)))

// 展開的那一條寫進網址（#tip-<id>，replace 不多一筆上一頁）：按「前往」去試、再按上一頁，
// 回來還是展開在同一條；網址貼給同事，對方打開也是這一條。收起它或換分類就拿掉。
const hashOf = (id: string) => `#tip-${id}`
function writeHash(hash: string) {
  if (route.hash === hash) return
  void router.replace({ query: route.query, hash }).catch(() => {})
}

function toggle(tip: Tip) {
  const open = !openIds.value.has(tip.id)
  setOpen(tip.id, open)
  if (open) writeHash(hashOf(tip.id))
  else if (route.hash === hashOf(tip.id)) writeHash('')
}

function toggleAll() {
  const open = !allOpen.value
  const next = new Set(openIds.value)
  for (const tip of shownTips.value) {
    if (open) next.add(tip.id)
    else next.delete(tip.id)
  }
  openIds.value = next
  if (!open && route.hash.startsWith('#tip-')) writeHash('')
}

// 「前往」只給進得去的人：看不到那一頁的帳號點了會被導回起始頁，看起來像壞掉。
function linkOf(tip: Tip): { to: RouteLocationRaw; label: string } | null {
  if (!tip.to || !canOpenPath(tip.to.path, auth.user)) return null
  return { to: { path: tip.to.path, query: tip.to.query }, label: tip.to.label }
}

// 連結不帶分類與「只列我能用的」：對方打開看到的是完整清單裡的這一條。
async function copyLink(tip: Tip) {
  const href = router.resolve({ path: '/tips', hash: hashOf(tip.id) }).href
  try {
    await navigator.clipboard.writeText(new URL(href, window.location.origin).href)
    ElMessage.success('已複製這一條的連結，可以貼給同事')
  } catch {
    notifyWarning('無法自動複製，請直接複製網址列的網址')
  }
}

// 從 #tip-<id> 連進來（同事貼的連結、按上一頁回來）時展開那一條、捲過去。
// 自己點開時寫進網址的不用再捲：那一條已經是展開的。
async function revealHash(hash: string, entering = false) {
  const id = hash.slice(1)
  if (!id.startsWith('tip-')) return
  const tip = enabledTips.value.find(item => item.id === id.slice(4))
  if (!tip || (!entering && openIds.value.has(tip.id))) return
  // 連結指的那一條被分類或「只列我能用的」濾掉時，先拿掉條件：連結就是要看這一條。
  if (!shownTips.value.includes(tip)) {
    query.value = ''
    await router.replace({ query: { ...route.query, section: undefined, mine: undefined }, hash }).catch(() => {})
  }
  setOpen(tip.id, true)
  await nextTick()
  document.getElementById(id)?.scrollIntoView({ block: 'start' })
}
watch(() => route.hash, hash => { void revealHash(hash) })

// ── 截圖放大 ──
// 展開內容能用的寬度（頁面寬度扣掉左右留白），用來判斷截圖有沒有被縮小；側欄收合、轉橫都會變。
const root = ref<HTMLElement | null>(null)
const bodyWidth = ref(Number.POSITIVE_INFINITY)
const sideLayout = ref(true)
let observer: ResizeObserver | null = null

function measure() {
  const el = root.value
  if (!el) return
  const style = getComputedStyle(el)
  const px = (name: string) => Number.parseFloat(style.getPropertyValue(name)) || 0
  // 2＝面板左右的邊框
  bodyWidth.value = el.clientWidth - px('--tip-pad-x') - px('--tip-indent') - 2
  sideLayout.value = window.innerWidth >= 1100
}

function isShrunk(shot: Shot): boolean {
  if (sideLayout.value && shot.width <= SIDE_MAX_WIDTH) return false
  return bodyWidth.value < shot.width * ZOOM_BELOW
}

// 42＝對話框左右內距與外框。放不下整張時（手機）只看得到左上角，要說可以拖。
const ZOOM_CHROME = 42
const zoomed = ref<{ title: string; shot: Shot; pans: boolean } | null>(null)
const zoomOpen = ref(false)
function zoom(tip: Tip, shot: Shot) {
  zoomed.value = {
    title: splitKeys(tip.title, IS_APPLE).map(part => part.value).join(''),
    shot,
    pans: shot.width + ZOOM_CHROME > window.innerWidth - 16,
  }
  zoomOpen.value = true
}

onMounted(() => {
  if (root.value && typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(measure)
    observer.observe(root.value)
  }
  void revealHash(route.hash, true)
})
onBeforeUnmount(() => observer?.disconnect())

// ── 畫面上的每一列 ──
const sections = computed(() =>
  TIP_SECTIONS
    .filter(section => sectionParam.value === 'all' || section.key === sectionParam.value)
    .map(section => ({
      ...section,
      rows: shownTips.value.filter(tip => tip.section === section.key).map((tip) => {
        const steps = visibleSteps(tip)
        const shot = shotOf(tip)
        const open = openIds.value.has(tip.id)
        return {
          tip,
          steps,
          shot,
          open,
          who: whoCanUse(tip),
          link: linkOf(tip),
          side: Boolean(shot && shot.width <= SIDE_MAX_WIDTH),
          zoomable: Boolean(shot && isShrunk(shot)),
          // 搜尋字只在步驟裡時，收起的列下面多列出那一句，看得出為什麼找到這一條。
          snippet: open ? null : matchSnippet(tip.title, steps, terms.value, IS_APPLE),
        }
      }),
    }))
    .filter(section => section.rows.length > 0),
)
</script>

<template>
  <div ref="root" class="page tips">
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
      <template v-if="elsewhere">
        「{{ sectionTitle }}」這一類沒有符合「{{ query.trim() }}」的小技巧，其他分類有 <span class="num">{{ elsewhere }}</span> 條。<el-button link type="primary" @click="setQuery({ section: 'all' })">看全部分類</el-button>
      </template>
      <template v-else-if="terms.length">
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
          v-for="row in section.rows"
          :id="`tip-${row.tip.id}`"
          :key="row.tip.id"
          class="tip"
          :class="{ 'is-open': row.open }"
        >
          <div class="tip__row">
            <h3 class="tip__heading">
              <button
                :id="`tip-${row.tip.id}-title`"
                type="button"
                class="tip__toggle"
                :aria-expanded="row.open"
                :aria-controls="`tip-${row.tip.id}-body`"
                @click="toggle(row.tip)"
              >
                <el-icon class="tip__chevron" aria-hidden="true"><ArrowRight /></el-icon>
                <span class="tip__title"><TipText :text="row.tip.title" :terms="terms" /></span>
              </button>
            </h3>
            <p v-if="row.snippet" class="tip__snippet"><TipText :text="row.snippet" :terms="terms" /></p>
            <p class="tip__who">
              <span class="tip__who-label">誰能用<span class="visually-hidden">：</span></span>{{ row.who }}<template v-if="row.tip.roleNote">（{{ row.tip.roleNote }}）</template>
            </p>
          </div>
          <div
            :id="`tip-${row.tip.id}-body`"
            class="tip__body"
            :hidden.attr="row.open ? undefined : 'until-found'"
            @beforematch="setOpen(row.tip.id, true)"
          >
            <div class="tip__content" :class="{ 'is-side': row.side }">
              <div class="tip__text">
                <component :is="row.steps.length > 1 ? 'ol' : 'div'" class="tip__steps">
                  <component :is="row.steps.length > 1 ? 'li' : 'p'" v-for="(step, index) in row.steps" :key="index">
                    <TipText :text="step" :terms="terms" />
                  </component>
                </component>
                <p class="tip__actions">
                  <router-link v-if="row.link" :to="row.link.to" class="tip__link">前往{{ row.link.label }}</router-link>
                  <button type="button" class="tip__copy" @click="copyLink(row.tip)">
                    <el-icon aria-hidden="true"><LinkIcon /></el-icon>複製這一條的連結
                  </button>
                </p>
              </div>
              <figure v-if="row.shot" class="tip__shot">
                <button v-if="row.zoomable" type="button" class="tip__zoom" @click="zoom(row.tip, row.shot)">
                  <img
                    :src="row.shot.src"
                    :width="row.shot.width"
                    :height="row.shot.height"
                    :alt="row.shot.alt"
                    loading="lazy"
                    decoding="async"
                  />
                  <span class="tip__zoom-hint"><el-icon aria-hidden="true"><ZoomIn /></el-icon>放大</span>
                </button>
                <img
                  v-else
                  :src="row.shot.src"
                  :width="row.shot.width"
                  :height="row.shot.height"
                  :alt="row.shot.alt"
                  loading="lazy"
                  decoding="async"
                />
              </figure>
            </div>
          </div>
        </li>
      </ul>
    </section>

    <p v-if="sections.length && elsewhere" class="tips__elsewhere">
      其他分類還有 <span class="num">{{ elsewhere }}</span> 條符合「{{ query.trim() }}」。<el-button link type="primary" @click="setQuery({ section: 'all' })">看全部分類</el-button>
    </p>

    <!-- 截圖原本的大小，放在可以上下左右捲的框裡（手機用手指拖）。 -->
    <el-dialog
      v-model="zoomOpen"
      class="tips__zoom-dialog"
      :title="zoomed?.title"
      :width="zoomed ? `min(${zoomed.shot.width + ZOOM_CHROME}px, calc(100vw - 16px))` : undefined"
      align-center
      @closed="zoomed = null"
    >
      <p v-if="zoomed?.pans" class="hint tips__zoom-note">這是原本的大小，左右拖動可以看截圖的其他地方。</p>
      <div v-if="zoomed" class="tips__zoom-scroll" tabindex="0" role="group" aria-label="截圖原本的大小，可以捲動">
        <img :src="zoomed.shot.src" :width="zoomed.shot.width" :height="zoomed.shot.height" :alt="zoomed.shot.alt" />
      </div>
    </el-dialog>
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
  grid-area: 1 / 2;
  margin: 0;
  color: var(--ink-2);
  font-size: var(--text-sm);
  line-height: 1.6;
}

/* 搜尋字只在步驟裡時列出那一句，對齊標題字（箭頭 16＋間距 12）。DOM 排在誰能用前面：窄螢幕一欄時順序是標題、這一句、誰能用。 */
.tip__snippet {
  grid-area: 2 / 1;
  margin: 0;
  padding-left: 28px;
  color: var(--ink-2);
  font-size: var(--text-sm);
  line-height: 1.6;
}

/* 誰能用折成兩行時不要把那一句往下推：有那一句的列，誰能用跨兩列。 */
.tip__snippet + .tip__who {
  grid-row: 1 / span 2;
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

.tip__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0 24px;
  margin-top: 8px;
  font-size: var(--text-sm);
}

.tip__link,
.tip__copy {
  display: inline-flex;
  align-items: center;
  min-height: 32px;
}

.tip__link::after {
  content: ' →' / '';
  white-space: pre;
}

/* 次要動作：字用說明色，不跟「前往」搶。 */
.tip__copy {
  gap: 6px;
  padding: 0;
  border: 0;
  background: none;
  color: var(--ink-2);
  font: inherit;
  cursor: pointer;
}

.tip__copy:hover {
  color: var(--ink);
  text-decoration: underline;
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

/* 截圖被縮小時整張可以點（JS 量寬度決定，見 isShrunk）；右下角的「放大」讓人知道能點。 */
.tip__zoom {
  position: relative;
  display: block;
  max-width: 100%;
  padding: 0;
  border: 0;
  border-radius: var(--radius);
  background: none;
  font: inherit;
  cursor: zoom-in;
}

.tip__zoom-hint {
  position: absolute;
  right: 8px;
  bottom: 8px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-height: 28px;
  padding: 0 10px;
  border: 1px solid var(--line-strong);
  border-radius: 999px;
  background: var(--surface);
  color: var(--ink);
  font-size: var(--text-xs);
  font-weight: 600;
  box-shadow: var(--shadow-sm);
}

.tips__elsewhere {
  margin-top: 16px;
  color: var(--ink-2);
  text-align: center;
}

/* 放大：截圖用原本的大小，放不下就在框裡捲。 */
.tips__zoom-note {
  margin-bottom: 8px;
}

.tips__zoom-scroll {
  max-height: calc(100svh - 200px);
  overflow: auto;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface-2);
}

.tips__zoom-scroll img {
  display: block;
  max-width: none;
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

  .tip__who,
  .tip__snippet,
  .tip__snippet + .tip__who {
    grid-area: auto;
    padding-left: calc(var(--tip-indent) - var(--tip-pad-x));
  }

  .tip__link,
  .tip__copy {
    min-height: 44px;
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
