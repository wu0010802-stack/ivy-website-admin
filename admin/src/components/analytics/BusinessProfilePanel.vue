<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  gbpHasData, gbpKeywordValue, gbpMapsImpressions, gbpMobileShare, gbpMonthLabel, gbpSearchImpressions, getBusinessProfile, monthText,
  syncErrorHint, syncTime,
} from '../../api/googleData'
import type { BusinessProfile, GbpLocation } from '../../api/types'
import { useRequestSequence } from '../../composables/useRequestSequence'
import AnalyticsExplainer from './AnalyticsExplainer.vue'
import RowsToggle from './RowsToggle.vue'
import { formatCount } from './format'

// Google 商家檔案（2026-11-25，docs/specs/2026-11-25-business-profile-keyword-planner-design.md §4.4）：地圖與搜尋結果上的
// 商家資訊被看到幾次、被按了電話／路線／網站幾次，以及民眾用哪些字搜尋到它。資料由背景每天同步一次、按月呈現，
// 不隨成效統計頁首的期間變動（同 CrUX）；切到這一類才讀。
const props = withDefaults(defineProps<{ active?: boolean }>(), { active: true })

const data = ref<BusinessProfile | null>(null)
const loading = ref(false)
const failed = ref(false)
const requests = useRequestSequence()
let loaded = false

async function load() {
  const request = requests.begin()
  loading.value = true
  failed.value = false
  try {
    const result = await getBusinessProfile()
    if (!Array.isArray(result?.locations)) throw new Error('商家檔案的回應格式不對')
    if (requests.isCurrent(request)) {
      data.value = result
      loaded = true
    }
  } catch {
    if (requests.isCurrent(request)) failed.value = true
  } finally {
    if (requests.isCurrent(request)) loading.value = false
  }
}

watch(() => props.active, (active) => {
  if (active && !loaded) void load()
}, { immediate: true })

const locations = computed(() => data.value?.locations ?? [])
const selectedKey = ref<string | null>(null)
const location = computed<GbpLocation | null>(
  () => locations.value.find((item) => item.campus_key === selectedKey.value) ?? locations.value[0] ?? null,
)
const hint = computed(() => (location.value?.failed ? syncErrorHint(location.value.error, 'gbp') : null))
const synced = computed(() => syncTime(location.value?.last_success_at))
const share = (value: number | null) => (value === null ? '—' : `${value}%`)
// 2026-11-26：搜尋字詞最多 25 個，先列前 10 項（同 Google 搜尋的字詞表）；換校區時收回前 10 項。
const KEYWORD_LIMIT = 10
const keywordsExpanded = ref(false)
const keywords = computed(() => location.value?.keywords ?? [])
const visibleKeywords = computed(() => (keywordsExpanded.value ? keywords.value : keywords.value.slice(0, KEYWORD_LIMIT)))
watch(selectedKey, () => { keywordsExpanded.value = false })
</script>

<template>
  <section class="gbp" aria-label="Google 商家檔案" :aria-busy="loading">
    <el-alert v-if="failed" type="error" :closable="false" show-icon title="無法讀取 Google 商家檔案的資料，請重新載入。" class="gbp__alert">
      <el-button @click="load">重新載入</el-button>
    </el-alert>
    <div v-else-if="loading && !data" class="panel">
      <el-skeleton animated :rows="3" class="panel__body" aria-label="正在讀取 Google 商家檔案" />
    </div>

    <section v-else-if="data" class="panel" aria-labelledby="gbp-title" data-test="gbp-panel">
      <div class="panel__head gbp__head">
        <h2 id="gbp-title">Google 商家檔案<span v-if="location" class="gbp__sub">{{ location.campus_name }}</span></h2>
        <el-radio-group v-if="locations.length > 1" v-model="selectedKey" size="small" aria-label="要看哪一校的商家檔案">
          <el-radio-button v-for="item in locations" :key="item.campus_key" :value="item.campus_key">{{ item.campus_name }}</el-radio-button>
        </el-radio-group>
      </div>
      <div class="panel__body gbp__body">
        <p v-if="!data.configured" class="hint" data-test="gbp-unconfigured">Google 商家檔案尚未設定，看不到地圖與搜尋結果上的曝光、電話與路線。</p>

        <template v-else-if="location">
          <el-alert v-if="location.failed" type="warning" :closable="false" show-icon class="gbp__sync-error" data-test="gbp-sync-error"
            :title="`最近一次同步失敗：${location.error ?? ''}`">
            <p v-if="hint" class="gbp__hint">{{ hint }}</p>
            <p v-if="synced" class="gbp__hint">下面是 {{ synced }} 同步到的資料；3 小時後會自動再試。</p>
          </el-alert>
          <p v-else-if="synced" class="hint gbp__status">每天同步一次・最近一次 {{ synced }}</p>

          <p v-if="!gbpHasData(location)" class="hint" data-test="gbp-empty">
            {{ location.last_attempt_at ? '還沒有資料。' : '還沒同步過；設定後一小時內會開始第一次同步。' }}
          </p>

          <!-- 每月的表與搜尋字詞在寬螢幕並排（2026-11-26）：原本上下疊、字詞表只佔半寬，右邊空著，整塊約 1,700px。 -->
          <div class="gbp__cols" :class="{ 'is-single': !location.months.length || !location.keywords_month }">
          <div v-if="location.months.length" class="gbp__scroll" role="region" tabindex="0" aria-label="每月曝光與點擊（可左右捲動）">
            <table class="gbp__table" data-test="gbp-months">
              <thead>
                <tr>
                  <th scope="col">月份</th>
                  <th scope="col" class="num">搜尋<wbr>曝光</th>
                  <th scope="col" class="num">地圖<wbr>曝光</th>
                  <th scope="col" class="num">手機<wbr>占</th>
                  <th scope="col" class="num">電話</th>
                  <th scope="col" class="num">路線</th>
                  <th scope="col" class="num">網站</th>
                  <th scope="col" class="num">訊息</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in location.months" :key="row.month">
                  <th scope="row">{{ gbpMonthLabel(row) }}</th>
                  <td class="num">{{ formatCount(gbpSearchImpressions(row)) }}</td>
                  <td class="num">{{ formatCount(gbpMapsImpressions(row)) }}</td>
                  <td class="num">{{ share(gbpMobileShare(row)) }}</td>
                  <td class="num">{{ formatCount(row.calls) }}</td>
                  <td class="num">{{ formatCount(row.directions) }}</td>
                  <td class="num">{{ formatCount(row.website) }}</td>
                  <td class="num">{{ formatCount(row.messages) }}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <section v-if="location.keywords_month" class="gbp__keywords" aria-labelledby="gbp-keywords-title">
            <h3 id="gbp-keywords-title">
              {{ monthText(location.keywords_month) }}怎麼被搜尋到
              <span class="gbp__sub">{{ location.keyword_total > location.keywords.length ? `前 ${location.keywords.length} 個，共 ${formatCount(location.keyword_total)} 個字詞` : `共 ${formatCount(location.keyword_total)} 個字詞` }}</span>
            </h3>
            <p v-if="!location.keywords.length" class="hint">這個月 Google 沒有列出搜尋字詞。</p>
            <div v-else class="gbp__scroll" role="region" tabindex="0" aria-label="搜尋字詞（可左右捲動）">
              <table class="gbp__table gbp__table--words" data-test="gbp-keywords">
                <thead><tr><th scope="col">搜尋字詞</th><th scope="col" class="num">曝光</th></tr></thead>
                <tbody>
                  <tr v-for="row in visibleKeywords" :key="row.keyword">
                    <th scope="row">{{ row.keyword }}</th>
                    <td class="num" :class="{ 'gbp__below': row.impressions === null }">{{ gbpKeywordValue(row) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <RowsToggle v-model="keywordsExpanded" :total="keywords.length" :limit="KEYWORD_LIMIT" data-test="gbp-keywords-toggle" />
          </section>
          </div>

          <AnalyticsExplainer>
            <p>曝光是商家資訊在 Google 搜尋結果或 Google 地圖上被看到的次數，同一個人同一天看到幾次都只算一次。電話、路線、網站、訊息是在商家資訊上按了那個按鈕，不代表真的打通、到校或傳出訊息。</p>
            <p>和上面的「Google 搜尋」不同：那裡是官網本身出現在搜尋結果上的次數；這裡是商家資訊（右側或地圖上的店家卡片）。官網被點的次數也會算在這裡的「網站」。</p>
            <p>Google 晚幾天才算好，所以本月與上個月最後幾天的數字之後還會補上；不隨上方的期間變動。搜尋字詞次數少的，Google 只說「少於 N」。</p>
          </AnalyticsExplainer>
        </template>
      </div>
    </section>
  </section>
</template>

<style scoped>
.gbp {
  margin-top: 20px;
}

.gbp__alert {
  margin-bottom: 16px;
}

.gbp__head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px 16px;
}

.gbp__sub {
  margin-left: 10px;
  font-size: var(--text-sm);
  font-weight: 400;
  color: var(--ink-3);
}

.gbp__body {
  display: grid;
  gap: 16px;
}

.gbp__body > .hint {
  margin: 0;
}

.gbp__hint {
  margin: 4px 0 0;
}

/* 左邊每月的表、右邊搜尋字詞（3：2）；1100px 以下、或只有其中一張時一欄。 */
.gbp__cols {
  display: grid;
  grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
  gap: 16px 28px;
  align-items: start;
}

.gbp__cols.is-single {
  grid-template-columns: minmax(0, 1fr);
}

@media (max-width: 1100px) {
  .gbp__cols {
    grid-template-columns: minmax(0, 1fr);
  }
}

.gbp__scroll {
  min-width: 0;
  overflow-x: auto;
}

.gbp__table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-base);
}

.gbp__table th,
.gbp__table td {
  padding: 10px 12px;
  border-bottom: 1px solid var(--line);
  text-align: left;
  vertical-align: top;
}

.gbp__table .num {
  text-align: right;
  white-space: nowrap;
}

.gbp__table thead th {
  background: var(--surface-2);
  color: var(--ink-2);
  font-weight: 500;
}

/* 數字欄表頭只在 <wbr> 斷行（同 Google 搜尋各表）；月份欄不斷行。 */
.gbp__table thead th.num {
  white-space: normal;
  word-break: keep-all;
}

.gbp__table tbody th {
  font-weight: 400;
  color: var(--ink);
  white-space: nowrap;
}

/* 搜尋字詞在空格換行、不把一個詞拆開；欄位以最長的詞為下限（同 Google 搜尋的字詞表）。 */
.gbp__table--words tbody th {
  white-space: normal;
  word-break: keep-all;
  overflow-wrap: break-word;
}

.gbp__table--words {
  max-width: 560px;
}

.gbp__below {
  color: var(--ink-3);
}

.gbp__keywords {
  display: grid;
  gap: 8px;
}

.gbp__keywords h3 {
  margin: 0;
  font-size: var(--text-base);
  color: var(--ink);
}
</style>
