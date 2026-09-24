<script setup lang="ts">
// 入學資訊 mock-up（2026-09-24）：內容移植自舊官網 ivykidschool.com「常春藤入學」四個分頁
//（寶貝入學流程／新生入園須知／收退費辦法／分班表），先寫死在頁面；定案後再決定是否搬進後台。
import { responsiveImage } from '~/utils/responsive-image'

const { data, error } = await usePublishedSite()
assertPublishedSite(error)

useHead(() => ({
  title: '入學資訊｜常春藤幼兒園',
  meta: [{ name: 'robots', content: 'noindex, nofollow' }]
}))

const sections = [
  { id: 'process', label: '入學流程' },
  { id: 'newcomer', label: '新生入園須知' },
  { id: 'fees', label: '收退費辦法' },
  { id: 'classes', label: '分班對照' }
]

const steps = [
  { when: '隨時', title: '預約參觀', text: '以電話或親友介紹，確認名額並預約參觀時間。' },
  { when: '約好的那天', title: '到園參觀', text: '學校安排專人，帶爸爸媽媽走一圈、聊聊孩子。' },
  { when: '決定之後', title: '保留名額', text: '預先繳交訂位金 5,000 元，即可確定保留名額。' },
  { when: '開學前約一個月', title: '新生報到', text: '通知報到日，領取代辦品，並繳交註冊費與代辦費。' },
  { when: '開學前約一週', title: '導師來電', text: '班導師以電話聯絡，了解寶貝需要特別留意的地方。' },
  { when: '開學日', title: '開心上學', text: '前三天以半天為主，讓寶貝慢慢熟悉新環境。' }
]

const phases = [
  {
    tag: '首部曲',
    title: '適應期（上學前三天）',
    items: ['餐具（碗、湯匙）', '抽取式面紙', '替換衣物'],
    tips: [
      '第一天報到時，老師會幫寶貝佩戴名牌，請記得每天配戴，加快師生之間的情感建立。',
      '上學第一天請早一點起床準備，不要急，以免寶貝感染到您的慌亂；也早一點到校，讓寶貝有充裕的時間接觸老師和小朋友。',
      '初期最好吃完早餐再入園，以免寶貝心情忐忑而食慾不佳。',
      '寶貝入園時情緒比較明顯的話，爸爸媽媽可以稍微陪伴，減低初入幼兒園的不安。',
      '可以跟寶貝說：「學校的老師是你的第二個媽咪，會用心呵護你喔！」讓寶貝與老師更貼近。'
    ]
  },
  {
    tag: '快樂曲',
    title: '註冊了（快樂來上學）',
    items: ['牙刷', '牙膏', '漱口杯', '棉被', '枕頭'],
    tips: [
      '新生入園第一天，學校會發回書包、餐袋（請清洗後再使用）、接送證 2 張、幼生名牌 1 張及註冊袋。',
      '請勿拿老師來嚇寶貝，以免寶貝覺得老師很兇，而害怕老師或不願上學。'
    ]
  }
]

const uniformWeek = [
  { day: '星期一', wear: '制服' },
  { day: '星期二', wear: '運動服' },
  { day: '星期三', wear: '便服' },
  { day: '星期四', wear: '制服' },
  { day: '星期五', wear: '運動服' }
]

const subsidies = [
  { amount: '15,000', unit: '元／學期', who: '大班學費', by: '教育部補助' },
  { amount: '5,000', unit: '元／學期', who: '中班、小班、幼幼班學費', by: '高雄市政府補助（符合資格者）' },
  { amount: '3,000', unit: '元／月', who: '2–5 歲特殊家庭', by: '中央或高雄市政府補助' }
]

const allowance = [
  { order: '第 1 胎', amount: '5,000' },
  { order: '第 2 胎', amount: '6,000' },
  { order: '第 3 胎以上', amount: '7,000' }
]

const refunds = [
  {
    q: '幼兒中途入園',
    groups: [
      { label: '學費及雜費', lines: ['未逾學期教保服務總日數 1/3 入園：全額收取', '逾 1/3、未逾 2/3 入園：收取 2/3', '逾 2/3 入園：收取 1/3'] },
      { label: '保險費', lines: ['依幼兒團體保險相關規定收取'] },
      { label: '其他代辦費', lines: ['按學期收費者：依就讀月數比例收取', '按月收費者：自入園當月收取，未滿一個月依就讀日數比例收取'] }
    ]
  },
  {
    q: '幼兒未入園或中途離園',
    groups: [
      { label: '學費及雜費', lines: ['學期教保服務起始日前未入園：全額退還', '未逾學期教保服務總日數 1/3 離園：退還 2/3', '逾 1/3、未逾 2/3 離園：退還 1/3', '逾 2/3 離園：不予退費'] },
      { label: '保險費', lines: ['依幼兒團體保險相關規定辦理退費'] },
      { label: '其他代辦費', lines: ['按學期收費者：依就讀月數比例退還', '按月收費者：依離園當月就讀日數比例退還', '已製成成品者發還成品，不予退費'] }
    ],
    note: '退費時會發給退費單據，列明退費項目及數額。'
  },
  {
    q: '事前請假，連續達五個上課日以上',
    groups: [
      { label: '退費項目', lines: ['按連續請假日數比例退還午餐費、點心費及交通費，其餘項目不予退費', '請假首日辦妥手續者，連續請假日數不含請假首日'] }
    ]
  },
  {
    q: '因法定傳染病等事由，強制停課連續達五個上課日以上',
    groups: [
      { label: '退費項目', lines: ['按停課日數比例退還午餐費、點心費及交通費，其餘項目不予退費'] }
    ]
  },
  {
    q: '國定假日及農曆春節，連續放假達五日以上',
    groups: [
      { label: '預先扣除', lines: ['除星期六、日及彈性放假日外，其餘放假期間的午餐費、點心費及交通費，按放假日數比例預先扣除，不另收取'] }
    ]
  }
]

// ── 分班對照 ──
// 規則（舊官網分班表）：民國 Y/9/2 ～ Y+1/9/1 出生，Y+3 學年度讀幼幼班，之後每年升一班，Y+7 學年度上小一。
const CLASS_BY_OFFSET: Record<number, string> = { 3: '幼幼班', 4: '小班', 5: '中班', 6: '大班', 7: '小一' }
const today = new Date()
const currentYear = today.getMonth() + 1 >= 8 ? today.getFullYear() - 1911 : today.getFullYear() - 1912

function cohortOf(date: Date) {
  const roc = date.getFullYear() - 1911
  const m = date.getMonth() + 1
  const d = date.getDate()
  return m > 9 || (m === 9 && d >= 2) ? roc : roc - 1
}

const classTable = [3, 4, 5, 6].map((offset) => ({
  name: CLASS_BY_OFFSET[offset],
  ranges: [currentYear, currentYear + 1].map((y) => {
    const start = y - offset
    return { roc: `${start}/9/2 – ${start + 1}/9/1`, ad: `${start + 1911}.9.2 – ${start + 1912}.9.1` }
  })
}))

const birthday = ref('')
const plan = computed(() => {
  if (!birthday.value) return null
  const date = new Date(`${birthday.value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return null
  const cohort = cohortOf(date)
  const rows = [3, 4, 5, 6, 7].map((offset) => ({
    year: cohort + offset,
    name: CLASS_BY_OFFSET[offset],
    current: cohort + offset === currentYear,
    past: cohort + offset < currentYear
  }))
  const now = rows.find((r) => r.current)
  let summary: string
  if (now) summary = `${currentYear} 學年度，寶貝就讀${now.name}。`
  else if (cohort + 3 > currentYear) summary = `寶貝 ${cohort + 3} 學年度（${cohort + 3 + 1911} 年 8 月起）可以開始讀幼幼班。`
  else summary = '寶貝已到國小年齡囉。'
  return { summary, rows }
})
</script>

<template>
  <div v-if="data">
    <SiteHeader :content="data.content" />
    <main id="main" tabindex="-1" class="admission">
      <div class="container breadcrumb"><NuxtLink to="/">首頁</NuxtLink> / 入學資訊</div>

      <section class="hero campus-hero admission-hero">
        <img class="hero-photo" v-bind="responsiveImage('day-hello')" alt="孩子早上到校，和老師打招呼" loading="eager" fetchpriority="high">
        <div class="hero-shade" />
        <div class="container">
          <span class="eyebrow">入學資訊 · Admission</span>
          <h1>從參觀到開學，<br>一步一步來。</h1>
          <p>入學流程、新生準備、收退費與分班，整理在同一頁。</p>
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

      <p class="container mockup-note"><span>頁面示意</span>內容取自舊官網，金額與日期請園方確認後再上線。</p>

      <!-- 入學流程 -->
      <section id="process" class="section">
        <div class="container">
          <div class="section-heading">
            <div>
              <span class="eyebrow">入學流程</span>
              <h2 class="section-title">六個步驟，<br>從參觀到開心上學。</h2>
            </div>
            <p>每一步都有老師陪著。不確定的地方，參觀時直接問我們。</p>
          </div>
          <ol class="steps">
            <li v-for="(step, i) in steps" :key="step.title">
              <span class="step-no">{{ String(i + 1).padStart(2, '0') }}</span>
              <small>{{ step.when }}</small>
              <h3>{{ step.title }}</h3>
              <p>{{ step.text }}</p>
            </li>
          </ol>
        </div>
      </section>

      <!-- 新生入園須知 -->
      <section id="newcomer" class="section campuses">
        <div class="container">
          <div class="section-heading">
            <div>
              <span class="eyebrow">新生入園須知</span>
              <h2 class="section-title">新生入學二部曲</h2>
            </div>
            <p>先適應、再註冊。每個階段要帶的東西，勾一勾就不會漏。</p>
          </div>

          <div class="phase-grid">
            <article v-for="phase in phases" :key="phase.tag" class="phase">
              <header>
                <span class="phase-tag">{{ phase.tag }}</span>
                <h3>{{ phase.title }}</h3>
              </header>
              <fieldset class="bring">
                <legend>寶貝必備品</legend>
                <label v-for="item in phase.items" :key="item">
                  <input type="checkbox">
                  <span>{{ item }}</span>
                </label>
              </fieldset>
              <ul class="tips">
                <li v-for="tip in phase.tips" :key="tip">{{ tip }}</li>
              </ul>
            </article>
          </div>

          <div class="newcomer-more">
            <div class="info-card">
              <h3>每天穿什麼</h3>
              <p class="info-sub">制服與運動服於註冊後發放。</p>
              <ol class="week">
                <li v-for="d in uniformWeek" :key="d.day" :data-wear="d.wear">
                  <small>{{ d.day }}</small>
                  <strong>{{ d.wear }}</strong>
                </li>
              </ol>
            </div>
            <div class="info-card">
              <h3>接送安全</h3>
              <p>接寶貝回家時，請出示幼兒接送證（使用一個月），以便識別。</p>
              <p>請他人代接時，請在受託人到園前 <strong>30 分鐘</strong>來電告知；確認身分並登記後，才會把寶貝交給對方。</p>
            </div>
            <div class="info-card">
              <h3>註冊須知</h3>
              <p>收費袋每月由園方發給寶貝，請於<strong>次月 5 日前</strong>由家長親自繳交並簽收，請勿讓寶貝單獨攜帶費用。</p>
              <p>收退費依教育局規定辦理，新學期收退費通知單於每學期結束前一個月公告。</p>
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
            <p>收退費依「高雄市教保服務機構收退費辦法」辦理。補助款皆待政府撥款到園後再轉發家長，開學後會協助辦理。</p>
          </div>

          <div class="subsidy-grid">
            <div v-for="s in subsidies" :key="s.who" class="subsidy">
              <small>{{ s.who }}</small>
              <strong>{{ s.amount }}<span>{{ s.unit }}</span></strong>
              <p>{{ s.by }}</p>
            </div>
            <div class="subsidy allowance">
              <small>私立幼兒園 2–6 歲育兒津貼</small>
              <dl>
                <div v-for="a in allowance" :key="a.order">
                  <dt>{{ a.order }}</dt>
                  <dd>{{ a.amount }}<span>元／月</span></dd>
                </div>
              </dl>
              <p>不含公立、準公共、非營利幼兒園</p>
            </div>
          </div>

          <div class="faq-grid refund-grid">
            <div>
              <h3 class="refund-title">退費規定</h3>
              <p class="section-copy">依情況點開查看。實際金額以園方開立的退費單據為準。</p>
            </div>
            <div class="faq-list refund-list">
              <details v-for="r in refunds" :key="r.q">
                <summary>{{ r.q }}</summary>
                <div class="refund-body">
                  <div v-for="g in r.groups" :key="g.label" class="refund-group">
                    <h4>{{ g.label }}</h4>
                    <ul><li v-for="line in g.lines" :key="line">{{ line }}</li></ul>
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
              <input id="birthday" v-model="birthday" type="date" min="2015-01-01" max="2030-12-31">
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
                    <th scope="col">{{ currentYear }} 學年度<small>本學年</small></th>
                    <th scope="col">{{ currentYear + 1 }} 學年度<small>招生中</small></th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="row in classTable" :key="row.name">
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
    <SiteFooter :content="data.content" />
  </div>
</template>

<style scoped src="../assets/css/admission.css"></style>
