<script setup lang="ts">
// 入學資訊頁主體（2026-09-24）：公開頁 pages/admission.vue 與草稿預覽 pages/preview.vue?page=admission 共用。
// 舊官網「常春藤入學」四個分頁移植而來；內容由後台 admission_content 管理，區塊大標固定在這裡
// （標題字型是子集，見 CLAUDE.md「字型子集」）。分班對照依生日規則計算，見 admission-classes.ts。
import { ADMISSION_HERO_IMAGE, responsiveImage } from '~/utils/responsive-image'
import { academicYear, classPlan, classTable, parseBirthday, taipeiYmd } from '~/utils/admission-classes'
import type { AdmissionContent } from '~/types/site-content'

const props = defineProps<{ admission: AdmissionContent }>()
const admission = computed(() => props.admission)

const currentYear = academicYear(taipeiYmd())
const years = [currentYear, currentYear + 1]
const rows = classTable(years)

const birthday = ref('')
const plan = computed(() => {
  const birth = parseBirthday(birthday.value)
  return birth ? classPlan(birth, currentYear) : null
})

const hasNewcomerExtras = computed(() => {
  const a = admission.value
  return a.uniformWeek.length > 0 || a.pickupNotes.length > 0 || a.registrationNotes.length > 0
})

const showNewcomer = computed(() => admission.value.phases.length > 0 || hasNewcomerExtras.value)

// 分頁列與區塊同一個條件：後台把新生須知全部清空時，連結也一起拿掉，不留點了沒反應的錨點。
const sections = computed(() => [
  { id: 'process', label: '入學流程' },
  ...(showNewcomer.value ? [{ id: 'newcomer', label: '新生入園須知' }] : []),
  { id: 'fees', label: '收退費辦法' },
  { id: 'classes', label: '分班對照' }
])
</script>

<template>
  <main id="main" tabindex="-1" class="admission">
    <div class="container breadcrumb"><NuxtLink to="/">首頁</NuxtLink> / 入學資訊</div>

    <section class="hero campus-hero admission-hero">
      <img class="hero-photo" v-bind="responsiveImage(ADMISSION_HERO_IMAGE)" alt="孩子早上到校，和老師打招呼" loading="eager" fetchpriority="high">
      <div class="hero-shade" />
      <div class="container">
        <span class="eyebrow">入學資訊 · Admission</span>
        <h1>從參觀到開學，<br>一步一步來。</h1>
        <p v-if="admission.intro">{{ admission.intro }}</p>
        <div class="hero-cta">
          <NuxtLink class="button yellow" to="/visit">預約參觀</NuxtLink>
          <a class="text-link" href="#classes">查寶貝讀哪一班</a>
        </div>
      </div>
    </section>

    <nav class="campus-subnav admission-subnav" aria-label="入學資訊分頁">
      <div class="container">
        <a v-for="s in sections" :key="s.id" :href="`#${s.id}`">{{ s.label }}</a>
      </div>
    </nav>

    <p v-if="admission.notice" class="container admission-notice">{{ admission.notice }}</p>

    <!-- 入學流程 -->
    <section id="process" class="section">
      <div class="container">
        <div class="section-heading">
          <div>
            <span class="eyebrow">入學流程</span>
            <h2 class="section-title">每一步，<br>都有人陪著你。</h2>
          </div>
          <p>不確定的地方，參觀時直接問我們。</p>
        </div>
        <ol class="steps" :style="{ '--step-count': Math.min(admission.steps.length, 6) }">
          <li v-for="(step, i) in admission.steps" :key="i">
            <span class="step-no">{{ String(i + 1).padStart(2, '0') }}</span>
            <small v-if="step.when">{{ step.when }}</small>
            <h3>{{ step.title }}</h3>
            <p v-if="step.text">{{ step.text }}</p>
          </li>
        </ol>
      </div>
    </section>

    <!-- 新生入園須知 -->
    <section v-if="showNewcomer" id="newcomer" class="section campuses">
      <div class="container">
        <div class="section-heading">
          <div>
            <span class="eyebrow">新生入園須知</span>
            <h2 class="section-title">新生入學二部曲</h2>
          </div>
          <p>先適應、再註冊。每個階段要帶的東西，勾一勾就不會漏。</p>
        </div>

        <div v-if="admission.phases.length" class="phase-grid">
          <article v-for="(phase, p) in admission.phases" :key="p" class="phase">
            <header>
              <span v-if="phase.tag" class="phase-tag">{{ phase.tag }}</span>
              <h3>{{ phase.title }}</h3>
            </header>
            <fieldset v-if="phase.items.length" class="bring">
              <legend>寶貝必備品</legend>
              <label v-for="(item, i) in phase.items" :key="i">
                <input type="checkbox">
                <span>{{ item }}</span>
              </label>
            </fieldset>
            <ul v-if="phase.tips.length" class="tips">
              <li v-for="(tip, i) in phase.tips" :key="i">{{ tip }}</li>
            </ul>
          </article>
        </div>

        <div v-if="hasNewcomerExtras" class="newcomer-more">
          <div v-if="admission.uniformWeek.length" class="info-card">
            <h3>每天穿什麼</h3>
            <p v-if="admission.uniformNote" class="info-sub">{{ admission.uniformNote }}</p>
            <ol class="week" :style="{ '--day-count': admission.uniformWeek.length }">
              <li v-for="(d, i) in admission.uniformWeek" :key="i" :data-wear="d.wear">
                <small>{{ d.day }}</small>
                <strong>{{ d.wear }}</strong>
              </li>
            </ol>
          </div>
          <div v-if="admission.pickupNotes.length" class="info-card">
            <h3>接送安全</h3>
            <p v-for="(note, i) in admission.pickupNotes" :key="i">{{ note }}</p>
          </div>
          <div v-if="admission.registrationNotes.length" class="info-card">
            <h3>註冊須知</h3>
            <p v-for="(note, i) in admission.registrationNotes" :key="i">{{ note }}</p>
          </div>
        </div>
      </div>
    </section>

    <!-- 收退費辦法 -->
    <section id="fees" class="section">
      <div class="container">
        <div class="section-heading">
          <div>
            <span class="eyebrow">收退費辦法</span>
            <h2 class="section-title">補助與退費，<br>一次看清楚。</h2>
          </div>
          <p v-if="admission.feeIntro">{{ admission.feeIntro }}</p>
        </div>

        <div v-if="admission.subsidies.length || admission.allowance.length" class="subsidy-grid">
          <div v-for="(s, i) in admission.subsidies" :key="i" class="subsidy">
            <small>{{ s.who }}</small>
            <strong>{{ s.amount }}<span>{{ s.unit }}</span></strong>
            <p>{{ s.by }}</p>
          </div>
          <div v-if="admission.allowance.length" class="subsidy allowance">
            <small>{{ admission.allowanceTitle }}</small>
            <dl>
              <div v-for="(a, i) in admission.allowance" :key="i">
                <dt>{{ a.order }}</dt>
                <dd>{{ a.amount }}<span>元／月</span></dd>
              </div>
            </dl>
            <p v-if="admission.allowanceNote">{{ admission.allowanceNote }}</p>
          </div>
        </div>

        <div v-if="admission.refunds.length" class="faq-grid refund-grid">
          <div>
            <h3 class="refund-title">退費規定</h3>
            <p class="section-copy">依情況點開查看。實際金額以園方開立的退費單據為準。</p>
          </div>
          <div class="faq-list refund-list">
            <details v-for="(r, i) in admission.refunds" :key="i">
              <summary>{{ r.title }}</summary>
              <div class="refund-body">
                <div v-for="(g, gi) in r.groups" :key="gi" class="refund-group">
                  <h4 v-if="g.label">{{ g.label }}</h4>
                  <ul><li v-for="(line, li) in g.lines" :key="li">{{ line }}</li></ul>
                </div>
                <p v-if="r.note" class="refund-note">{{ r.note }}</p>
              </div>
            </details>
          </div>
        </div>
      </div>
    </section>

    <!-- 分班對照 -->
    <section id="classes" class="section campuses">
      <div class="container">
        <div class="section-heading">
          <div>
            <span class="eyebrow">分班對照</span>
            <h2 class="section-title">寶貝何時入學？</h2>
          </div>
          <p>以 9 月 2 日到隔年 9 月 1 日出生為同一屆。輸入生日，直接看每一年讀哪一班。</p>
        </div>

        <div class="class-grid">
          <div class="class-finder">
            <label for="birthday">寶貝的生日</label>
            <input id="birthday" v-model="birthday" type="date" min="2015-01-01" max="2035-12-31">
            <div class="finder-result" aria-live="polite">
              <template v-if="plan">
                <p class="finder-summary">{{ plan.summary }}</p>
                <ol class="finder-years">
                  <li v-for="row in plan.rows" :key="row.year" :class="{ current: row.current, past: row.past }">
                    <span>{{ row.year }} 學年度</span>
                    <strong>{{ row.name }}</strong>
                  </li>
                </ol>
              </template>
              <p v-else class="finder-empty">選好日期，這裡會列出寶貝從幼幼班到小一的每一年。</p>
            </div>
          </div>

          <div class="class-table-wrap">
            <table class="class-table">
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
        </div>
      </div>
    </section>

    <section class="visit-banner">
      <div class="container">
        <div>
          <span class="eyebrow">預約參觀</span>
          <h2 class="section-title">先來走走看，再決定也不遲。</h2>
          <p>名額、費用與入學時間，參觀時都可以直接問。</p>
        </div>
        <NuxtLink class="button primary" to="/visit">預約校園參觀</NuxtLink>
      </div>
    </section>
  </main>
</template>

<style scoped src="../assets/css/admission.css"></style>
