<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { getAdConversionStatus } from '../../../api/admissions'
import { formatShortDateTime } from '../../../api/labels'
import type { AdConversionStatus } from '../../../api/types'
import { useRequestSequence } from '../../../composables/useRequestSequence'
import { formatCount } from '../area/areaFormat'

// 回傳廣告平台的狀態（2026-11-19，docs/specs/2026-11-19-cookie-stats-design.md §8）：
// 「標記已到場」「變成已預繳」後要送給 GA4／Meta／ChatGPT／LINE 的轉換，送了幾筆、卡在哪裡，
// 以及期間內官網預約有多少帶得到各平台的識別碼。四個平台都還沒設金鑰時只顯示一行說明。
const props = withDefaults(defineProps<{ active?: boolean }>(), { active: true })

const DAYS = 30
const PLATFORM_LABELS: Record<string, string> = { ga4: 'Google（GA4）', meta: 'Meta', openai: 'ChatGPT', line: 'LINE' }
const EVENT_LABELS: Record<string, string> = { visit_attended: '到場', deposit_paid: '預繳' }
// 後端 last_error 的固定代碼；其他是平台回的 HTTP 狀態與錯誤摘要，原樣顯示。
const PROBLEM_LABELS: Record<string, string> = {
  expired: '超過平台收件時限',
  no_identifier: '案件沒有這個平台的識別碼',
  anonymized: '案件已匿名化',
  not_configured: '平台設定已拿掉',
  excluded: '案件已標記排除',
}

const data = ref<AdConversionStatus | null>(null)
const failed = ref(false)
const loaded = ref(false)
const requests = useRequestSequence()

async function load() {
  const request = requests.begin()
  failed.value = false
  try {
    const result = await getAdConversionStatus(DAYS)
    if (requests.isCurrent(request)) data.value = result
  } catch {
    if (requests.isCurrent(request)) failed.value = true
  }
}

watch(() => props.active, (active) => {
  if (active && !loaded.value) {
    loaded.value = true
    void load()
  }
}, { immediate: true })

const configured = computed(() => (data.value?.platforms ?? []).filter((item) => item.configured))
const rows = computed(() => (data.value?.platforms ?? []).filter((item) => item.configured || item.events.some((e) => e.sent + e.failed + e.skipped + e.pending > 0)))
const problemText = (value: string | null) => (value ? PROBLEM_LABELS[value] ?? value : '')
const share = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : '—')
</script>

<template>
  <section class="ads-block ads-conversions" aria-labelledby="ads-conversions-title">
    <h3 id="ads-conversions-title">回傳廣告平台（近 {{ DAYS }} 天）</h3>
    <el-alert v-if="failed" type="error" :closable="false" show-icon title="無法讀取回傳狀態。">
      <el-button size="small" @click="load()">重新載入</el-button>
    </el-alert>
    <el-skeleton v-else-if="!data" :rows="2" animated />
    <template v-else>
      <p v-if="!configured.length && !rows.length" class="hint" data-test="ads-conversions-off">
        還沒有設定任何平台的伺服器端金鑰，到場與預繳不會回傳給廣告平台（設定步驟見部署說明「到場與預繳回傳廣告平台」）。
      </p>
      <template v-else>
        <div class="ads-scroll">
          <table class="ads-table" data-test="ads-conversions">
            <thead>
              <tr>
                <th scope="col">平台</th>
                <th scope="col" class="ads-conversions__event">事件</th>
                <th scope="col">已送</th>
                <th scope="col">待送</th>
                <th scope="col">失敗</th>
                <th scope="col">略過</th>
                <th scope="col">帶得到識別碼的預約</th>
              </tr>
            </thead>
            <tbody>
              <template v-for="platform in rows" :key="platform.platform">
                <tr v-for="(event, i) in platform.events" :key="`${platform.platform}-${event.event}`">
                  <th v-if="i === 0" scope="rowgroup" :rowspan="platform.events.length">
                    {{ PLATFORM_LABELS[platform.platform] ?? platform.platform }}<span v-if="!platform.configured" class="ads-conversions__off">（未設定）</span>
                  </th>
                  <td class="ads-conversions__event">{{ EVENT_LABELS[event.event] ?? event.event }}</td>
                  <td class="num">{{ formatCount(event.sent) }}</td>
                  <td class="num">{{ formatCount(event.pending) }}</td>
                  <td class="num">{{ formatCount(event.failed) }}</td>
                  <td class="num">{{ formatCount(event.skipped) }}</td>
                  <td v-if="i === 0" class="num" :rowspan="platform.events.length">
                    {{ formatCount(platform.cases_with_ids) }}／{{ formatCount(data.cases) }}（{{ share(platform.cases_with_ids, data.cases) }}）
                  </td>
                </tr>
              </template>
            </tbody>
          </table>
        </div>
        <ul class="ads-conversions__notes">
          <li v-for="platform in rows" :key="`note-${platform.platform}`">
            {{ PLATFORM_LABELS[platform.platform] ?? platform.platform }}：最近一次送出
            {{ platform.last_sent_at ? formatShortDateTime(platform.last_sent_at) : '—' }}<template v-if="platform.last_problem">；最近的問題（{{ platform.last_problem_at ? formatShortDateTime(platform.last_problem_at) : '時間不明' }}）：{{ problemText(platform.last_problem) }}</template>
          </li>
        </ul>
      </template>
      <p class="hint ads-note">「帶得到識別碼」是送出預約時這台裝置有該平台的 cookie 或點擊代碼；開了「不要追蹤」或沒點過該平台廣告的家長不會有。略過多半是超過平台收件時限（GA4 72 小時、其他 7 天）或案件沒有識別碼。</p>
    </template>
  </section>
</template>

<style scoped>
/* 表格樣式同 AdsTab（scoped 樣式不會傳進子元件，這裡照抄一份）。 */
.ads-block {
  display: grid;
  gap: 8px;
}

.ads-block h3 {
  margin: 0;
  font-size: var(--text-base);
  color: var(--ink);
}

.ads-scroll {
  overflow-x: auto;
}

.ads-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-base);
}

.ads-table th,
.ads-table td {
  padding: 8px 10px;
  border-bottom: 1px solid var(--line);
  text-align: right;
  white-space: nowrap;
}

.ads-table thead th {
  background: var(--surface-2);
  color: var(--ink-2);
  font-size: var(--text-sm);
  font-weight: 600;
}

.ads-table th:first-child,
.ads-table .ads-conversions__event {
  text-align: left;
}

.ads-table tbody th {
  font-weight: 600;
  text-align: left;
}

.ads-note {
  margin: 0;
  line-height: 1.5;
}

.ads-conversions__off {
  color: var(--ink-2);
  font-weight: 400;
}

.ads-conversions__notes {
  display: grid;
  gap: 4px;
  margin: 0;
  padding-left: 1.2em;
  color: var(--ink-2);
  font-size: var(--text-sm);
}
</style>
