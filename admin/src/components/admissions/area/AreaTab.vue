<script setup lang="ts">
import { computed, defineAsyncComponent, ref, shallowRef, watch } from 'vue'
import StatsDimensionTable from '../StatsDimensionTable.vue'
import NearbyKindergartens from './NearbyKindergartens.vue'
import OpportunityPanel from './OpportunityPanel.vue'
import { getArea, getAreaBoundaries, getAreaKindergartens, getAreaOpportunity } from '../../../api/admissions'
import { campusLabel } from '../../../api/labels'
import type {
  AdmissionsArea, AreaDistrictRow, AreaKindergartens, AreaOpportunity, AreaVillageRow, VillageBoundaries,
} from '../../../api/types'
import type { StatsColumn } from '../../../admissions/statsFormat'
import { areaQuery } from '../../../admissions/areaFilter'
import { useNarrowScreen } from '../../../composables/useNarrowScreen'
import { useRequestSequence } from '../../../composables/useRequestSequence'
import {
  bandLabel, campusNotLocatedReason, doorplateVersionLabel, opportunityUnavailable, populationVersionLabel, reasonLabel, taipeiMonthDay,
  type RadiusKm,
} from './areaFormat'

// 區域分析（2026-10-08 規格 9）：家長來源依行政區／里統計、里界地圖、附近幼兒園、距離分布。
// 2026-10-13 招生機會：地圖可改依 2–5 歲孩子或招生機會著色，地圖下方多一張「招生機會」表（半徑跟附近幼兒園同一個）。
// 口徑同其他子分頁（頁首校區＋入學學年學期）；家長地址在後端以公開門牌資料比對，不送任何外部服務。
// 地圖（Leaflet）另切一個 chunk，點開這個子分頁才下載。
// chunk 載入失敗（常見於剛部署完、舊的 hash 檔已不存在）：重抓同一個檔救不回來，只能整頁重新載入；
// 三張表與幼兒園清單不受影響。給 errorComponent（空元件）開發模式才不會把載入錯誤再丟出去；
// 旗標一翻畫面就換成說明，Vue 不會再替已卸載的元件記錄錯誤，所以這裡自己記。
const mapChunkFailed = ref(false)
const NoMap = () => null
const AreaMap = defineAsyncComponent({
  loader: () => import('./AreaMap.vue'),
  errorComponent: NoMap,
  onError(error, _retry, fail) {
    console.error('[AreaTab] 地圖元件載入失敗', error)
    mapChunkFailed.value = true
    fail()
  },
})
function reloadPage() {
  window.location.reload()
}

const props = defineProps<{
  campusKey: string
  schoolYear: number | null
  semester: number | null
  csvName: (title: string) => string
  emptyText: string
}>()
const emit = defineEmits<{ 'open-records': [filter: { area: string }] }>()

const narrow = useNarrowScreen()

const area = ref<AdmissionsArea | null>(null)
const failed = ref(false)
const requests = useRequestSequence()

// 換校區或學年學期：畫面清空再讀，只採用最後一次的回應（不殘留別校的數字）。
async function load() {
  const request = requests.begin()
  area.value = null
  failed.value = false
  if (!props.campusKey) return
  try {
    const result = await getArea({ campus_key: props.campusKey, school_year: props.schoolYear, semester: props.semester })
    if (requests.isCurrent(request)) area.value = result
  } catch {
    if (requests.isCurrent(request)) failed.value = true
  }
}
watch([() => props.campusKey, () => props.schoolYear, () => props.semester], () => void load(), { immediate: true })

// 里界只有一份（高雄 893 里），換校區、學期不重讀。shallowRef：893 個 feature 不逐層包成 Proxy，Leaflet 遍歷才不慢。
const boundaries = shallowRef<VillageBoundaries | null>(null)
const boundariesFailed = ref(false)
async function loadBoundaries() {
  boundariesFailed.value = false
  try {
    boundaries.value = await getAreaBoundaries()
  } catch {
    boundariesFailed.value = true
  }
}
void loadBoundaries()

const radiusKm = ref<RadiusKm>(3)
const kindergartens = ref<AreaKindergartens | null>(null)
const kindergartensFailed = ref(false)
const kindergartenRequests = useRequestSequence()
// 換校區或半徑：先清成 null（清單顯示骨架、地圖不畫舊的點）再讀，空狀態寫的「N 公里內」才和資料對得上。
async function loadKindergartens() {
  const request = kindergartenRequests.begin()
  kindergartens.value = null
  kindergartensFailed.value = false
  if (!props.campusKey) return
  try {
    const result = await getAreaKindergartens(props.campusKey, radiusKm.value)
    if (kindergartenRequests.isCurrent(request)) kindergartens.value = result
  } catch {
    if (kindergartenRequests.isCurrent(request)) kindergartensFailed.value = true
  }
}
watch([() => props.campusKey, radiusKm], () => void loadKindergartens(), { immediate: true })

// 招生機會（2026-10-13 規格 7）：母體同區域分析，半徑同附近幼兒園；換任何一個都清空再讀、只採用最後一次的回應。
const opportunity = ref<AreaOpportunity | null>(null)
const opportunityFailed = ref(false)
const opportunityRequests = useRequestSequence()
async function loadOpportunity() {
  const request = opportunityRequests.begin()
  opportunity.value = null
  opportunityFailed.value = false
  if (!props.campusKey) return
  try {
    const result = await getAreaOpportunity({
      campus_key: props.campusKey, school_year: props.schoolYear, semester: props.semester, radius_km: radiusKm.value,
    })
    if (opportunityRequests.isCurrent(request)) opportunity.value = result
  } catch {
    if (opportunityRequests.isCurrent(request)) opportunityFailed.value = true
  }
}
watch([() => props.campusKey, () => props.schoolYear, () => props.semester, radiusKm], () => void loadOpportunity(), { immediate: true })
// 地圖後兩種著色停用時的原因；空字串＝可以用。讀取中不算用不了：換半徑時正在看招生機會的人，
// 地圖不該跳回參觀人數（地圖在資料回來前先不上色）。
const opportunityNote = computed(() => {
  if (opportunityFailed.value) return '招生機會讀取失敗。'
  return opportunity.value ? (opportunityUnavailable(opportunity.value) ?? '') : ''
})

const map = ref<{ focusKindergarten: (id: string) => void } | null>(null)
function focusKindergarten(id: string) {
  map.value?.focusKindergarten(id)
}

// 狀態列（主控裁定 R5）：以「有地址」為母數——「有地址 N 筆：到里 a 筆、未定位到里 b 筆（只到區 c、查無門牌 d、
// 非高雄市 e、待比對 f）」，括號只列非零項；沒填地址的另外寫，已匿名化不放在這裡。
// c、f 用後端合計欄位（只到區、待比對的列不一定有原因），d、e 取自未定位原因。
const status = computed(() => {
  const data = area.value
  if (!data) return null
  const { totals, data_status: dataStatus } = data
  const reasonCount = (reason: string) => totals.unlocated_reasons.find((item) => item.reason === reason)?.count ?? 0
  const parts: [string, number][] = [
    ['只到區', totals.district_level],
    [reasonLabel('no_doorplate'), reasonCount('no_doorplate')],
    ['非高雄市', reasonCount('outside_kaohsiung')],
    ['待比對', totals.pending],
  ]
  return {
    doorplate: dataStatus.doorplate_version
      ? `門牌資料 ${doorplateVersionLabel(dataStatus.doorplate_version)}版`
      : '門牌資料尚未匯入，家長地址暫時對不到里、算不出距離；匯入後自動補上。',
    doorplateImported: Boolean(dataStatus.doorplate_version),
    kindergarten: dataStatus.kindergartens_synced_at ? `幼兒園名單 ${taipeiMonthDay(dataStatus.kindergartens_synced_at)} 更新` : '幼兒園名單尚未匯入',
    population: dataStatus.population_version ? `各里人口 ${populationVersionLabel(dataStatus.population_version)}` : '各里人口尚未匯入',
    noVillage: totals.with_address - totals.village_level,
    breakdown: parts.filter(([, count]) => count > 0).map(([label, count]) => `${label} ${count}`).join('、'),
  }
})

// 有訪視但沒有任何可比對的地址時的說明。此時 visit ＝ no_address ＋ anonymized：
// 只有沒填地址、只有已匿名化（地址已依保存期限清除）、兩者都有，各寫各的，不把匿名化說成「沒填」。
const noAddressText = computed(() => {
  const totals = area.value?.totals
  if (!totals || !totals.visit || totals.with_address) return ''
  const { no_address: noAddress, anonymized } = totals
  if (!anonymized) return '這個範圍的訪視都還沒填地址。'
  if (!noAddress) return '這個範圍的訪視地址都已依保存期限清除，無法比對。'
  return `這個範圍的訪視沒有可比對的地址：${noAddress} 筆沒填地址、${anonymized} 筆已依保存期限清除。`
})

const placeColumns = (label: string): StatsColumn[] => [
  { key: 'place', label, sticky: true },
  { key: 'visit', label: '參觀人數', kind: 'bar' },
  { key: 'deposit', label: '預繳人數', kind: 'count' },
  { key: 'visit_to_deposit_rate', label: '預繳率', kind: 'rate' },
  { key: 'visit_to_deposit_range', label: '可能範圍', kind: 'range' },
]
const DISTRICT_COLUMNS = placeColumns('行政區')
const VILLAGE_COLUMNS = placeColumns('里')
const DISTANCE_COLUMNS: StatsColumn[] = [
  { key: 'band_label', label: '距本校', sticky: true },
  { key: 'visit', label: '參觀人數', kind: 'bar' },
  { key: 'deposit', label: '預繳人數', kind: 'count' },
  { key: 'visit_to_deposit_rate', label: '預繳率', kind: 'rate' },
  { key: 'visit_to_deposit_range', label: '可能範圍', kind: 'range' },
]

const districtRows = computed(() => (area.value?.districts ?? []).map((row) => ({ ...row, place: row.district })))
// 依參觀人數多到少；同數保留後端的順序（Array.sort 是穩定排序）。
const villageRows = computed(() =>
  [...(area.value?.villages ?? [])]
    .sort((a, b) => b.visit - a.visit)
    .map((row) => ({ ...row, place: `${row.district}${row.village}`, key: `${row.district}/${row.village}` })),
)
// 後端以本校有沒有座標決定距離分組（沒有座標時全歸「無距離」），這裡跟著同一個判準。
const campusLocated = computed(() => area.value?.campus.lat != null && area.value.campus.lng != null)
const distanceRows = computed(() =>
  campusLocated.value ? (area.value?.distance_bands ?? []).map((row) => ({ ...row, band_label: bandLabel(row.band) })) : [],
)
const distanceEmptyText = computed(
  () => `${campusNotLocatedReason(area.value?.campus.locate_error ?? null) ?? '本校位置尚未確定'}，無法計算距離。`,
)

// StatsDimensionTable 是泛型：action 回傳的就是 rows 那一列的型別（後端列型別加上畫面用的欄位），不需要轉型。
function openDistrict({ district }: AreaDistrictRow) {
  emit('open-records', { area: areaQuery({ kind: 'place', district, village: null }) })
}
function openVillage({ district, village }: AreaVillageRow) {
  emit('open-records', { area: areaQuery({ kind: 'place', district, village }) })
}
function openPlace(filter: { district: string; village: string }) {
  emit('open-records', { area: areaQuery({ kind: 'place', ...filter }) })
}
function openNoVillage() {
  emit('open-records', { area: areaQuery({ kind: 'no_village' }) })
}
</script>

<template>
  <div class="area">
    <el-alert v-if="failed" type="error" :closable="false" show-icon title="無法讀取區域分析，請重新載入。">
      <el-button size="small" @click="load()">重新載入</el-button>
    </el-alert>
    <el-skeleton v-else-if="!area || !status" :rows="6" animated />
    <template v-else>
      <div class="area-head">
        <!-- 門牌資料還沒匯入時那句已經以句號結尾，兩段分開排，不接「。・」。 -->
        <p class="hint area-status">
          <span>{{ status.doorplate }}</span><span :class="{ 'area-status__next': !status.doorplateImported }">{{ status.doorplateImported ? '・' : '' }}{{ status.kindergarten }}・{{ status.population }}</span>
        </p>
        <p v-if="area.totals.with_address" class="area-summary">
          有地址 <strong class="num">{{ area.totals.with_address }}</strong> 筆：到里 <span class="num">{{ area.totals.village_level }}</span> 筆<template v-if="status.noVillage">、未定位到里 <span class="num">{{ status.noVillage }}</span> 筆<template v-if="status.breakdown">（{{ status.breakdown }}）</template>
            <el-button text size="small" aria-label="查看未定位到里的訪視明細" @click="openNoVillage">查看</el-button></template><template v-if="area.totals.no_address">；另有 <span class="num">{{ area.totals.no_address }}</span> 筆沒填地址</template>
        </p>
        <p v-if="!area.totals.visit" class="empty-note area-empty">{{ emptyText }}</p>
        <p v-else-if="noAddressText" class="empty-note area-empty">{{ noAddressText }}</p>
      </div>

      <div class="area-top">
        <div class="area-top__map">
          <el-alert v-if="mapChunkFailed" class="area-map-error" type="error" :closable="false" show-icon title="地圖沒有載入成功，請重新整理這一頁。">
            <el-button size="small" @click="reloadPage">重新整理</el-button>
          </el-alert>
          <el-alert v-else-if="boundariesFailed" class="area-map-error" type="error" :closable="false" show-icon title="里界載入失敗，地圖無法顯示。">
            <el-button size="small" @click="loadBoundaries()">重試</el-button>
          </el-alert>
          <el-skeleton v-else-if="!boundaries" :rows="8" animated />
          <AreaMap
            v-else
            ref="map"
            :boundaries="boundaries"
            :villages="area.villages"
            :campus="area.campus"
            :campus-name="campusLabel(campusKey)"
            :kindergartens="kindergartens?.items ?? []"
            :radius-km="radiusKm"
            :narrow="narrow"
            :opportunity="opportunity"
            :opportunity-note="opportunityNote"
            @open-area="openPlace"
          />
        </div>
        <NearbyKindergartens
          v-model:radius-km="radiusKm"
          :data="kindergartens"
          :failed="kindergartensFailed"
          @select="focusKindergarten"
          @retry="loadKindergartens()"
        />
      </div>

      <OpportunityPanel :data="opportunity" :failed="opportunityFailed" :csv-name="csvName" @retry="loadOpportunity()" />

      <div v-if="area.totals.with_address" class="area-tables">
        <StatsDimensionTable
          title="行政區排行"
          :rows="districtRows"
          :columns="DISTRICT_COLUMNS"
          row-key="district"
          numbered
          empty-text="這個範圍還沒有比對到行政區的地址"
          :export-filename="csvName('行政區排行')"
          action-label="查看明細"
          @action="openDistrict"
        />
        <StatsDimensionTable
          title="里排行"
          :rows="villageRows"
          :columns="VILLAGE_COLUMNS"
          row-key="key"
          numbered
          empty-text="這個範圍還沒有定位到里的地址"
          caption="里以門牌資料為準；只到區、未定位的訪視不在這張表。"
          :export-filename="csvName('里排行')"
          action-label="查看明細"
          @action="openVillage"
        />
        <!-- 距離分布沒有對應的明細篩選，不給「查看明細」（R13）。 -->
        <StatsDimensionTable
          title="距離分布"
          :rows="distanceRows"
          :columns="DISTANCE_COLUMNS"
          row-key="band"
          :empty-text="distanceEmptyText"
          :caption="campusLocated ? '從家長地址的門牌量到本校的直線距離；只到區、未定位的訪視算在「無距離」。' : ''"
          :export-filename="csvName('距離分布')"
        />
      </div>
    </template>
  </div>
</template>

<style scoped>
.area {
  display: grid;
  gap: 20px;
  min-width: 0;
}

.area-head {
  display: grid;
  gap: 4px;
}

.area-head p {
  margin: 0;
}

.area-summary {
  color: var(--ink);
}

.area-status__next {
  margin-inline-start: 1em;
}

.area-top {
  display: grid;
  gap: 16px;
  min-width: 0;
}

.area-top > * {
  min-width: 0;
}

/* 一欄至少 36rem：里排行加上「可能範圍」與「查看明細」欄，1440 實測約 562px（2026-10-12），窄過這個寬度寧可換列、不要把欄擠出表框。
   1440 螢幕（側欄之外約 1124px）放不下兩欄，三張表各占一列；更寬的螢幕才兩張並排。min(100%, …) 讓窄螢幕自然變單欄，
   表格在自己的框內橫捲。 */
.area-tables {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 36rem), 1fr));
  gap: 24px;
  min-width: 0;
}

@media (min-width: 1200px) {
  .area-top {
    grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
    align-items: start;
  }
}
</style>
