<script setup lang="ts">
// 入學資訊頁主體：公開頁 pages/admission.vue 與草稿預覽 pages/preview.vue?page=admission 共用。
// 2026-09-24 改版為首頁版型（mock：design/admission-homestyle-mockup-20260924/）：滿版 hero＋章節索引、
// 薄荷色帶入學流程、五校式分班對照、拍立得新生準備、消息紙張收退費。內容由後台 admission_content 管理，
// 區塊大標固定在這裡（標題字型是子集，見 CLAUDE.md「字型子集」）。分班對照依生日規則計算，見 admission-classes.ts。
import { ADMISSION_HERO_IMAGE, responsiveImage } from '~/utils/responsive-image'
import { academicYear, classPlan, classTable, parseBirthday, taipeiYmd } from '~/utils/admission-classes'
import type { AdmissionContent } from '~/types/site-content'

const props = defineProps<{ admission: AdmissionContent }>()
const admission = computed(() => props.admission)

const currentYear = academicYear(taipeiYmd())
const years = [currentYear, currentYear + 1]
const rows = classTable(years)
// 班別分頁：年齡是 9/1 前滿幾歲（民國 Y/9/2～Y+1/9/1 出生，Y+3 學年度讀幼幼班）。
const classTabs = rows.map((row, i) => ({ ...row, offset: i + 3, age: i + 2 }))

const selectedOffset = ref(3)
const selectedClass = computed(() => classTabs.find((tab) => tab.offset === selectedOffset.value)!)

// 分頁鍵盤：左右鍵切換並移動焦點（WAI-ARIA tabs）。
function onTabKey(event: KeyboardEvent) {
  const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
  if (!step) return
  event.preventDefault()
  const index = classTabs.findIndex((tab) => tab.offset === selectedOffset.value)
  const next = classTabs[(index + step + classTabs.length) % classTabs.length]!
  selectedOffset.value = next.offset
  nextTick(() => document.getElementById(`class-tab-${next.offset}`)?.focus())
}

const birthday = ref('')
const plan = computed(() => {
  const birth = parseBirthday(birthday.value)
  return birth ? classPlan(birth, currentYear) : null
})
// 輸入生日後，分頁跳到寶貝今年讀的班（還沒入學或已上小學就停在原處）。
// classPlan 的 rows 依序是幼幼班（offset 3）到小一（offset 7）。
watch(plan, (value) => {
  const index = value?.rows.findIndex((row) => row.current) ?? -1
  if (index >= 0 && index + 3 <= 6) selectedOffset.value = index + 3
})

const hasNewcomerExtras = computed(() => {
  const a = admission.value
  return a.uniformWeek.length > 0 || a.pickupNotes.length > 0 || a.registrationNotes.length > 0
})
const showNewcomer = computed(() => admission.value.phases.length > 0 || hasNewcomerExtras.value)

// 章節索引與區塊同一個條件：後台把新生須知全部清空時，連結也一起拿掉，不留點了沒反應的錨點。
const chapters = computed(() => [
  { id: 'process', label: '入學流程', hint: `${admission.value.steps.length} 個步驟` },
  { id: 'classes', label: '分班對照', hint: '輸入生日查班別' },
  ...(showNewcomer.value ? [{ id: 'newcomer', label: '新生準備', hint: '必備品與叮嚀' }] : []),
  { id: 'fees', label: '收退費辦法', hint: '補助與退費規定' }
].map((chapter, i) => ({ ...chapter, no: String(i + 1).padStart(2, '0') })))
const chapterNo = (id: string) => chapters.value.find((chapter) => chapter.id === id)?.no

// 拍立得：照片依序輪用，正反面各自可聚焦（翻到哪面，另一面設 inert）。
const PRINT_PHOTOS = [
  { name: 'day-lunch', alt: '孩子自己拿湯匙吃點心' },
  { name: 'day-home', alt: '孩子在教室專心看繪本' }
]
const flipped = ref<Record<number, boolean>>({})
const flipButtons = ref<Record<string, HTMLButtonElement | null>>({})
function flip(index: number, toBack: boolean) {
  flipped.value = { ...flipped.value, [index]: toBack }
  nextTick(() => flipButtons.value[`${index}-${toBack ? 'back' : 'front'}`]?.focus({ preventScroll: true }))
}
</script>

<template>
  <main id="main" tabindex="-1" class="adm" data-cta-entry="admission">
    <section class="adm-hero photo-hero" aria-labelledby="admission-title">
      <img class="adm-hero-photo" v-bind="responsiveImage(ADMISSION_HERO_IMAGE)" alt="孩子早上到校，和老師打招呼" loading="eager" fetchpriority="high">
      <div class="adm-hero-shade" aria-hidden="true" />
      <div class="adm-wrap adm-hero-body">
        <div class="adm-hero-copy">
          <span class="adm-eyebrow">常春藤幼兒園 · 入學資訊</span>
          <h1 id="admission-title">從參觀到開學，<br>一步<span class="adm-grow">一步來<span class="adm-underline" aria-hidden="true"><svg viewBox="0 0 180 14" preserveAspectRatio="none"><path d="M3 9Q48 2 92 7T177 6" /></svg></span></span>。</h1>
          <p v-if="admission.intro" class="adm-lede">{{ admission.intro }}</p>
          <div class="adm-hero-actions">
            <NuxtLink class="adm-pill-button" to="/visit">預約參觀<svg class="icon" aria-hidden="true" focusable="false"><use href="#i-arrow-right" /></svg></NuxtLink>
            <a class="adm-text-link" href="#classes">查寶貝讀哪一班<svg class="icon" aria-hidden="true" focusable="false"><use href="#i-arrow-down" /></svg></a>
          </div>
          <p v-if="admission.notice" class="adm-notice">{{ admission.notice }}</p>
        </div>
        <ol class="adm-chapters" aria-label="本頁章節">
          <li v-for="chapter in chapters" :key="chapter.id">
            <a :href="`#${chapter.id}`"><span class="adm-num" lang="en">{{ chapter.no }}</span><b>{{ chapter.label }}</b><span>{{ chapter.hint }}</span></a>
          </li>
        </ol>
      </div>
    </section>

    <!-- 入學流程：首頁「關於常春藤」的薄荷色帶 -->
    <section id="process" class="adm-process" aria-labelledby="process-title">
      <div class="adm-watermark" aria-hidden="true">入學流程</div>
      <div class="adm-wrap">
        <div class="adm-process-layout">
          <div>
            <p class="adm-kicker"><span lang="en"><b>{{ chapterNo('process') }}</b>How to join</span></p>
            <h2 id="process-title" class="adm-title">每一步，<br>都有人陪著你。</h2>
            <p class="adm-process-text">每一步都有老師陪著確認，不確定的地方，參觀時直接問我們。</p>
          </div>
          <figure class="adm-photo">
            <img v-bind="responsiveImage('day-discover', '(max-width: 900px) 100vw, 45vw')" alt="老師蹲在孩子身邊，一起看桌上的教具" loading="lazy">
            <figcaption>老師陪著孩子，一步一步熟悉新環境。</figcaption>
          </figure>
        </div>
        <ol class="adm-steps" :style="{ '--step-count': Math.min(admission.steps.length, 6) }">
          <li v-for="(step, i) in admission.steps" :key="i" class="adm-step">
            <span class="adm-step-dot" lang="en">{{ String(i + 1).padStart(2, '0') }}</span>
            <div class="adm-step-card">
              <small v-if="step.when">{{ step.when }}</small>
              <h3>{{ step.title }}</h3>
              <p v-if="step.text">{{ step.text }}</p>
            </div>
          </li>
        </ol>
      </div>
    </section>

    <!-- 分班對照：首頁五校區塊的分頁與大圓角卡 -->
    <section id="classes" class="adm-classes" aria-labelledby="classes-title">
      <div class="adm-wrap">
        <div class="adm-center-head">
          <p class="adm-kicker"><span lang="en"><b>{{ chapterNo('classes') }}</b>Which class</span></p>
          <h2 id="classes-title" class="adm-title">寶貝何時入學？</h2>
          <p>9 月 2 日到隔年 9 月 1 日出生為同一屆。點班別看出生區間，或直接輸入生日。</p>
        </div>
        <div class="adm-class-tabs" role="tablist" aria-label="班別">
          <button
            v-for="tab in classTabs"
            :id="`class-tab-${tab.offset}`"
            :key="tab.offset"
            type="button"
            role="tab"
            :aria-selected="tab.offset === selectedOffset"
            aria-controls="class-panel"
            :tabindex="tab.offset === selectedOffset ? 0 : -1"
            @click="selectedOffset = tab.offset"
            @keydown="onTabKey"
          >
            <span class="adm-age" aria-hidden="true">{{ tab.age }}<sup>歲</sup></span>
            <b>{{ tab.name }}</b>
          </button>
        </div>
        <div class="adm-class-board">
          <div class="adm-finder">
            <label for="birthday">寶貝的生日</label>
            <input id="birthday" v-model="birthday" type="date" min="2015-01-01" max="2035-12-31">
            <div aria-live="polite">
              <template v-if="plan">
                <p class="adm-finder-summary">{{ plan.summary }}</p>
                <ol class="adm-years">
                  <li v-for="row in plan.rows" :key="row.year" :class="{ current: row.current, past: row.past }">
                    <span><span lang="en">{{ row.year }}</span> 學年度</span>
                    <strong>{{ row.name }}</strong>
                  </li>
                </ol>
              </template>
              <p v-else class="adm-finder-empty">選好日期，這裡會列出寶貝從幼幼班到小一的每一年，上面的班別也會跟著跳過去。</p>
            </div>
          </div>
          <div id="class-panel" class="adm-class-detail" role="tabpanel" :aria-labelledby="`class-tab-${selectedOffset}`">
            <h3>{{ selectedClass.name }}</h3>
            <p class="adm-class-sub">當年 9 月 1 日前滿 {{ selectedClass.age }} 歲</p>
            <div class="adm-ranges">
              <div v-for="(r, i) in selectedClass.ranges" :key="i" class="adm-range">
                <small>{{ years[i] }} 學年度 · {{ i ? '下學年' : '本學年' }}</small>
                <strong>{{ r.roc }}</strong>
                <span>{{ r.ad }}</span>
              </div>
            </div>
            <p class="adm-class-note">學年度 8 月 1 日起算，出生區間為民國年，下方附西元。</p>
          </div>
        </div>
        <details class="adm-full-table">
          <summary><span class="adm-control-pill">看完整對照表<svg class="icon" aria-hidden="true" focusable="false"><use href="#i-plus" /></svg></span></summary>
          <div class="adm-table-wrap">
            <table>
              <caption>各班出生區間（民國年）</caption>
              <thead>
                <tr>
                  <th scope="col">班別</th>
                  <th scope="col">{{ years[0] }} 學年度<small>本學年</small></th>
                  <th scope="col">{{ years[1] }} 學年度<small>下學年</small></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in rows" :key="row.name">
                  <th scope="row">{{ row.name }}</th>
                  <td v-for="(r, i) in row.ranges" :key="i">{{ r.roc }}<small>{{ r.ad }}</small></td>
                </tr>
              </tbody>
            </table>
          </div>
        </details>
      </div>
    </section>

    <!-- 新生準備：首頁「孩子的一天」的深色舞台與拍立得 -->
    <section v-if="showNewcomer" id="newcomer" class="adm-newcomer" aria-labelledby="newcomer-title">
      <div class="adm-watermark" aria-hidden="true">新生入學二部曲</div>
      <div class="adm-wrap">
        <div class="adm-split-head">
          <div>
            <p class="adm-kicker"><span lang="en"><b>{{ chapterNo('newcomer') }}</b>First weeks</span></p>
            <h2 id="newcomer-title" class="adm-title">新生入學二部曲</h2>
          </div>
          <p>先適應、再註冊。正面勾一勾必備品，翻到背面看老師的叮嚀。</p>
        </div>

        <div v-if="admission.phases.length" class="adm-prints">
          <article v-for="(phase, p) in admission.phases" :key="p" class="adm-print" :class="{ flipped: flipped[p] }">
            <div class="adm-print-inner">
              <div class="adm-face adm-front" :inert="flipped[p] || undefined">
                <span class="adm-tape" aria-hidden="true" />
                <img v-bind="responsiveImage(PRINT_PHOTOS[p % PRINT_PHOTOS.length]!.name, '(max-width: 900px) 90vw, 40vw')" :alt="PRINT_PHOTOS[p % PRINT_PHOTOS.length]!.alt" loading="lazy">
                <p class="adm-print-meta"><span lang="en">{{ String(p + 1).padStart(2, '0') }}</span> / {{ phase.tag || '新生' }}</p>
                <h3>{{ phase.title }}</h3>
                <fieldset v-if="phase.items.length" class="adm-bring">
                  <legend>寶貝必備品</legend>
                  <label v-for="(item, i) in phase.items" :key="i">
                    <input type="checkbox">
                    <span class="adm-box" aria-hidden="true"><svg class="icon" focusable="false"><use href="#i-check" /></svg></span>
                    <span>{{ item }}</span>
                  </label>
                </fieldset>
                <button v-if="phase.tips.length" :ref="(el) => { flipButtons[`${p}-front`] = el as HTMLButtonElement | null }" class="adm-flip" type="button" @click="flip(p, true)">
                  翻面看 {{ phase.tips.length }} 則叮嚀<svg class="icon" aria-hidden="true" focusable="false"><use href="#i-arrow-counter-clockwise" /></svg>
                </button>
              </div>
              <div v-if="phase.tips.length" class="adm-face adm-back" :inert="!flipped[p] || undefined">
                <p class="adm-print-meta"><span lang="en">{{ String(p + 1).padStart(2, '0') }}</span> / {{ phase.tag || '新生' }} · 給爸爸媽媽</p>
                <h3>{{ phase.title }}</h3>
                <ol class="adm-tips">
                  <li v-for="(tip, i) in phase.tips" :key="i">{{ tip }}</li>
                </ol>
                <button :ref="(el) => { flipButtons[`${p}-back`] = el as HTMLButtonElement | null }" class="adm-flip" type="button" @click="flip(p, false)">
                  翻回正面<svg class="icon" aria-hidden="true" focusable="false"><use href="#i-arrow-counter-clockwise" /></svg>
                </button>
              </div>
            </div>
          </article>
        </div>

        <div v-if="hasNewcomerExtras" class="adm-daily">
          <div v-if="admission.uniformWeek.length" class="adm-daily-card adm-daily-week">
            <h3>每天穿什麼</h3>
            <p v-if="admission.uniformNote" class="adm-daily-sub">{{ admission.uniformNote }}</p>
            <ol class="adm-week" :style="{ '--day-count': admission.uniformWeek.length }">
              <li v-for="(d, i) in admission.uniformWeek" :key="i" :data-wear="d.wear">
                <small>{{ d.day }}</small>
                <strong>{{ d.wear }}</strong>
              </li>
            </ol>
          </div>
          <div v-if="admission.pickupNotes.length" class="adm-daily-card">
            <h3>接送安全</h3>
            <p v-for="(note, i) in admission.pickupNotes" :key="i">{{ note }}</p>
          </div>
          <div v-if="admission.registrationNotes.length" class="adm-daily-card">
            <h3>註冊須知</h3>
            <p v-for="(note, i) in admission.registrationNotes" :key="i">{{ note }}</p>
          </div>
        </div>
      </div>
    </section>

    <!-- 收退費辦法：首頁「最新消息」升起的紙張與彩色活動卡 -->
    <section id="fees" class="adm-sheet" aria-labelledby="fees-title">
      <div class="adm-sheet-wrap">
        <div class="adm-split-head">
          <div>
            <p class="adm-kicker"><span lang="en"><b>{{ chapterNo('fees') }}</b>Fees &amp; subsidies</span></p>
            <h2 id="fees-title" class="adm-title">補助與退費，<br>一次看清楚。</h2>
          </div>
          <p v-if="admission.feeIntro">{{ admission.feeIntro }}</p>
        </div>

        <div class="adm-fees-layout" :class="{ 'no-subsidy': !admission.subsidies.length }">
          <div v-if="admission.subsidies.length">
            <p class="adm-col-label" lang="en">SUBSIDY</p>
            <div class="adm-subsidies">
              <div v-for="(s, i) in admission.subsidies" :key="i" class="adm-subsidy">
                <span class="adm-subsidy-amt"><b>{{ s.amount }}</b><span>{{ s.unit }}</span></span>
                <span class="adm-subsidy-copy"><small>{{ s.by }}</small><strong>{{ s.who }}</strong></span>
              </div>
            </div>
          </div>
          <div>
            <div v-if="admission.allowance.length" class="adm-allowance">
              <div class="adm-allowance-title">
                <strong>{{ admission.allowanceTitle }}</strong>
                <small v-if="admission.allowanceNote">{{ admission.allowanceNote }}</small>
              </div>
              <dl>
                <div v-for="(a, i) in admission.allowance" :key="i">
                  <dt>{{ a.order }}</dt>
                  <dd>{{ a.amount }}<span>元／月</span></dd>
                </div>
              </dl>
            </div>
            <div v-if="admission.refunds.length" class="adm-refunds">
              <h3>退費規定</h3>
              <p>依情況點開查看。實際金額以園方開立的退費單據為準。</p>
              <div class="adm-refund-list">
                <details v-for="(r, i) in admission.refunds" :key="i" :open="i === 0">
                  <summary>
                    <span class="adm-refund-no" lang="en">{{ String(i + 1).padStart(2, '0') }}</span>
                    <span class="adm-refund-title">{{ r.title }}</span>
                    <span class="adm-plus" aria-hidden="true"><svg class="icon" focusable="false"><use href="#i-plus" /></svg></span>
                  </summary>
                  <div class="adm-refund-body">
                    <div v-for="(g, gi) in r.groups" :key="gi" class="adm-refund-group">
                      <h4 v-if="g.label">{{ g.label }}</h4>
                      <ul><li v-for="(line, li) in g.lines" :key="li">{{ line }}</li></ul>
                    </div>
                    <p v-if="r.note" class="adm-refund-note">{{ r.note }}</p>
                  </div>
                </details>
              </div>
            </div>
          </div>
        </div>

        <div class="adm-visit">
          <img v-bind="responsiveImage('about-together', '(max-width: 900px) 100vw, 45vw')" alt="園長和孩子們笑成一團" loading="lazy">
          <div class="adm-visit-copy">
            <p class="adm-kicker"><span lang="en">Book a visit</span></p>
            <h2 class="adm-title">先來走走看，<br>再決定也不遲。</h2>
            <p>名額、費用與入學時間，參觀時都可以直接問。</p>
            <NuxtLink class="adm-pill-button" to="/visit">預約校園參觀<svg class="icon" aria-hidden="true" focusable="false"><use href="#i-arrow-right" /></svg></NuxtLink>
          </div>
        </div>
      </div>
    </section>
  </main>
</template>

<style scoped src="../assets/css/admission.css"></style>
