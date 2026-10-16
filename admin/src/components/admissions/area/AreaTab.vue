<script setup lang="ts">
import { computed, defineAsyncComponent, ref, shallowRef, watch } from 'vue'
import StatsDimensionTable from '../StatsDimensionTable.vue'
import EnrolledPanel from './EnrolledPanel.vue'
import NearbyPanel from './NearbyPanel.vue'
import OpportunityPanel from './OpportunityPanel.vue'
import PeerFeesPanel from './PeerFeesPanel.vue'
import ProviderChanges from './ProviderChanges.vue'
import VillageTrendsPanel from './VillageTrendsPanel.vue'
import SchoolDistrictPanel from './SchoolDistrictPanel.vue'
import {
  getArea, getAreaBabycare, getAreaBoundaries, getAreaChanges, getAreaEnrolled, getAreaKindergartens, getAreaOpportunity, getAreaPeerFees,
  getAreaTrends,
} from '../../../api/admissions'
import { campusLabel } from '../../../api/labels'
import type {
  AdmissionsArea, AreaBabycare, AreaChanges, AreaDistrictRow, AreaEnrolled, AreaKindergartens, AreaOpportunity, AreaPeerFees, AreaTrends,
  AreaVillageRow, VillageBoundaries,
} from '../../../api/types'
import type { StatsColumn } from '../../../admissions/statsFormat'
import { areaQuery } from '../../../admissions/areaFilter'
import { DEFAULT_AREA_VIEW, type AreaView } from '../../../admissions/areaView'
import { useNarrowScreen } from '../../../composables/useNarrowScreen'
import { useRequestSequence } from '../../../composables/useRequestSequence'
import {
  bandLabel, campusNotLocatedReason, enrolledMapNote, homesMapNote, opportunityUnavailable, trendMapNote,
  type GradeFilter, type NearbyKind, type RadiusKm,
} from './areaFormat'
import { addressSummary, dataStatusSegments } from './areaPane'
import { DEFAULT_PEER_AGE, type PeerAge } from './peerFeesFormat'

// 區域分析（2026-10-08 規格 9）：家長來源依行政區／里統計、里界地圖、附近幼兒園、距離分布。
// 2026-10-13 招生機會：地圖可改依 2–5 歲孩子或招生機會著色，地圖下方多一張「招生機會」表（半徑跟附近幼兒園同一個）。
// 2026-10-14 里的變化：地圖多「孩子增減」著色，招生機會下面多一張「里的變化」表（半徑同上）。
// 2026-10-14 托嬰與園所異動：右欄多托嬰中心切換與「附近園所的變化」。
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
// 地圖模式、選取的里與表格分頁（頁面放在網址，2026-10-16）。先宣告 model，工作台改版時再取用（現在還沒讀寫，所以不接變數）。
defineModel<AreaView>('view', { default: () => ({ ...DEFAULT_AREA_VIEW }) })

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

// 附近托嬰中心與附近園所的變化（2026-10-14 規格 7）：半徑跟附近幼兒園同一個；換校區或半徑都先清空再讀、
// 只採用最後一次的回應。兩份各自成敗，互不牽連。
const nearbyKind = ref<NearbyKind>('kindergarten')
const babycare = ref<AreaBabycare | null>(null)
const babycareFailed = ref(false)
const babycareRequests = useRequestSequence()
async function loadBabycare() {
  const request = babycareRequests.begin()
  babycare.value = null
  babycareFailed.value = false
  if (!props.campusKey) return
  try {
    const result = await getAreaBabycare(props.campusKey, radiusKm.value)
    if (babycareRequests.isCurrent(request)) babycare.value = result
  } catch {
    if (babycareRequests.isCurrent(request)) babycareFailed.value = true
  }
}
watch([() => props.campusKey, radiusKm], () => void loadBabycare(), { immediate: true })

const changes = ref<AreaChanges | null>(null)
const changesFailed = ref(false)
const changesRequests = useRequestSequence()
async function loadChanges() {
  const request = changesRequests.begin()
  changes.value = null
  changesFailed.value = false
  if (!props.campusKey) return
  try {
    const result = await getAreaChanges(props.campusKey, radiusKm.value)
    if (changesRequests.isCurrent(request)) changes.value = result
  } catch {
    if (changesRequests.isCurrent(request)) changesFailed.value = true
  }
}
watch([() => props.campusKey, radiusKm], () => void loadChanges(), { immediate: true })

// 附近同業收費（2026-10-15 規格 7.1）：年齡放這裡（換校區、半徑都保留）；換校區、半徑、年齡都清空再讀，
// 只採用最後一次的回應。清單的公告收費也用這份（同半徑、同年齡）。
const peerAge = ref<PeerAge>(DEFAULT_PEER_AGE)
const peerFees = ref<AreaPeerFees | null>(null)
const peerFeesFailed = ref(false)
const peerFeesRequests = useRequestSequence()
async function loadPeerFees() {
  const request = peerFeesRequests.begin()
  peerFees.value = null
  peerFeesFailed.value = false
  if (!props.campusKey) return
  try {
    const result = await getAreaPeerFees(props.campusKey, radiusKm.value, peerAge.value)
    if (peerFeesRequests.isCurrent(request)) peerFees.value = result
  } catch {
    if (peerFeesRequests.isCurrent(request)) peerFeesFailed.value = true
  }
}
watch([() => props.campusKey, radiusKm, peerAge], () => void loadPeerFees(), { immediate: true })

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

// 里的變化（2026-10-14 規格 7）：參數同招生機會；換任何一個都清空再讀、只採用最後一次的回應。
const trends = ref<AreaTrends | null>(null)
const trendsFailed = ref(false)
const trendsRequests = useRequestSequence()
async function loadTrends() {
  const request = trendsRequests.begin()
  trends.value = null
  trendsFailed.value = false
  if (!props.campusKey) return
  try {
    const result = await getAreaTrends({
      campus_key: props.campusKey, school_year: props.schoolYear, semester: props.semester, radius_km: radiusKm.value,
    })
    if (trendsRequests.isCurrent(request)) trends.value = result
  } catch {
    if (trendsRequests.isCurrent(request)) trendsFailed.value = true
  }
}
watch([() => props.campusKey, () => props.schoolYear, () => props.semester, radiusKm], () => void loadTrends(), { immediate: true })
// 「孩子增減」停用的原因；空字串＝可以用（讀取中也可以用，同招生機會）。
const trendNote = computed(() => {
  if (trendsFailed.value) return '里的變化讀取失敗。'
  return trends.value ? trendMapNote(trends.value) : ''
})
// 「新屋交屋」停用的原因：新成屋沒匯入、本校沒座標、讀取失敗；出生、遷入遷出沒匯入不影響它。
const homesNote = computed(() => {
  if (trendsFailed.value) return '里的變化讀取失敗。'
  return trends.value ? homesMapNote(trends.value) : ''
})

// 在籍學生（2026-10-15 規格 §6）：只依校區讀（清冊是某一天的快照，和學年學期、半徑無關）。
// 班別篩選放這裡：地圖與下方表格同步；換校區回到全部（新校不一定有同一班）。
const gradeFilter = ref<GradeFilter>('all')
const enrolled = ref<AreaEnrolled | null>(null)
const enrolledFailed = ref(false)
const enrolledRequests = useRequestSequence()
async function loadEnrolled() {
  const request = enrolledRequests.begin()
  enrolled.value = null
  enrolledFailed.value = false
  if (!props.campusKey) return
  try {
    const result = await getAreaEnrolled(props.campusKey)
    if (enrolledRequests.isCurrent(request)) enrolled.value = result
  } catch {
    if (enrolledRequests.isCurrent(request)) enrolledFailed.value = true
  }
}
watch(() => props.campusKey, () => {
  gradeFilter.value = 'all'
  void loadEnrolled()
}, { immediate: true })
const enrolledNote = computed(() => enrolledMapNote(enrolled.value, enrolledFailed.value))

const map = ref<{ focusKindergarten: (id: string) => void; focusBabycare: (id: string) => void; revealBabycare: () => void } | null>(null)
function focusKindergarten(id: string) {
  map.value?.focusKindergarten(id)
}
function focusBabycare(id: string) {
  map.value?.focusBabycare(id)
}
// 卡片切到托嬰中心就打開地圖上的托嬰圖層（預設不勾，維持現有畫面）。同時盯著地圖實例：圖層開關存在 AreaMap 裡，
// 換校區或學年學期時整塊換成骨架、AreaMap 卸載再重掛，新實例的開關回到預設；地圖還沒掛上（里界或 Leaflet 還在下載）
// 就切到托嬰時，那次呼叫也沒有對象。實例一出現就補一次；只有種類或實例改變才觸發，使用者手動關掉圖層後不會被反覆打開。
watch([nearbyKind, map], ([kind, instance]) => {
  if (kind === 'babycare') instance?.revealBabycare()
})

// 頁首的地址摘要與資料版本（組字在 areaPane.ts，工作台改版後搬到頁尾）。在籍清冊日期與收費學年先不放（傳 null），
// 畫面只差「有地址」→「參觀有地址」。
const summary = computed(() => (area.value ? addressSummary(area.value) : null))
const status = computed(() => (area.value ? dataStatusSegments(area.value, null, null) : null))

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
    <el-skeleton v-else-if="!area || !status || !summary" :rows="6" animated />
    <template v-else>
      <div class="area-head">
        <!-- 門牌資料還沒匯入時那句已經以句號結尾，兩段分開排，不接「。・」。 -->
        <p class="hint area-status">
          <span>{{ status.doorplate }}</span><span :class="{ 'area-status__next': !status.doorplateImported }">{{ status.doorplateImported ? '・' : '' }}{{ status.rest }}</span>
        </p>
        <p v-if="summary.text" class="area-summary">
          {{ summary.text }}<template v-if="summary.showLink">
            <el-button text size="small" aria-label="查看未定位到里的訪視明細" @click="openNoVillage">查看</el-button></template>{{ summary.tail }}
        </p>
        <p v-if="!area.totals.visit" class="empty-note area-empty">{{ emptyText }}</p>
        <p v-else-if="summary.noAddress" class="empty-note area-empty">{{ summary.noAddress }}</p>
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
            :babycare="babycare?.items ?? []"
            :radius-km="radiusKm"
            :narrow="narrow"
            :opportunity="opportunity"
            :opportunity-note="opportunityNote"
            :trends="trends"
            :trend-note="trendNote"
            :homes-note="homesNote"
            :enrolled="enrolled"
            :enrolled-note="enrolledNote"
            v-model:grade-filter="gradeFilter"
            @open-area="openPlace"
          />
        </div>
        <div class="area-top__side">
          <NearbyPanel
            v-model:kind="nearbyKind"
            v-model:radius-km="radiusKm"
            :kindergartens="kindergartens"
            :kindergartens-failed="kindergartensFailed"
            :babycare="babycare"
            :babycare-failed="babycareFailed"
            :peer-fees="peerFees"
            :peer-age="peerAge"
            @select-kindergarten="focusKindergarten"
            @select-babycare="focusBabycare"
            @retry-kindergartens="loadKindergartens()"
            @retry-babycare="loadBabycare()"
          />
          <ProviderChanges :data="changes" :failed="changesFailed" :radius-km="radiusKm" @retry="loadChanges()" />
        </div>
      </div>

      <EnrolledPanel
        :data="enrolled"
        :failed="enrolledFailed"
        :grade-filter="gradeFilter"
        :csv-name="csvName"
        @retry="loadEnrolled()"
      />
      <PeerFeesPanel v-model:age="peerAge" :data="peerFees" :failed="peerFeesFailed" :csv-name="csvName" @retry="loadPeerFees()" />
      <OpportunityPanel :data="opportunity" :failed="opportunityFailed" :csv-name="csvName" @retry="loadOpportunity()" />
      <VillageTrendsPanel :data="trends" :failed="trendsFailed" :csv-name="csvName" @retry="loadTrends()" />
      <SchoolDistrictPanel :data="trends" :failed="trendsFailed" :csv-name="csvName" />

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
          :caption="campusLocated ? '從家長地址的門牌量到本校的直線距離；沒填地址、只到區、未定位的訪視算在「無距離」。' : ''"
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

.area-top__side {
  display: grid;
  align-content: start;
  gap: 16px;
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
