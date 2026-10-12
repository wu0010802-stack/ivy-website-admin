<script setup lang="ts">
// 入學資訊頁主體：公開頁 pages/admission.vue 與草稿預覽 pages/preview.vue?page=admission 共用。
// 2026-09-28 改成「入學護照」（使用者從 design/admission-theme-directions-20260928/ 三個方向選 B），
// 跟其他分頁刻意不同：整頁是一本打開的護照，每走一步蓋一個章。防偽細紋（utils/guilloche.ts）只當紙張質感，
// 印章（components/PassportStamp.vue）是 aria-hidden 的裝飾，字都跟旁邊的內文重複；兩者都只在瀏覽器端出現，
// 沒有 JS 時版面與文字照常。蓋章動作用 GSAP（utils/admission-motion.ts，只有這頁動態載入），減少動態時直接在紙上。
// 同日裁定延續：這頁不放預約參觀（預約入口只留頁首金色鈕）；分班是成長軌道邏輯（生日 → 一句話答案 →
// 五格學年度欄位，寶貝那格蓋章 → 點格看出生區間），規則在 utils/admission-classes.ts；老師叮嚀不用翻面就看得到。
// 內容（步驟、須知、金額、退費）由後台 admission_content 管理；區塊大標、印章上的固定字寫在這裡。
import { admissionHeroImage, responsiveImage } from '~/utils/responsive-image'
import { academicYear, CLASS_BY_OFFSET, classPlan, classRanges, classTable, parseBirthday, taipeiYmd } from '~/utils/admission-classes'
import { bandPaths, rosettePaths, type RosetteKind } from '~/utils/guilloche'
import { splitStampText } from '~/utils/passport-stamp'
import { createAdmissionMotion, observeStamps, type AdmissionMotion } from '~/utils/admission-motion'
import { ADMISSION_FONT_PRELOAD, attachAdmissionFontStylesheet } from '~/utils/admission-fonts'
import type { AdmissionContent } from '~/types/site-content'

const props = defineProps<{ admission: AdmissionContent }>()
const admission = computed(() => props.admission)
const hero = admissionHeroImage()
const pad2 = (n: number) => String(n).padStart(2, '0')

// ---------- 目錄：章節＝護照內頁（第 2 頁起） ----------
const hasNewcomerExtras = computed(() => {
  const a = admission.value
  return a.uniformWeek.length > 0 || a.pickupNotes.length > 0 || a.registrationNotes.length > 0
})
const showNewcomer = computed(() => admission.value.phases.length > 0 || hasNewcomerExtras.value)
// 目錄與章節同一個條件：後台把新生須知全部清空時，目錄也一起拿掉，不留點了沒反應的錨點。
const chapters = computed(() => [
  { id: 'process', label: '入學流程', hint: `${admission.value.steps.length} 個步驟` },
  { id: 'classes', label: '分班對照', hint: '輸入生日查班別' },
  ...(showNewcomer.value ? [{ id: 'newcomer', label: '新生準備', hint: '必備品與叮嚀' }] : []),
  { id: 'fees', label: '收退費辦法', hint: '補助與退費規定' }
].map((chapter, i) => ({ ...chapter, no: pad2(i + 1), page: i + 2 })))
const chapterOf = (id: string) => chapters.value.find((chapter) => chapter.id === id)

// ---------- 02 分班對照：資料頁（成長軌道） ----------
const currentYear = academicYear(taipeiYmd())
const years = [currentYear, currentYear + 1]
const rows = classTable(years)
// 五格＝幼幼班（offset 3）到小一（offset 7）；age 是當年 9/1 前滿幾歲；順序與 classPlan().rows 相同。
const stations = [3, 4, 5, 6, 7].map((offset) => ({ offset, name: CLASS_BY_OFFSET[offset]!, age: offset - 1, ranges: classRanges(offset, years) }))
const birthday = ref('')
const plan = computed(() => {
  const birth = parseBirthday(birthday.value)
  return birth ? classPlan(birth, currentYear) : null
})
const selected = ref(0)
watch(plan, (value) => { if (value) selected.value = value.position })
const selectedStation = computed(() => stations[selected.value]!)
/** 出生區間（offset 班、year 學年度）是不是寶貝那一屆。 */
const isMine = (offset: number, year: number) => plan.value?.cohort === year - offset
function slotState(i: number) {
  const row = plan.value?.rows[i]
  return !row ? undefined : row.current ? 'current' : row.past ? 'past' : 'future'
}
function slotLabel(i: number) {
  const station = stations[i]!
  const p = plan.value
  return p ? `${station.name}，寶貝 ${p.rows[i]!.year} 學年度${p.position === i ? '（今年在這一格）' : ''}` : `${station.name}，${station.age} 歲`
}
// 大章：同一個答案不重蓋；換答案時舊章拿起、新章蓋下（key 換了，Transition 各自跑 leave／enter）。
// 「蓋章＝核准」的誤會：章上寫「分班對照」「預計入學」，不寫「核定」「錄取」。
const resultStamp = computed(() => {
  const p = plan.value
  if (!p) return null
  if (p.status === 'enrolled') return { key: `e-${p.cohort}`, ring: '常春藤幼兒園・分班對照', lines: [`${currentYear} 學年度`, p.rows[p.position]!.name], mode: 'label' as const, tone: 'red' as const }
  if (p.status === 'young') return { key: `y-${p.cohort}`, ring: '常春藤幼兒園・預計入學', lines: [`${p.cohort + 3} 學年度`, '幼幼班'], mode: 'label' as const, tone: 'red' as const }
  return { key: 's', ring: '常春藤幼兒園・分班對照', lines: ['已到', '國小年齡'], mode: 'pair' as const, tone: 'green' as const }
})
const babyTone = computed(() => (plan.value?.status === 'young' ? 'red' : 'green'))

// ---------- 03 新生準備 ----------
const PHASE_PHOTOS = [
  { name: 'day-lunch', alt: '孩子自己拿湯匙吃點心' },
  { name: 'day-home', alt: '孩子在教室專心看繪本' }
]
/** 必備品勾選（不存）：勾起來那一行蓋「已備」小方章，取消就拿起。 */
const checked = ref<Record<string, boolean>>({})
/** 每天穿什麼：制服綠章、運動服紅章、便服虛線框；後台新增的其他穿著用綠章。 */
const WEAR_TONE: Record<string, 'green' | 'red' | 'outline'> = { 制服: 'green', 運動服: 'red', 便服: 'outline' }
const wearTone = (wear: string) => WEAR_TONE[wear] ?? 'green'

// ---------- 印章：瀏覽器端才出現 ----------
const root = ref<HTMLElement | null>(null)
let motion: AdmissionMotion | null = null
const stampsOn = ref(false)
const visaStamped = ref<boolean[]>([])
const visaDelay = ref<number[]>([])
const welcome = ref(false)
/** 簽證章：單數格朱紅方章，雙數格深綠圓章（環狀字），最後一步顏色反過來收尾。 */
const VISA_ROT = [-7, 5, -3, 6, -5, 3]
function visaStamp(i: number) {
  const last = i === admission.value.steps.length - 1
  const title = admission.value.steps[i]!.title
  return i % 2 === 0
    ? { kind: 'square' as const, text: title, tone: last ? 'green' as const : 'red' as const, size: 92 }
    : { kind: 'round' as const, ring: `常春藤入學・第 ${i + 1} 步`, lines: splitStampText(title), mode: 'pair' as const, tone: last ? 'red' as const : 'green' as const, size: 112 }
}
function onPress(el: Element, done: () => void) {
  if (!motion) return done()
  motion.press(el, done, Number((el as HTMLElement).dataset.delay || 0))
}
function onLift(el: Element, done: () => void) {
  if (!motion) return done()
  motion.lift(el, done)
}

// ---------- 防偽細紋：瀏覽器端依容器寬度算 ----------
const bands = ref<Record<string, { width: number; paths: string[] }>>({})
const rosettes = ref<Record<string, { size: number; paths: string[] }>>({})
function drawGuilloche() {
  if (!root.value) return
  const nextBands: Record<string, { width: number; paths: string[] }> = {}
  root.value.querySelectorAll<HTMLElement>('[data-band]').forEach((host) => {
    const width = Math.ceil(host.clientWidth)
    nextBands[host.dataset.band!] = { width, paths: bandPaths(width) }
  })
  const nextRosettes: Record<string, { size: number; paths: string[] }> = {}
  root.value.querySelectorAll<HTMLElement>('[data-rosette]').forEach((host) => {
    const size = Math.round(Math.min(Math.max(host.clientWidth, 200), 760))
    nextRosettes[host.dataset.key!] = { size, paths: rosettePaths(host.dataset.rosette as RosetteKind, size) }
  })
  bands.value = nextBands
  rosettes.value = nextRosettes
}

useHead({ link: ADMISSION_FONT_PRELOAD.map((href) => ({ rel: 'preload', as: 'font', type: 'font/woff2', href, crossorigin: '' })) })

let disposed = false
let stopObserving: (() => void) | undefined
let welcomeTimer: number | undefined
let resizeTimer: number | undefined
function onResize() {
  window.clearTimeout(resizeTimer)
  resizeTimer = window.setTimeout(drawGuilloche, 150)
}
onMounted(async () => {
  attachAdmissionFontStylesheet(document)
  drawGuilloche()
  window.addEventListener('resize', onResize)
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches
  // gsap 只在這頁動態載入；載入失敗就不做動作，印章直接出現
  const loaded = reducedMotion ? null : await import('gsap').then(({ gsap }) => createAdmissionMotion(gsap)).catch(() => null)
  if (disposed) { loaded?.destroy(); return }
  motion = loaded
  stampsOn.value = true
  if (!motion || !('IntersectionObserver' in window)) {
    visaStamped.value = admission.value.steps.map(() => true)
    welcome.value = true
    return
  }
  await nextTick()
  const hosts = Array.from(root.value?.querySelectorAll('.ap-visa-stamp') ?? [])
  stopObserving = observeStamps(hosts, (index, delay) => {
    visaDelay.value[index] = delay
    visaStamped.value[index] = true
  })
  welcomeTimer = window.setTimeout(() => { welcome.value = true }, 450)
})
onBeforeUnmount(() => {
  disposed = true
  stopObserving?.()
  window.clearTimeout(welcomeTimer)
  window.clearTimeout(resizeTimer)
  window.removeEventListener('resize', onResize)
  motion?.destroy()
})
</script>

<template>
  <main id="main" ref="root" tabindex="-1" class="ap" data-cta-entry="admission">
    <!-- 印泥質感：邊緣微抖（displacement）＋少量沒吃到墨的斑點（noise 遮罩）。所有印章共用。 -->
    <svg class="ap-defs" width="0" height="0" aria-hidden="true" focusable="false">
      <defs>
        <filter id="ap-ink" x="-8%" y="-8%" width="116%" height="116%" color-interpolation-filters="sRGB">
          <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="4" result="grain" />
          <feDisplacementMap in="SourceGraphic" in2="grain" scale="2.2" xChannelSelector="R" yChannelSelector="G" result="rough" />
          <feTurbulence type="fractalNoise" baseFrequency="0.32" numOctaves="3" seed="11" result="spots" />
          <feColorMatrix in="spots" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  -6 0 0 0 4.4" result="mask" />
          <feComposite in="rough" in2="mask" operator="in" />
        </filter>
        <filter id="ap-bleed" x="-10%" y="-10%" width="120%" height="120%">
          <feGaussianBlur stdDeviation="1.6" />
        </filter>
      </defs>
    </svg>

    <!-- 第 1 頁：打開的護照跨頁。左頁照片、右頁標題；外框的深綠是封面。 -->
    <section class="ap-hero" aria-labelledby="admission-title">
      <div class="ap-passport">
        <div class="ap-spread">
          <div class="ap-page ap-page-photo">
            <div class="ap-runhead"><span>常春藤入學護照</span><span>第 1 頁</span></div>
            <figure class="ap-photo">
              <div class="ap-photo-frame">
                <img v-bind="hero" alt="孩子早上到校，和老師打招呼" loading="eager" fetchpriority="high">
              </div>
              <figcaption>早上到校，先跟老師說早安。</figcaption>
              <div class="ap-stamp-host ap-welcome">
                <Transition :css="false" @enter="onPress" @leave="onLift">
                  <PassportStamp v-if="welcome" kind="round" ring="常春藤幼兒園・入學護照" :lines="['歡迎', '入學']" mode="pair" tone="green" :size="128" :rot="-12" />
                </Transition>
              </div>
            </figure>
          </div>
          <div class="ap-page ap-page-title">
            <div class="ap-rosette-host" data-rosette="hero" data-key="hero" aria-hidden="true">
              <svg v-if="rosettes.hero" class="ap-rosette" :viewBox="`0 0 ${rosettes.hero.size} ${rosettes.hero.size}`" focusable="false"><path v-for="(d, i) in rosettes.hero.paths" :key="i" :d="d" /></svg>
            </div>
            <div class="ap-runhead"><span>持照人：寶貝與爸爸媽媽</span><span>第 1 頁</span></div>
            <p class="ap-eyebrow">常春藤幼兒園・入學資訊</p>
            <h1 id="admission-title">從參觀到開學，<br>一步一步來。</h1>
            <p v-if="admission.intro" class="ap-lede">{{ admission.intro }}</p>
            <a class="ap-action" href="#classes">查寶貝讀哪一班<svg class="icon" aria-hidden="true" focusable="false"><use href="#i-arrow-down" /></svg></a>
            <p v-if="admission.notice" class="ap-notice">{{ admission.notice }}</p>
          </div>
        </div>
        <p class="ap-cover-mark" aria-hidden="true">常春藤入學護照</p>
      </div>

      <nav class="ap-toc" aria-labelledby="ap-toc-title">
        <p id="ap-toc-title" class="ap-toc-title">目錄</p>
        <ol>
          <li v-for="chapter in chapters" :key="chapter.id">
            <a :href="`#${chapter.id}`">
              <span class="ap-toc-head"><span class="ap-toc-no" lang="en">{{ chapter.no }}</span><b>{{ chapter.label }}</b></span>
              <span class="ap-toc-hint">{{ chapter.hint }}</span>
              <span class="ap-leader" aria-hidden="true" />
              <span class="ap-toc-page">第 {{ chapter.page }} 頁</span>
            </a>
          </li>
        </ol>
      </nav>
    </section>

    <!-- 第 2 頁：簽證欄。每格捲進視窗時依序蓋一個章，每格只蓋一次。 -->
    <section id="process" class="ap-section ap-tint-page" aria-labelledby="process-title">
      <div class="ap-band-host" data-band="process" aria-hidden="true">
        <svg v-if="bands.process" class="ap-band" :viewBox="`0 0 ${bands.process.width} 24`" :width="bands.process.width" height="24" focusable="false"><path v-for="(d, i) in bands.process.paths" :key="i" :d="d" /></svg>
      </div>
      <div class="ap-wrap">
        <div class="ap-runhead"><span>{{ chapterOf('process')?.no }}・入學流程</span><span>第 {{ chapterOf('process')?.page }} 頁</span></div>
        <div class="ap-head">
          <h2 id="process-title">每走一步，<br>就蓋一個章。</h2>
          <p>每一步都有老師陪著確認，不確定的地方，參觀時直接問我們。</p>
        </div>
        <ol class="ap-visas">
          <li v-for="(step, i) in admission.steps" :key="i" class="ap-visa">
            <div class="ap-visa-head"><span class="ap-visa-no">第 {{ i + 1 }} 格</span><span v-if="step.when" class="ap-visa-when">{{ step.when }}</span></div>
            <h3>{{ step.title }}</h3>
            <p v-if="step.text">{{ step.text }}</p>
            <div class="ap-stamp-host ap-visa-stamp">
              <Transition :css="false" @enter="onPress" @leave="onLift">
                <PassportStamp v-if="stampsOn && visaStamped[i]" v-bind="visaStamp(i)" :rot="VISA_ROT[i % VISA_ROT.length]" :data-delay="visaDelay[i] ?? 0" />
              </Transition>
            </div>
          </li>
        </ol>
      </div>
    </section>

    <!-- 第 3 頁：資料頁。輸入生日，大章蓋下去；五格學年度欄位＝成長軌道。 -->
    <section id="classes" class="ap-section ap-tint-alt" aria-labelledby="classes-title">
      <div class="ap-band-host" data-band="classes" aria-hidden="true">
        <svg v-if="bands.classes" class="ap-band" :viewBox="`0 0 ${bands.classes.width} 24`" :width="bands.classes.width" height="24" focusable="false"><path v-for="(d, i) in bands.classes.paths" :key="i" :d="d" /></svg>
      </div>
      <div class="ap-wrap">
        <div class="ap-runhead"><span>{{ chapterOf('classes')?.no }}・分班對照</span><span>第 {{ chapterOf('classes')?.page }} 頁</span></div>
        <div class="ap-head">
          <h2 id="classes-title">寶貝何時入學？</h2>
          <p>輸入寶貝生日，直接看每一學年讀哪一班。9 月 2 日到隔年 9 月 1 日出生為同一屆。</p>
        </div>
        <div class="ap-datapage">
          <div class="ap-rosette-host" data-rosette="data" data-key="data" aria-hidden="true">
            <svg v-if="rosettes.data" class="ap-rosette" :viewBox="`0 0 ${rosettes.data.size} ${rosettes.data.size}`" focusable="false"><path v-for="(d, i) in rosettes.data.paths" :key="i" :d="d" /></svg>
          </div>
          <div class="ap-fields">
            <div class="ap-field">
              <label for="birthday">寶貝的生日</label>
              <input id="birthday" v-model="birthday" type="date" min="2015-01-01" max="2035-12-31">
            </div>
            <div class="ap-field ap-field-static">
              <span class="ap-label">今年學年度</span>
              <strong>{{ currentYear }} 學年度</strong>
              <small>{{ currentYear + 1911 }} 年 8 月起至隔年 7 月</small>
            </div>
            <div class="ap-answer" :class="{ empty: !plan }" aria-live="polite">
              <template v-if="plan">
                <p class="ap-answer-lead">
                  <template v-if="plan.status === 'enrolled'">{{ currentYear }} 學年度，寶貝讀<em>{{ plan.rows[plan.position]!.name }}</em>。</template>
                  <template v-else-if="plan.status === 'young'">寶貝 <em>{{ plan.cohort + 3 }} 學年度</em><span class="ap-nowrap">可以開始讀幼幼班。</span></template>
                  <template v-else>寶貝已到國小年齡囉。</template>
                </p>
                <ul v-if="plan.next.length" class="ap-answer-next">
                  <li v-for="line in plan.next" :key="line">{{ line }}</li>
                </ul>
              </template>
              <p v-else class="ap-answer-lead">輸入生日，下面會標出寶貝每一年讀哪一班。</p>
            </div>
          </div>
          <div class="ap-stampzone" :class="{ stamped: !!resultStamp }" aria-hidden="true">
            <div class="ap-stamp-host ap-result">
              <Transition :css="false" @enter="onPress" @leave="onLift">
                <PassportStamp v-if="stampsOn && resultStamp" :key="resultStamp.key" kind="round" :ring="resultStamp.ring" :lines="resultStamp.lines" :mode="resultStamp.mode" :tone="resultStamp.tone" :size="230" :rot="-9" data-delay="0.08" />
              </Transition>
            </div>
            <p class="ap-stamp-hint">輸入生日後<br>在這裡蓋章</p>
          </div>
          <ol class="ap-slots" :class="{ empty: !plan }" aria-label="班別">
            <li v-for="(station, i) in stations" :key="station.offset" class="ap-slot" :data-state="slotState(i)">
              <button type="button" :aria-pressed="selected === i" aria-controls="ap-detail" :aria-label="slotLabel(i)" @click="selected = i">
                <span class="ap-slot-no" aria-hidden="true">{{ pad2(i + 1) }}</span>
                <span class="ap-slot-class">{{ station.name }}</span>
                <span class="ap-slot-age">{{ station.age }} 歲</span>
                <span class="ap-slot-year"><b>{{ plan ? plan.rows[i]!.year : '' }}</b><small>學年度</small></span>
                <span class="ap-stamp-host ap-slot-mark">
                  <Transition :css="false" @enter="onPress" @leave="onLift">
                    <PassportStamp v-if="stampsOn && plan && plan.position === i" :key="babyTone" kind="round" :lines="['寶貝']" :tone="babyTone" :size="58" :rot="-10" data-delay="0.34" />
                  </Transition>
                </span>
              </button>
            </li>
          </ol>
          <div id="ap-detail" class="ap-detail">
            <div class="ap-detail-head">
              <h3>{{ selectedStation.name }}</h3>
              <p>{{ selectedStation.offset === 7 ? '國小一年級・' : '' }}當年 9 月 1 日前滿 {{ selectedStation.age }} 歲的孩子</p>
            </div>
            <div class="ap-ranges">
              <div v-for="(range, i) in selectedStation.ranges" :key="i" class="ap-range" :class="{ mine: isMine(selectedStation.offset, years[i]!) }">
                <span class="ap-label">{{ years[i] }} 學年度・{{ i ? '下學年' : '本學年' }}</span>
                <strong>{{ range.roc }}</strong>
                <small>{{ range.ad }}</small>
                <span v-if="isMine(selectedStation.offset, years[i]!)" class="ap-range-mark">
                  <span class="ap-sr">寶貝的生日在這個區間</span>
                  <Transition :css="false" appear @enter="onPress" @leave="onLift">
                    <PassportStamp v-if="stampsOn" kind="oval" text="寶貝的生日在這" tone="green" :width="150" :height="44" :rot="-3" />
                  </Transition>
                </span>
              </div>
            </div>
            <p class="ap-detail-note">學年度 8 月 1 日起算；出生區間為民國年，下方附西元。</p>
          </div>
        </div>
        <details class="ap-table">
          <summary><span class="ap-pill">看完整對照表<svg class="icon" aria-hidden="true" focusable="false"><use href="#i-plus" /></svg></span></summary>
          <div class="ap-table-wrap">
            <table>
              <caption>各班出生區間（民國年，下方為西元）</caption>
              <thead>
                <tr>
                  <th scope="col">班別</th>
                  <th v-for="(year, i) in years" :key="year" scope="col">{{ year }} 學年度<small>{{ i ? '下學年' : '本學年' }}</small></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(row, j) in rows" :key="row.name">
                  <th scope="row">{{ row.name }}<small>{{ j + 2 }} 歲</small></th>
                  <td v-for="(range, i) in row.ranges" :key="i" :class="{ mine: isMine(j + 3, years[i]!) }"><span class="ap-cell">{{ range.roc }}<small>{{ range.ad }}</small></span></td>
                </tr>
              </tbody>
            </table>
          </div>
        </details>
      </div>
    </section>

    <!-- 第 4 頁：新生準備。勾必備品時在那一行蓋「已備」小章；叮嚀直接看得到。 -->
    <section v-if="showNewcomer" id="newcomer" class="ap-section ap-tint-page" aria-labelledby="newcomer-title">
      <div class="ap-band-host" data-band="newcomer" aria-hidden="true">
        <svg v-if="bands.newcomer" class="ap-band" :viewBox="`0 0 ${bands.newcomer.width} 24`" :width="bands.newcomer.width" height="24" focusable="false"><path v-for="(d, i) in bands.newcomer.paths" :key="i" :d="d" /></svg>
      </div>
      <div class="ap-wrap">
        <div class="ap-runhead"><span>{{ chapterOf('newcomer')?.no }}・新生準備</span><span>第 {{ chapterOf('newcomer')?.page }} 頁</span></div>
        <div class="ap-head">
          <h2 id="newcomer-title">新生入學二部曲</h2>
          <p>先適應、再註冊。勾一勾必備品，老師的叮嚀直接往下看。</p>
        </div>
        <div v-if="admission.phases.length" class="ap-phases">
          <article v-for="(phase, p) in admission.phases" :key="p" class="ap-phase">
            <header class="ap-phase-head">
              <img v-bind="responsiveImage(PHASE_PHOTOS[p % PHASE_PHOTOS.length]!.name, '(max-width: 760px) 96px, 132px')" :alt="PHASE_PHOTOS[p % PHASE_PHOTOS.length]!.alt" loading="lazy">
              <div>
                <p class="ap-phase-tag"><span lang="en">{{ pad2(p + 1) }}</span>{{ phase.tag || '新生' }}</p>
                <h3>{{ phase.title }}</h3>
              </div>
            </header>
            <fieldset v-if="phase.items.length" class="ap-bring">
              <legend>寶貝必備品</legend>
              <label v-for="(item, i) in phase.items" :key="i">
                <input v-model="checked[`${p}-${i}`]" type="checkbox">
                <span class="ap-box" aria-hidden="true" />
                <span class="ap-item">{{ item }}</span>
                <span class="ap-stamp-host ap-done">
                  <Transition :css="false" @enter="onPress" @leave="onLift">
                    <PassportStamp v-if="checked[`${p}-${i}`]" kind="square" text="已備" tone="red" :size="46" :rot="-8 + ((p * 3 + i) % 4) * 2" />
                  </Transition>
                </span>
              </label>
            </fieldset>
            <template v-if="phase.tips.length">
              <h4>老師的叮嚀</h4>
              <ol class="ap-tips">
                <li v-for="(tip, i) in phase.tips" :key="i"><span class="ap-tip-no" aria-hidden="true">{{ i + 1 }}</span>{{ tip }}</li>
              </ol>
            </template>
          </article>
        </div>
        <div v-if="admission.uniformWeek.length" class="ap-week">
          <div class="ap-week-head">
            <h3>每天穿什麼</h3>
            <p v-if="admission.uniformNote">{{ admission.uniformNote }}</p>
          </div>
          <ol class="ap-days" :style="{ '--day-count': admission.uniformWeek.length }">
            <li v-for="(day, i) in admission.uniformWeek" :key="i">
              <span class="ap-day">{{ day.day }}</span>
              <span class="ap-wear">
                <PassportStamp kind="oval" :text="day.wear" :tone="wearTone(day.wear) === 'red' ? 'red' : 'green'" :outline="wearTone(day.wear) === 'outline'" :width="104" :height="50" :rot="-4" />
                <span class="ap-sr">{{ day.wear }}</span>
              </span>
            </li>
          </ol>
        </div>
        <div v-if="admission.pickupNotes.length || admission.registrationNotes.length" class="ap-notices">
          <article v-if="admission.pickupNotes.length" class="ap-notice-page">
            <h3>接送安全</h3>
            <ol class="ap-clauses">
              <li v-for="(note, i) in admission.pickupNotes" :key="i"><span class="ap-clause-mark">第 {{ i + 1 }} 點</span><span>{{ note }}</span></li>
            </ol>
          </article>
          <article v-if="admission.registrationNotes.length" class="ap-notice-page">
            <h3>註冊須知</h3>
            <ol class="ap-clauses">
              <li v-for="(note, i) in admission.registrationNotes" :key="i"><span class="ap-clause-mark">第 {{ i + 1 }} 點</span><span>{{ note }}</span></li>
            </ol>
          </article>
        </div>
      </div>
    </section>

    <!-- 第 5 頁：收退費。補助做成有撕線的補助券；退費規定是編號條款。 -->
    <section id="fees" class="ap-section ap-tint-alt" aria-labelledby="fees-title">
      <div class="ap-band-host" data-band="fees" aria-hidden="true">
        <svg v-if="bands.fees" class="ap-band" :viewBox="`0 0 ${bands.fees.width} 24`" :width="bands.fees.width" height="24" focusable="false"><path v-for="(d, i) in bands.fees.paths" :key="i" :d="d" /></svg>
      </div>
      <div class="ap-wrap">
        <div class="ap-runhead"><span>{{ chapterOf('fees')?.no }}・收退費辦法</span><span>第 {{ chapterOf('fees')?.page }} 頁</span></div>
        <div class="ap-head">
          <h2 id="fees-title">補助與退費，<br>一次看清楚。</h2>
          <p v-if="admission.feeIntro">{{ admission.feeIntro }}</p>
        </div>
        <template v-if="admission.subsidies.length">
          <h3 class="ap-sub">政府補助</h3>
          <ul class="ap-coupons">
            <li v-for="(subsidy, i) in admission.subsidies" :key="i" class="ap-coupon">
              <div class="ap-coupon-main">
                <div class="ap-rosette-host ap-coupon-rosette" data-rosette="coupon" :data-key="`coupon-${i}`" aria-hidden="true">
                  <svg v-if="rosettes[`coupon-${i}`]" class="ap-rosette" :viewBox="`0 0 ${rosettes[`coupon-${i}`]!.size} ${rosettes[`coupon-${i}`]!.size}`" focusable="false"><path v-for="(d, k) in rosettes[`coupon-${i}`]!.paths" :key="k" :d="d" /></svg>
                </div>
                <p class="ap-coupon-by">{{ subsidy.by }}</p>
                <p class="ap-coupon-amt"><b>{{ subsidy.amount }}</b><span>{{ subsidy.unit }}</span></p>
                <p class="ap-coupon-who">{{ subsidy.who }}</p>
              </div>
              <div class="ap-coupon-stub" aria-hidden="true"><span>補助券</span><small>第 {{ pad2(i + 1) }} 張</small></div>
            </li>
          </ul>
        </template>
        <div class="ap-fees-grid" :class="{ 'no-allowance': !admission.allowance.length }">
          <table v-if="admission.allowance.length" class="ap-rate">
            <caption><b>{{ admission.allowanceTitle }}</b><small v-if="admission.allowanceNote">{{ admission.allowanceNote }}</small></caption>
            <thead><tr><th scope="col">胎次</th><th scope="col">每月</th></tr></thead>
            <tbody>
              <tr v-for="(row, i) in admission.allowance" :key="i"><th scope="row">{{ row.order }}</th><td><b>{{ row.amount }}</b> 元</td></tr>
            </tbody>
          </table>
          <div v-if="admission.refunds.length" class="ap-refunds">
            <h3>退費規定</h3>
            <p>依情況點開查看。實際金額以園方開立的退費單據為準。</p>
            <ol>
              <li v-for="(refund, i) in admission.refunds" :key="i">
                <details :open="i === 0">
                  <summary>
                    <span class="ap-clause-no">第 {{ i + 1 }} 條</span>
                    <span class="ap-clause-title">{{ refund.title }}</span>
                    <svg class="icon" aria-hidden="true" focusable="false"><use href="#i-plus" /></svg>
                  </summary>
                  <div class="ap-clause-body">
                    <div v-for="(group, g) in refund.groups" :key="g">
                      <h4 v-if="group.label">{{ group.label }}</h4>
                      <ul><li v-for="(line, l) in group.lines" :key="l">{{ line }}</li></ul>
                    </div>
                    <p v-if="refund.note" class="ap-clause-note">{{ refund.note }}</p>
                  </div>
                </details>
              </li>
            </ol>
          </div>
        </div>
      </div>
    </section>
  </main>
</template>

<style src="../assets/css/admission-fonts.css"></style>
<style src="../assets/css/admission-passport.css"></style>
