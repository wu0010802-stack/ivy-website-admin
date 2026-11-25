<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { apiErrorMessage } from '../../../api/errors'
import {
  addSearchKeyword, deleteSearchKeyword, demandCell, demandCells, demandMonthHeader, getSearchDemand, syncErrorHint, syncTime,
} from '../../../api/googleData'
import type { SearchDemand, SearchKeyword } from '../../../api/types'
import { notifyError } from '../../../composables/notify'
import { useRequestSequence } from '../../../composables/useRequestSequence'

// 搜尋需求（2026-11-25，docs/specs/2026-11-25-business-profile-keyword-planner-design.md §5.4）：後台維護的關鍵字在高雄市與
// 五校所在區，最近 12 個整月的 Google 每月搜尋量（Keyword Planner）。資料由背景每週同步一次，新加的關鍵字一小時內抓。
// 不受廣告成效的月份區間影響。active：第一次切進廣告成效才讀。
const props = withDefaults(defineProps<{ active?: boolean }>(), { active: true })

const data = ref<SearchDemand | null>(null)
const failed = ref(false)
const requests = useRequestSequence()
let loaded = false

async function load() {
  const request = requests.begin()
  failed.value = false
  try {
    const result = await getSearchDemand()
    if (!requests.isCurrent(request)) return
    if (!Array.isArray(result?.geos) || !Array.isArray(result?.keywords)) throw new Error('搜尋需求的回應格式不對')
    data.value = result
    loaded = true
    if (!result.geos.some((item) => item.key === geo.value)) geo.value = result.geos[0]?.key ?? ''
  } catch {
    if (requests.isCurrent(request)) failed.value = true
  }
}

watch(() => props.active, (active) => {
  if (active && !loaded) void load()
}, { immediate: true })

const geo = ref('kaohsiung')
const months = computed(() => data.value?.months ?? [])
const keywords = computed(() => data.value?.keywords ?? [])
const full = computed(() => !!data.value && keywords.value.length >= data.value.keyword_limit)
const hint = computed(() => (data.value?.failed ? syncErrorHint(data.value.error, 'ads') : null))
const synced = computed(() => syncTime(data.value?.last_success_at))
// 成功但有區查不到（error 有值、failed 是 false）：照實寫哪一區查不到。
const partial = computed(() => (data.value && !data.value.failed && data.value.error ? data.value.error : null))

const draft = ref('')
const adding = ref(false)
async function add() {
  const text = draft.value.trim()
  if (!text || adding.value) return
  adding.value = true
  try {
    await addSearchKeyword(text)
    draft.value = ''
    ElMessage.success('已新增，下一次同步（一小時內）會抓到搜尋量')
    await load()
  } catch (err) {
    notifyError(apiErrorMessage(err, '新增失敗，請再試一次。'))
  } finally {
    adding.value = false
  }
}

async function remove(keyword: SearchKeyword) {
  try {
    await ElMessageBox.confirm(`會刪掉「${keyword.text}」與它的搜尋量。`, '刪除這個關鍵字？', {
      confirmButtonText: '刪除',
      cancelButtonText: '先不要',
      type: 'warning',
      confirmButtonClass: 'el-button--danger',
      autofocus: false,
    })
  } catch {
    return
  }
  try {
    await deleteSearchKeyword(keyword.id)
    ElMessage.success('已刪除')
  } catch (err) {
    notifyError(apiErrorMessage(err, '刪除失敗，請再試一次。'))
  }
  void load()
}

function pendingText(): string {
  return data.value?.configured ? '還沒同步，一小時內會抓到' : 'Keyword Planner 設定好之後會抓'
}
</script>

<template>
  <section class="demand" aria-labelledby="demand-title" data-test="search-demand">
    <div class="demand__head">
      <h3 id="demand-title">搜尋需求<span class="demand__sub">Google 每月搜尋次數</span></h3>
      <el-radio-group v-if="data && data.geos.length > 1" v-model="geo" size="small" aria-label="地區" data-test="demand-geo">
        <el-radio-button v-for="item in data.geos" :key="item.key" :value="item.key">{{ item.label }}</el-radio-button>
      </el-radio-group>
    </div>

    <el-alert v-if="failed" type="error" :closable="false" show-icon title="無法讀取搜尋需求，請重新載入。" class="inline-error">
      <el-button size="small" @click="load()">重新載入</el-button>
    </el-alert>
    <el-skeleton v-else-if="!data" :rows="3" animated />
    <template v-else>
      <p v-if="!data.configured" class="hint demand__note" data-test="demand-unconfigured">Keyword Planner 尚未設定；可以先把關鍵字加好，設定後會自動抓。</p>
      <el-alert v-else-if="data.failed" type="warning" :closable="false" show-icon :title="`最近一次同步失敗：${data.error ?? ''}`" data-test="demand-sync-error">
        <p v-if="hint" class="demand__alert-text">{{ hint }}</p>
      </el-alert>
      <p v-else-if="synced" class="hint demand__note">每週更新一次・最近一次 {{ synced }}<template v-if="partial">；{{ partial }}</template></p>

      <form class="demand__add" @submit.prevent="add">
        <el-input v-model="draft" :maxlength="80" placeholder="例：三民區 幼兒園" aria-label="要追的關鍵字" :disabled="full" data-test="demand-input" />
        <el-button type="primary" plain native-type="submit" :loading="adding" :disabled="full || !draft.trim()" data-test="demand-add">新增</el-button>
        <span class="hint demand__count">{{ keywords.length }} / {{ data.keyword_limit }}</span>
      </form>

      <p v-if="!keywords.length" class="hint demand__note">還沒有關鍵字。加上家長可能搜尋的字（「三民區 幼兒園」「左營 幼稚園 推薦」），就能看出每個月有多少人在找。</p>
      <div v-else class="demand__scroll" role="region" tabindex="0" aria-label="各關鍵字每月搜尋次數（可左右捲動）">
        <table class="demand__table" data-test="demand-table">
          <thead>
            <tr>
              <th scope="col" class="demand__keyword">關鍵字</th>
              <th v-for="(month, index) in months" :key="month" scope="col" class="num">
                <span class="demand__year">{{ demandMonthHeader(months, index).year }}</span>{{ demandMonthHeader(months, index).month }}
              </th>
              <th scope="col"><span class="visually-hidden">操作</span></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="keyword in keywords" :key="keyword.id">
              <th scope="row" class="demand__keyword">{{ keyword.text }}</th>
              <td v-if="!keyword.synced_at" :colspan="months.length" class="hint demand__pending">{{ pendingText() }}</td>
              <template v-else>
                <td
                  v-for="cell in demandCells(keyword, geo)" :key="cell.month" class="num"
                  :class="`demand__cell--${demandCell(cell).kind}`"
                >{{ demandCell(cell).text }}</td>
              </template>
              <td class="demand__actions">
                <el-button size="small" text type="danger" :aria-label="`刪除關鍵字 ${keyword.text}`" data-test="demand-delete" @click="remove(keyword)">刪除</el-button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="hint demand__note">數字是 Google 估的每月搜尋次數（繁體中文、只算 Google 搜尋，依搜尋的人所在地區），Google 會四捨五入成級距；量太少時 Google 不給數字。意思相近的寫法（有沒有空格）Google 會給同一組數字。鳥松區、仁武區 Google 沒有區的層級，只看得到高雄市。</p>
    </template>
  </section>
</template>

<style scoped>
.demand {
  display: grid;
  gap: 8px;
  min-width: 0;
}

.demand__head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px 16px;
}

.demand__head h3 {
  margin: 0;
  font-size: var(--text-base);
  color: var(--ink);
}

.demand__sub {
  margin-left: 8px;
  font-size: var(--text-sm);
  font-weight: 400;
  color: var(--ink-3);
}

.demand__note {
  margin: 0;
  line-height: 1.5;
}

.demand__alert-text {
  margin: 4px 0 0;
}

.demand__add {
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: 480px;
}

.demand__add :deep(.el-input) {
  flex: 1 1 auto;
}

.demand__count {
  flex: none;
  font-variant-numeric: tabular-nums;
}

/* position: relative：表頭「操作」那格的 .visually-hidden 是絕對定位，捲動框不是它的定位祖先時會跑出框外、
   把整頁撐出橫向捲軸（手機 390 寬時頁面變成 919）。 */
.demand__scroll {
  position: relative;
  overflow-x: auto;
}

.demand__table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-base);
}

.demand__table th,
.demand__table td {
  padding: 8px 10px;
  border-bottom: 1px solid var(--line);
  text-align: right;
  white-space: nowrap;
}

.demand__table thead th {
  background: var(--surface-2);
  color: var(--ink-2);
  font-size: var(--text-sm);
  font-weight: 600;
  vertical-align: bottom;
}

.demand__year {
  display: block;
  font-weight: 400;
  color: var(--ink-3);
}

/* 關鍵字欄左右捲動時黏在左邊，看得到是哪一個字。 */
.demand__table .demand__keyword {
  position: sticky;
  left: 0;
  z-index: 1;
  min-width: 9em;
  max-width: 16em;
  /* 和頁面同一個底色（這一段直接放在頁面上、不在卡片裡），捲過去的數字不會從底下透出來。 */
  background: var(--surface-2);
  text-align: left;
  white-space: normal;
  word-break: keep-all;
  overflow-wrap: break-word;
}

.demand__table thead .demand__keyword {
  background: var(--surface-2);
}

.demand__table tbody th {
  font-weight: 600;
}

.demand__cell--low,
.demand__cell--missing {
  color: var(--ink-3);
  font-size: var(--text-sm);
}

.demand__table .demand__pending {
  text-align: left;
}

.demand__actions {
  width: 1%;
}

@media (max-width: 720px) {
  .demand__add {
    max-width: none;
  }
}
</style>
