<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  CRAWLER_GROUP_LABELS, CRAWLER_LABELS, crawlerPageLabel, getCrawlers, type CrawlerBot, type CrawlerSummary,
} from '../../api/analyticsMore'
import { useRequestSequence } from '../../composables/useRequestSequence'
import AnalyticsExplainer from './AnalyticsExplainer.vue'
import { analyticsCsvName, saveAnalyticsCsv } from './csvExport'
import { DEFAULT_ANALYTICS_DAYS, periodText, type AnalyticsDays } from './filters'

// 搜尋引擎與 AI 爬蟲抓了哪些頁（2026-11-20，docs/specs/2026-11-20-analytics-more-design.md §7）：看 GEO（被 AI 助理引用）
// 與 SEO 的能見度。官網伺服器看 User-Agent 記，自稱的、沒有反查，數字當參考。
const props = withDefaults(defineProps<{ days?: AnalyticsDays; active?: boolean }>(), { days: DEFAULT_ANALYTICS_DAYS, active: true })

const data = ref<CrawlerSummary | null>(null)
const loading = ref(false)
const failed = ref(false)
const requests = useRequestSequence()
let requestedDays = 0

async function load() {
  const request = requests.begin()
  requestedDays = props.days
  loading.value = true
  failed.value = false
  try {
    const result = await getCrawlers(props.days)
    if (requests.isCurrent(request)) data.value = result
  } catch {
    if (requests.isCurrent(request)) failed.value = true
  } finally {
    if (requests.isCurrent(request)) loading.value = false
  }
}

watch([() => props.active, () => props.days], () => {
  if (props.active && requestedDays !== props.days) void load()
}, { immediate: true })

const groups = computed(() => data.value?.groups ?? [])
const period = computed(() => (data.value ? periodText(data.value.since, data.value.until) : ''))
const aiHits = computed(() => groups.value.filter((group) => group.group.startsWith('ai_')).reduce((sum, group) => sum + group.hits, 0))
const aiUserHits = computed(() => groups.value.find((group) => group.group === 'ai_user')?.hits ?? 0)

function topPages(bot: CrawlerBot): string {
  return bot.pages.slice(0, 3).map((page) => `${crawlerPageLabel(page.page).replace(/（.*）$/, '')} ${page.hits}`).join('、')
}

function exportCsv() {
  saveAnalyticsCsv(analyticsCsvName('爬蟲', '全站', period.value), ['類別', '爬蟲', '次數', '其中錯誤（4xx／5xx）', '抓了哪些頁', '最後一次'],
    groups.value.flatMap((group) => group.bots.map((bot) => [
      CRAWLER_GROUP_LABELS[group.group].label, CRAWLER_LABELS[bot.bot] ?? bot.bot, bot.hits, bot.errors,
      bot.pages.map((page) => `${crawlerPageLabel(page.page)} ${page.hits}`).join('、'), bot.last_day,
    ])))
}
</script>

<template>
  <section class="panel crawlers" :class="{ 'is-empty': data && !groups.length, 'is-updating': loading && data }" aria-labelledby="crawlers-title" :aria-busy="loading">
    <div class="panel__head">
      <h2 id="crawlers-title">搜尋引擎與 AI 來抓了什麼</h2>
      <el-button v-if="groups.length" size="small" text data-test="crawlers-csv" aria-label="把「搜尋引擎與 AI 來抓了什麼」匯出 CSV" @click="exportCsv">匯出 CSV</el-button>
    </div>
    <div class="panel__body crawlers__body">
      <p v-if="failed" class="hint">讀不到爬蟲的紀錄。<el-button size="small" text @click="load">重新載入</el-button></p>
      <el-skeleton v-else-if="loading && !data" animated :rows="2" aria-label="正在讀取爬蟲的紀錄" />
      <p v-else-if="!groups.length" class="hint" data-test="crawlers-empty">這段期間還沒有記到爬蟲。</p>
      <template v-else>
        <p class="crawlers__lede" data-test="crawlers-lede">
          {{ period }}，爬蟲來抓官網 <strong class="num">{{ data!.hits }}</strong> 次，其中 AI 相關 <strong class="num">{{ aiHits }}</strong> 次<template v-if="aiUserHits">（有人在 AI 助理裡問到、它當下來讀的 <strong class="num">{{ aiUserHits }}</strong> 次）</template>。
        </p>
        <div class="crawlers__scroll" role="region" tabindex="0" aria-label="各爬蟲抓了什麼（可左右捲動）">
          <table class="crawlers__table" data-test="crawlers-table">
            <thead>
              <tr>
                <th scope="col">爬蟲</th>
                <th scope="col" class="num">次數</th>
                <th scope="col">最常抓的頁</th>
                <th scope="col" class="num">錯誤</th>
                <th scope="col" class="num">最後一次</th>
              </tr>
            </thead>
            <tbody v-for="group in groups" :key="group.group">
              <tr class="crawlers__group">
                <th scope="colgroup" colspan="5">
                  {{ CRAWLER_GROUP_LABELS[group.group].label }}<span class="num crawlers__group-hits">{{ group.hits }} 次</span>
                  <span class="hint crawlers__sub">{{ CRAWLER_GROUP_LABELS[group.group].hint }}</span>
                </th>
              </tr>
              <tr v-for="bot in group.bots" :key="bot.bot" :data-test="`crawler-${bot.bot}`">
                <th scope="row">{{ CRAWLER_LABELS[bot.bot] ?? bot.bot }}</th>
                <td class="num">{{ bot.hits }}</td>
                <td class="crawlers__pages">{{ topPages(bot) }}</td>
                <td class="num">{{ bot.errors || '' }}</td>
                <td class="num">{{ bot.last_day.slice(5).replace('-', '/') }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
      <AnalyticsExplainer>
        <p>官網伺服器看每個請求自稱的身分（User-Agent）認出是哪一家，每分鐘彙總一次；有人會冒充 Google，所以數字當參考。圖片、程式檔不算，只算網頁和 robots.txt、sitemap.xml、llms.txt 三個給爬蟲看的檔案。</p>
        <p>「AI 助理即時來讀」多，代表常有人在 ChatGPT、Claude、Perplexity 問到跟我們有關的問題；「AI 搜尋建索引」「搜尋引擎」是先把網頁收進去，之後才可能被引用或搜到。「錯誤」是抓到找不到的網址或伺服器錯誤，找不到的網址列在上面那張表。</p>
      </AnalyticsExplainer>
    </div>
  </section>
</template>

<style scoped>
.crawlers {
  margin-top: 20px;
  transition: opacity 180ms var(--ease-out);
}

.crawlers.is-updating {
  opacity: 0.6;
}

.crawlers__body {
  display: grid;
  gap: 12px;
}

.crawlers__body > .hint,
.crawlers__lede {
  margin: 0;
}

.crawlers__scroll {
  overflow-x: auto;
}

.crawlers__table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-sm);
}

.crawlers__table th,
.crawlers__table td {
  padding: 8px 10px;
  border-bottom: 1px solid var(--line);
  text-align: left;
  white-space: nowrap;
}

.crawlers__table tbody th {
  font-weight: 500;
}

.crawlers__group th {
  padding-top: 14px;
  background: var(--surface-2);
  font-weight: 600;
  white-space: normal;
}

.crawlers__group-hits {
  margin-left: 8px;
  font-weight: 400;
}

.crawlers__sub {
  display: block;
  font-size: var(--text-xs);
  font-weight: 400;
}

.crawlers__pages {
  white-space: normal !important;
  min-width: 14em;
}

.crawlers__table .num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
</style>
