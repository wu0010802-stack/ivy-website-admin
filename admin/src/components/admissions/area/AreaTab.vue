<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, ref, shallowRef, useId, watch } from 'vue'
import AreaSidePane from './AreaSidePane.vue'
import AreaTables from './AreaTables.vue'
import NearbyPanel from './NearbyPanel.vue'
import ChildrenYearSlider from './ChildrenYearSlider.vue'
import PointCard from './PointCard.vue'
import ProviderChanges from './ProviderChanges.vue'
import {
  getArea, getAreaBabycare, getAreaBoundaries, getAreaChanges, getAreaChildrenHistory, getAreaEnrolled, getAreaKindergartens, getAreaOpportunity, getAreaPeerFees,
  getAreaPoint, getAreaPresale, getAreaTrends, locateAreaAddress,
} from '../../../api/admissions'
import { ApiError } from '../../../api/client'
import { campusLabel } from '../../../api/labels'
import type {
  AdmissionsArea, AreaBabycare, AreaChanges, AreaChildrenHistory, AreaEnrolled, AreaKindergartens, AreaOpportunity, AreaPeerFees, AreaPoint, AreaPresale, AreaTrends,
  VillageBoundaries,
} from '../../../api/types'
import { areaQuery } from '../../../admissions/areaFilter'
import { DEFAULT_AREA_VIEW, isMapMode, round4, samePoint, type AreaTableTab, type AreaView } from '../../../admissions/areaView'
import { useNarrowScreen } from '../../../composables/useNarrowScreen'
import { useRequestSequence } from '../../../composables/useRequestSequence'
import {
  MAP_MODES, RADIUS_OPTIONS, enrolledMapNote, gradeOptions, homesMapNote, opportunityUnavailable, presaleMapNote, trendMapNote,
  type GradeFilter, type MapMode, type NearbyKind, type RadiusKm,
} from './areaFormat'
import {
  addressSummary, dataStatusText, defaultMapMode, modeNote, paneHead, rankingFor, resolveMapMode, type ModeNotes, type PaneData,
} from './areaPane'
import { childrenShade, childrenStops, resolveStop, retiredNote, stopKey, stopLabel, type YearStop } from './childrenHistory'
import { DEFAULT_PEER_AGE, type PeerAge } from './peerFeesFormat'
import { findFeature, villageFacts } from './villageFacts'

// 區域分析（2026-10-08 規格 9）：家長來源依行政區／里統計、里界地圖、附近幼兒園、距離分布。
// 2026-10-13 招生機會、2026-10-14 里的變化／托嬰與園所異動、2026-10-15 在籍學生與附近同業收費陸續加進來。
// 2026-10-16 改成地圖工作台（規格 docs/specs/2026-10-16-admissions-area-workbench-design.md）：由上而下是工具列（看什麼、範圍）→
// 工作台（地圖＋右欄：該模式的排行、選了里就是里卡片、同業模式是附近清單）→ 完整表格（六個分頁）→ 頁尾（地址摘要與資料版本）。
// 看什麼、選取的里、表格分頁放在 view（經 StatsTab 接網址）；範圍、名單種類、同業年齡、班別是畫面狀態，重掛回預設。
// 口徑同其他子分頁（頁首校區＋入學學年學期）；家長地址在後端以公開門牌資料比對，不送任何外部服務。
// 地圖（Leaflet）另切一個 chunk，點開這個子分頁才下載。
// chunk 載入失敗（常見於剛部署完、舊的 hash 檔已不存在）：重抓同一個檔救不回來，只能整頁重新載入；
// 工具列、右欄與表格不受影響（模式狀態因此放在這裡，不在地圖裡）。給 errorComponent（空元件）開發模式才不會把載入錯誤再丟出去；
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
// 地圖看什麼、選取的里、表格分頁（2026-10-16 規格 §5）：StatsTab 以 v-model:view 接到網址。
const view = defineModel<AreaView>('view', { default: () => ({ ...DEFAULT_AREA_VIEW }) })

// view 一律整個換掉（上層拿它寫網址，不能就地改上層的物件）；值都沒變就不寫（不多 emit 一次、不多寫一次網址）。
// v-model 由上層持有時，寫回去之後要等上層重畫，view.value 才是新的值：這裡靠的是每條程式路徑在同一個同步區段裡只寫一次
// （watcher 之間 Vue 會先跑上層的更新）。若有一個 handler 要連寫兩次，先把兩個改動合成一個 patch。
function patchView(patch: Partial<AreaView>) {
  const current = view.value
  // 圖釘座標是物件：比座標，不比參考（拖到同一格、同座標再放一次都不重寫網址）。
  const unchanged = (key: keyof AreaView) => (key === 'point' ? samePoint(patch.point ?? null, current.point) : patch[key] === current[key])
  if ((Object.keys(patch) as (keyof AreaView)[]).every(unchanged)) return
  view.value = { ...current, ...patch }
}

const narrow = useNarrowScreen()
// 工作台單欄（卡片在地圖下方）的斷點，和下面 .area-workbench 的 @media (min-width: 1200px) 互補：1199px 以下單欄。
const stacked = useNarrowScreen('(max-width: 1199px)')

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
// 工具列的「範圍」：el-radio-group 回報的是 string | number | boolean，只收 1、3、6，其他值不改半徑（不會變成對後端的 radius_km 請求）。
function setRadius(value: string | number | boolean | undefined) {
  const km = Number(value)
  if (km === 1 || km === 3 || km === 6) radiusKm.value = km
}
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

// 附近同業收費（2026-10-15 規格 7.1）：換校區、半徑、年齡都清空再讀，只採用最後一次的回應。清單的公告收費也用這份
// （同半徑、同年齡）。年齡存在這裡，換半徑時保留；換校區或學年學期時 StatsTab 整塊重掛（v-if），年齡回預設 3 歲。
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
// 「2–5 歲孩子」與「招生機會」停用時的原因；空字串＝可以用。讀取中不算用不了：換半徑時正在看招生機會的人，
// 不該跳回預設模式（地圖在資料回來前先不上色）。
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

// 「在建預售」停用的原因：預售建案沒匯入、本校沒座標、里的變化讀取失敗；出生、遷入遷出、新成屋沒匯入不影響它。
const presaleNote = computed(() => {
  if (trendsFailed.value) return '里的變化讀取失敗。'
  return trends.value ? presaleMapNote(trends.value) : ''
})

// 附近預售建案（2026-10-20 規格 P12）：地圖上的建案點與完整表格的清單；半徑同上，換校區或半徑都清空再讀、只採用最後一次的回應。
// 清單失敗只影響預售建案分頁與地圖上的點，各里的在建戶數（里的變化）照常。
const presale = ref<AreaPresale | null>(null)
const presaleFailed = ref(false)
const presaleRequests = useRequestSequence()
async function loadPresale() {
  const request = presaleRequests.begin()
  presale.value = null
  presaleFailed.value = false
  if (!props.campusKey) return
  try {
    const result = await getAreaPresale(props.campusKey, radiusKm.value)
    if (presaleRequests.isCurrent(request)) presale.value = result
  } catch {
    if (presaleRequests.isCurrent(request)) presaleFailed.value = true
  }
}
watch([() => props.campusKey, radiusKm], () => void loadPresale(), { immediate: true })

// 在籍學生（2026-10-15 規格 §6）：只依校區讀（清冊是某一天的快照，和學年學期、半徑無關）。
// 班別篩選放這裡：地圖、右欄排行與在籍學生分頁同步；換校區回到全部（新校不一定有同一班）。
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

// ---- 看什麼（規格 §2.1、D15）----

const notes = computed<ModeNotes>(() => ({
  enrolled: enrolledNote.value,
  opportunity: opportunityNote.value,
  trend: trendNote.value,
  homes: homesNote.value,
  presale: presaleNote.value,
  judged: opportunity.value?.baseline?.judged ?? null,
}))
const mapMode = computed(() => resolveMapMode(view.value.map, notes.value))

// ---- 2–5 歲孩子的年份滑桿（2026-11-16 規格 §5.3）----

// 歷年人口只在「2–5 歲孩子」模式才讀（進模式才發請求），換校區或半徑清空、只採用最後一次的回應。讀取失敗：沒有滑桿、
// 地圖與排行照用最新人數，原因寫在工具列下一行；讀取中同樣先用最新人數。
const childrenHistory = ref<AreaChildrenHistory | null>(null)
const childrenHistoryFailed = ref(false)
const childrenHistoryRequested = ref(false)
const childrenHistoryRequests = useRequestSequence()
async function loadChildrenHistory() {
  const request = childrenHistoryRequests.begin()
  childrenHistory.value = null
  childrenHistoryFailed.value = false
  childrenHistoryRequested.value = true
  if (!props.campusKey) return
  try {
    const result = await getAreaChildrenHistory(props.campusKey, radiusKm.value)
    if (childrenHistoryRequests.isCurrent(request)) childrenHistory.value = result
  } catch {
    if (childrenHistoryRequests.isCurrent(request)) childrenHistoryFailed.value = true
  }
}
watch([() => props.campusKey, radiusKm], () => {
  childrenHistoryRequests.begin()
  childrenHistory.value = null
  childrenHistoryFailed.value = false
  childrenHistoryRequested.value = false
  if (mapMode.value === 'children') void loadChildrenHistory()
})
watch(mapMode, (mode) => {
  if (mode === 'children' && (!childrenHistoryRequested.value || childrenHistoryFailed.value)) void loadChildrenHistory()
  // 年份只在這個模式有效：明寫了別的模式（網址帶 map）就把 year 拿掉。view.map 是 null 時模式是由資料狀況決定的預設，
  // 在籍名冊還在讀取時暫時是「在籍學生」、讀完才變成「2–5 歲孩子」，這時不能清（否則重新整理就弄丟網址的 year）。
  if (mode !== 'children' && view.value.year !== null && view.value.map !== null) patchView({ year: null })
}, { immediate: true })
// 有滑桿可拉：模式對、讀到了、本校有座標且九月表有資料。
const childrenHistoryReady = computed(() => {
  const data = childrenHistory.value
  return mapMode.value === 'children' && data !== null && data.unavailable === null && childrenStops(data).length > 0
})
const yearStops = computed<YearStop[]>(() => (childrenHistoryReady.value && childrenHistory.value ? childrenStops(childrenHistory.value) : []))
const childrenStop = computed(() => resolveStop(view.value.year, yearStops.value))
const yearLabels = computed<Record<string, string>>(() => {
  const data = childrenHistory.value
  return data ? Object.fromEntries(yearStops.value.map((stop) => [stopKey(stop), stopLabel(stop, data)])) : {}
})
const shade = computed(() => (childrenHistoryReady.value && childrenHistory.value ? childrenShade(childrenHistory.value, childrenStop.value) : null))
const retiredText = computed(() => (childrenHistoryReady.value && childrenHistory.value ? retiredNote(childrenHistory.value, childrenStop.value) : ''))
// 網址帶來的年份不在格子裡（怪年份、九月表沒有、換半徑後新範圍沒有）：畫面已經用最新，網址的 year 拿掉。
watch([yearStops, () => view.value.year], ([stops, year]) => {
  if (year !== null && stops.length && !stops.includes(year)) patchView({ year: null })
}, { immediate: true })
function setYear(stop: YearStop) {
  patchView({ year: stop === 'latest' ? null : stop })
}

const modeOptions = computed(() => MAP_MODES.map((option) => ({ ...option, disabled: Boolean(modeNote(option.value, notes.value)) })))
// 工具列下一行寫停用的原因：招生機會那兩種的原因排第一（同一個原因只寫一次，例如里的變化讀取失敗同時停用孩子增減與新屋交屋）。
// 原因那一行的 id：「看什麼」用 aria-describedby 指過去，讀屏聽到停用的選項時也聽得到為什麼（只有真的有原因才帶）。
const reasonId = useId()
const modeReasons = computed(() => [
  ...new Set(
    [
      notes.value.opportunity, modeNote('opportunity', notes.value), notes.value.trend, notes.value.homes, notes.value.presale,
      notes.value.enrolled, mapMode.value === 'children' && childrenHistoryFailed.value ? '歷年人口讀取失敗。' : '',
    ].filter(Boolean),
  ),
])
// 選的模式和這個校區當下的預設一樣就不寫進網址（view.map 為 null）；停用的模式點不到，handler 再擋一次。
function setMode(value: string | number | boolean | undefined) {
  if (!isMapMode(value) || modeNote(value, notes.value)) return
  // 換模式一律把年份拿掉（年份只屬於「2–5 歲孩子」），和 map 合成一個 patch。
  patchView({ map: value === defaultMapMode(notes.value) ? null : value, year: null })
}
// 正在看的模式變成停用，或網址帶來（含同一個畫面裡上一頁／下一頁換到）一個停用的模式：退回預設，網址拿掉 map。
// 讀取中不算停用，所以要等資料回來才會退。寫成 null 之後條件不再成立，不會來回觸發。
watch([notes, () => view.value.map], ([current, requested]) => {
  if (requested !== null && modeNote(requested, current)) patchView({ map: null })
}, { immediate: true })

// ---- 選取的里（規格 §2.4、§4、D7）----

// 網址帶來的里代碼：里界到了、裡面真的沒有這個代碼才從網址拿掉；里界還在讀（或讀取失敗）時不動，否則重新整理就會弄丟選取。
watch([boundaries, () => view.value.village], ([loaded, code]) => {
  if (loaded && code && !findFeature(loaded, code)) patchView({ village: '' })
}, { immediate: true })

const facts = computed(() => {
  const code = view.value.village
  if (!code || !boundaries.value || !area.value) return null
  return villageFacts(code, {
    boundaries: boundaries.value,
    area: area.value,
    opportunity: opportunity.value,
    opportunityFailed: opportunityFailed.value,
    trends: trends.value,
    trendsFailed: trendsFailed.value,
    enrolled: enrolled.value,
    enrolledFailed: enrolledFailed.value,
    kindergartens: kindergartens.value,
    radiusKm: radiusKm.value,
  })
})

type MapApi = {
  focusKindergarten: (id: string) => void
  focusBabycare: (id: string) => void
  revealBabycare: () => void
  focusVillage: (code: string) => void
  focusPoint: () => void
}
const map = ref<MapApi | null>(null)
// 地圖 chunk 載入失敗時，ref 可能接到的是空元件（不是地圖實例）：一律當成沒有地圖，不呼叫它（規格 §4）。
const mapApi = computed(() => (mapChunkFailed.value ? null : map.value))
const sidePane = ref<InstanceType<typeof AreaSidePane> | null>(null)
const sideEl = ref<HTMLElement | null>(null)
// 從地圖點的里才由右欄的 aria-live 報「已選取…」；從排行或表格選的是把焦點移到卡片標題，不重複報。
const announce = ref(false)

/**
 * 點地圖上的里：寫進 view，右欄換成里卡片；不搶焦點、不移地圖。單欄時（≤1199px）卡片在地圖下方，畫出來後捲過去（規格 §3.2、W14）：
 * 手機（≤720px）捲到卡片頂端（block start）；721–1199px 地圖還佔著大半個畫面，只在卡片不在視野裡時才捲（block nearest），地圖留在視野裡。
 * 已選取的里再點一次不取消、也不重寫網址，卡片可能已被捲出視野，所以照樣捲；另外讓報讀改成從地圖選的。
 */
async function selectFromMap({ code }: { code: string }) {
  announce.value = true
  if (code !== view.value.village) patchView({ village: code })
  if (!stacked.value) return
  await nextTick()
  sideEl.value?.scrollIntoView({ block: narrow.value ? 'start' : 'nearest' })
}
/** 從右欄排行或各里表選里：地圖移到那個里（不在視野裡才移），焦點移到卡片標題；手機把卡片捲上來（卡片在地圖下方）。 */
async function selectFromList(code: string) {
  announce.value = false
  patchView({ village: code })
  mapApi.value?.focusVillage(code)
  await sidePane.value?.focusCard()
  if (narrow.value) sideEl.value?.scrollIntoView({ block: 'start' })
}
/** 關掉里卡片（×、Esc）：回到排行；焦點留在右欄（卡片卸載後焦點不掉到 body）。 */
async function closeCard() {
  patchView({ village: '' })
  await nextTick()
  sideEl.value?.focus()
}

function focusKindergarten(id: string) {
  mapApi.value?.focusKindergarten(id)
}
function focusBabycare(id: string) {
  mapApi.value?.focusBabycare(id)
}
// 同業清單切到托嬰中心就打開地圖上的托嬰圖層（預設不勾，維持現有畫面）。同時盯著地圖實例：圖層開關存在 AreaMap 裡，
// 換校區或學年學期時整塊換成骨架、AreaMap 卸載再重掛，新實例的開關回到預設；地圖還沒掛上（里界或 Leaflet 還在下載）
// 就切到托嬰時，那次呼叫也沒有對象。實例一出現就補一次；只有種類或實例改變才觸發，使用者手動關掉圖層後不會被反覆打開。
watch([nearbyKind, mapApi], ([kind, instance]) => {
  if (kind === 'babycare') instance?.revealBabycare()
})

// ---- 地點（2026-11-20 規格 §5.1）：在地圖放圖釘或輸入地址，右欄看這一點與本校並排 ----

const placing = ref(false)
const pointCard = ref<InstanceType<typeof PointCard> | null>(null)
const pointData = ref<AreaPoint | null>(null)
const pointLoading = ref(false)
const pointFailed = ref(false)
const pointRequests = useRequestSequence()
// 換座標、半徑或校區：先清空（卡片骨架）再讀，只採用最後一次的回應。
async function loadPoint() {
  const request = pointRequests.begin()
  pointData.value = null
  pointFailed.value = false
  const target = view.value.point
  pointLoading.value = target !== null && Boolean(props.campusKey)
  if (!target || !props.campusKey) return
  try {
    const result = await getAreaPoint({ lat: target.lat, lng: target.lng, radiusKm: radiusKm.value, campusKey: props.campusKey })
    if (pointRequests.isCurrent(request)) pointData.value = result
  } catch {
    if (pointRequests.isCurrent(request)) pointFailed.value = true
  } finally {
    if (pointRequests.isCurrent(request)) pointLoading.value = false
  }
}
watch([() => view.value.point?.lat, () => view.value.point?.lng, radiusKm, () => props.campusKey], () => void loadPoint(), { immediate: true })

function togglePlacing() {
  placing.value = !placing.value
}
// 放點狀態按 Esc 取消（卡片的 Esc 只屬於里卡片，這裡不管卡片）。
function onPlacingKey(event: KeyboardEvent) {
  if (event.key === 'Escape') placing.value = false
}
watch(placing, (on) => {
  if (on) document.addEventListener('keydown', onPlacingKey)
  else document.removeEventListener('keydown', onPlacingKey)
})
onBeforeUnmount(() => document.removeEventListener('keydown', onPlacingKey))

/** 地圖點一下（放點狀態）或拖完圖釘：圖釘到那裡；放完就結束放點狀態，要調整直接拖。 */
function placePoint(next: { lat: number; lng: number }) {
  placing.value = false
  locateError.value = ''
  patchView({ point: next })
}
/** 清除圖釘：網址拿掉 pt、地址欄清空；焦點留在右欄。 */
async function clearPoint() {
  placing.value = false
  address.value = ''
  locateError.value = ''
  patchView({ point: null })
  await nextTick()
  sideEl.value?.focus()
}

const address = ref('')
const locating = ref(false)
const locateError = ref('')
const locateRequests = useRequestSequence()
// 後端 404 的 detail.reason：不在高雄、門牌對不上、門牌資料還沒匯入各有說法，其他一律「找不到這個地址」。
const LOCATE_REASONS: Record<string, string> = {
  outside_kaohsiung: '不在高雄市',
  no_doorplate: '找不到這個門牌',
  pending: '門牌資料尚未匯入',
}
function locateErrorText(error: unknown): string {
  if (error instanceof ApiError) {
    const detail = error.detail
    if (error.status === 404 && typeof detail === 'object' && detail !== null && 'reason' in detail && typeof detail.reason === 'string') {
      return LOCATE_REASONS[detail.reason] ?? '找不到這個地址'
    }
    if (error.status === 404) return '找不到這個地址'
    if (error.status === 422) return '請輸入正確的地址'
  }
  return '暫時查不到地址，請稍後再試'
}
async function findAddress() {
  const text = address.value.trim()
  if (!text) {
    locateError.value = '請輸入地址'
    return
  }
  const request = locateRequests.begin()
  locating.value = true
  locateError.value = ''
  try {
    const result = await locateAreaAddress(text)
    if (!locateRequests.isCurrent(request)) return
    placing.value = false
    patchView({ point: { lat: round4(result.lat), lng: round4(result.lng) } })
    await nextTick()
    mapApi.value?.focusPoint()
    pointCard.value?.focusTitle()
  } catch (error) {
    if (locateRequests.isCurrent(request)) locateError.value = locateErrorText(error)
  } finally {
    if (locateRequests.isCurrent(request)) locating.value = false
  }
}

// ---- 右欄（規格 §2.3、§2.5、D13）----

const paneData = computed<PaneData | null>(() =>
  area.value
    ? {
        boundaries: boundaries.value, area: area.value, opportunity: opportunity.value, trends: trends.value, enrolled: enrolled.value,
        gradeFilter: gradeFilter.value, peerFees: peerFees.value, emptyText: props.emptyText, radiusKm: radiusKm.value,
        childrenHistory: childrenHistoryReady.value ? childrenHistory.value : null, childrenStop: childrenStop.value,
      }
    : null,
)
const head = computed(() => (paneData.value ? paneHead(mapMode.value, paneData.value) : null))
const sections = computed(() => (paneData.value && mapMode.value !== 'peers' ? rankingFor(mapMode.value, paneData.value) : []))

// 表格分頁的重試（AreaTables 的 retry 帶來源）。
const loaders = {
  opportunity: loadOpportunity, trends: loadTrends, enrolled: loadEnrolled, peerFees: loadPeerFees, presale: loadPresale,
}

// 各模式的排行靠哪一份資料：讀取中畫骨架、讀取失敗寫那份資料原本的失敗句與重試。參觀用的是頁面一開始就讀到的區域分析，
// 同業的內容是清單（各自有狀態）。那份資料讀取失敗時模式本身會停用、退回預設，失敗句只是保底。
const paneSources = {
  enrolled: { data: enrolled, failed: enrolledFailed, load: loadEnrolled, text: '無法讀取在籍學生，請重新載入。' },
  opportunity: { data: opportunity, failed: opportunityFailed, load: loadOpportunity, text: '無法讀取招生機會，請重新載入。' },
  trends: { data: trends, failed: trendsFailed, load: loadTrends, text: '無法讀取里的變化，請重新載入。' },
}
const PANE_SOURCE: Record<MapMode, keyof typeof paneSources | null> = {
  enrolled: 'enrolled', children: 'opportunity', opportunity: 'opportunity', trend: 'trends', homes: 'trends', presale: 'trends', visits: null,
  peers: null,
}
const paneSource = computed(() => {
  const source = PANE_SOURCE[mapMode.value]
  return source ? paneSources[source] : null
})
const paneLoading = computed(() => Boolean(paneSource.value && !paneSource.value.data.value && !paneSource.value.failed.value))
const paneFailed = computed(() => (paneSource.value?.failed.value ? paneSource.value.text : ''))
function retryPane() {
  void paneSource.value?.load()
}
// 卡片某一段讀取失敗的重試：只重讀失敗的那份（成功的那份重讀會讓排行與表格白閃一次）。我們段的參觀來自區域分析，
// 它讀不到時整頁是錯誤畫面、不會有卡片，所以只需要重讀在籍。
function retryFacts(section: 'kids' | 'ours') {
  if (section === 'ours') {
    void loadEnrolled()
    return
  }
  if (opportunityFailed.value) void loadOpportunity()
  if (trendsFailed.value) void loadTrends()
}

const gradeChoices = computed(() => (enrolled.value?.status === 'ready' ? gradeOptions(enrolled.value) : []))
// el-radio-group 回報的是 string | number | boolean：只收選項裡的班別。
function setGrade(value: string | number | boolean | undefined) {
  const choice = gradeChoices.value.find((option) => option.value === value)
  if (choice) gradeFilter.value = choice.value
}

// ---- 表格分頁與頁尾（規格 §2.7、§2.9）----

function setTable(tab: AreaTableTab) {
  patchView({ table: tab })
}
function openPlace(placeArea: string) {
  emit('open-records', { area: placeArea })
}
function openNoVillage() {
  emit('open-records', { area: areaQuery({ kind: 'no_village' }) })
}
const footer = computed(() =>
  area.value ? { summary: addressSummary(area.value), status: dataStatusText(area.value, enrolled.value, peerFees.value) } : null,
)
</script>

<template>
  <div class="area">
    <el-alert v-if="failed" type="error" :closable="false" show-icon title="無法讀取區域分析，請重新載入。">
      <el-button size="small" @click="load()">重新載入</el-button>
    </el-alert>
    <el-skeleton v-else-if="!area || !head || !footer" :rows="6" animated />
    <template v-else>
      <!-- 工具列：看什麼（地圖著色與右欄的模式）在左、範圍（全頁共用：地圖半徑圈、清單、表格都跟著它）在右；
           停用的模式寫原因在下一行。兩組的可見標籤 aria-hidden，名稱由 radiogroup 的 aria-label 給，讀屏不重複。 -->
      <div class="area-toolbar">
        <div class="area-toolbar__group area-toolbar__modes">
          <span class="area-toolbar__label" aria-hidden="true">看什麼</span>
          <el-radio-group
            class="area-toolbar__mode-group"
            :model-value="mapMode"
            size="small"
            aria-label="看什麼"
            :aria-describedby="modeReasons.length ? reasonId : undefined"
            @update:model-value="setMode"
          >
            <el-radio-button v-for="option in modeOptions" :key="option.value" :value="option.value" :disabled="option.disabled">
              {{ option.label }}
            </el-radio-button>
          </el-radio-group>
        </div>
        <div class="area-toolbar__group area-toolbar__range">
          <span class="area-toolbar__label" aria-hidden="true">範圍</span>
          <el-radio-group :model-value="radiusKm" size="small" aria-label="範圍" @update:model-value="setRadius">
            <el-radio-button v-for="km in RADIUS_OPTIONS" :key="km" :value="km">{{ km }} 公里</el-radio-button>
          </el-radio-group>
        </div>
        <div v-if="childrenHistoryReady" class="area-toolbar__group area-toolbar__year">
          <span class="area-toolbar__label" aria-hidden="true">年份</span>
          <ChildrenYearSlider :stops="yearStops" :model-value="childrenStop" :labels="yearLabels" @update:model-value="setYear" />
        </div>
        <div class="area-toolbar__group area-toolbar__point">
          <span class="area-toolbar__label" aria-hidden="true">地點</span>
          <el-button size="small" :type="placing ? 'primary' : 'default'" :aria-pressed="placing ? 'true' : 'false'" @click="togglePlacing">
            放一個點
          </el-button>
          <form class="area-toolbar__locate" @submit.prevent="findAddress">
            <el-input v-model="address" class="area-toolbar__address" size="small" placeholder="輸入地址找位置" aria-label="地址" maxlength="100" />
            <el-button size="small" native-type="submit" :loading="locating">找</el-button>
          </form>
          <el-button v-if="view.point" class="area-toolbar__clear" size="small" @click="clearPoint">清除</el-button>
          <p v-if="placing" class="area-toolbar__locate-note" role="status">在地圖上點一下放圖釘，按 Esc 取消</p>
          <p v-if="locateError" class="area-toolbar__locate-note area-toolbar__locate-note--error" role="alert">{{ locateError }}</p>
        </div>
        <p v-if="modeReasons.length" :id="reasonId" class="area-toolbar__note">
          <span v-for="reason in modeReasons" :key="reason">{{ reason }}</span>
        </p>
      </div>

      <div class="area-workbench">
        <div class="area-workbench__map">
          <!-- 地圖還沒出來（里界在讀、讀取失敗、地圖 chunk 載不下來）：放在同樣的框裡，工作台不會只剩右欄半個框。 -->
          <div v-if="mapChunkFailed || boundariesFailed || !boundaries" class="area-workbench__placeholder">
            <el-alert v-if="mapChunkFailed" class="area-map-error" type="error" :closable="false" show-icon title="地圖沒有載入成功，請重新整理這一頁。">
              <el-button size="small" @click="reloadPage">重新整理</el-button>
            </el-alert>
            <el-alert v-else-if="boundariesFailed" class="area-map-error" type="error" :closable="false" show-icon title="里界載入失敗，地圖無法顯示。">
              <el-button size="small" @click="loadBoundaries()">重試</el-button>
            </el-alert>
            <el-skeleton v-else :rows="8" animated />
          </div>
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
            :mode="mapMode"
            :selected-code="view.village"
            :opportunity="opportunity"
            :trends="trends"
            :presale="presale"
            :enrolled="enrolled"
            :grade-filter="gradeFilter"
            :children-shade="shade"
            :point="view.point"
            :placing="placing"
            @select-village="selectFromMap"
            @place-point="placePoint"
          />
          <p v-if="retiredText" class="hint area-workbench__retired">{{ retiredText }}</p>
        </div>
        <!-- 右欄容器可程式聚焦（tabindex -1）：關掉里卡片後焦點落在這裡，不掉到 body；手機選了里捲到這裡（卡片在最上面）。 -->
        <div ref="sideEl" class="area-workbench__side" tabindex="-1">
          <AreaSidePane
            ref="sidePane"
            :head="head"
            :sections="sections"
            :loading="paneLoading"
            :failed="paneFailed"
            :facts="facts"
            :peers="mapMode === 'peers'"
            :point="view.point !== null"
            :narrow="narrow"
            :announce="announce"
            @select="selectFromList"
            @close="closeCard"
            @open-records="openPlace"
            @retry="retryPane"
            @retry-facts="retryFacts"
          >
            <template #point>
              <PointCard
                ref="pointCard"
                :data="pointData"
                :loading="pointLoading"
                :failed="pointFailed"
                :campus-name="campusLabel(campusKey)"
                :radius-km="radiusKm"
                @clear="clearPoint"
                @retry="loadPoint()"
              />
            </template>
            <template #head-extra>
              <el-radio-group
                v-if="mapMode === 'enrolled' && gradeChoices.length"
                class="area-grade"
                :model-value="gradeFilter"
                size="small"
                aria-label="在籍學生班別"
                @update:model-value="setGrade"
              >
                <el-radio-button v-for="option in gradeChoices" :key="option.value" :value="option.value">{{ option.label }}</el-radio-button>
              </el-radio-group>
            </template>
            <div class="area-peers">
              <NearbyPanel
                v-model:kind="nearbyKind"
                :radius-km="radiusKm"
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
          </AreaSidePane>
        </div>
      </div>

      <AreaTables
        v-model:peer-age="peerAge"
        :tab="view.table"
        :area="area"
        :trends="trends"
        :trends-failed="trendsFailed"
        :opportunity="opportunity"
        :opportunity-failed="opportunityFailed"
        :enrolled="enrolled"
        :enrolled-failed="enrolledFailed"
        :grade-filter="gradeFilter"
        :peer-fees="peerFees"
        :peer-fees-failed="peerFeesFailed"
        :presale="presale"
        :presale-failed="presaleFailed"
        :csv-name="csvName"
        :empty-text="emptyText"
        :boundaries="boundaries"
        @update:tab="setTable"
        @select-village="selectFromList"
        @open-records="emit('open-records', $event)"
        @retry="loaders[$event]()"
      />

      <!-- 頁尾（規格 §2.9）：參觀的地址摘要與資料版本，只當出處說明，不再放在頁首像所有數字都依學年。 -->
      <div class="area-footer">
        <p v-if="footer.summary.text" class="hint area-footer__summary">
          {{ footer.summary.text }}<template v-if="footer.summary.showLink">
            <el-button text size="small" aria-label="查看未定位到里的訪視明細" @click="openNoVillage">查看</el-button></template>{{ footer.summary.tail }}
        </p>
        <p v-else-if="footer.summary.noAddress" class="hint area-footer__summary">{{ footer.summary.noAddress }}</p>
        <p class="hint area-footer__status">{{ footer.status }}</p>
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

.area-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 16px;
  min-width: 0;
}

.area-toolbar__group {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.area-toolbar__range {
  margin-inline-start: auto;
}

.area-toolbar__year {
  flex: 1 1 100%;
}

.area-toolbar__point {
  flex: 1 1 100%;
  flex-wrap: wrap;
}

.area-toolbar__locate {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.area-toolbar__address {
  width: 240px;
  max-width: 100%;
}

.area-toolbar__locate-note {
  flex-basis: 100%;
  margin: 0;
  color: var(--ink-2);
  font-size: var(--text-sm);
}

.area-toolbar__locate-note--error {
  color: var(--el-color-danger);
}

.area-workbench__retired {
  margin: 8px 0 0;
}

.area-toolbar__label {
  flex: none;
  color: var(--ink-3);
  font-size: var(--text-sm);
}

.area-toolbar__note {
  display: flex;
  flex-basis: 100%;
  flex-wrap: wrap;
  gap: 4px 12px;
  margin: 0;
  color: var(--ink-2);
  font-size: var(--text-sm);
}

/* 工作台：1200px 以下單欄（地圖在上、右欄在下，右欄高度 auto 不內捲）；寬螢幕地圖與 380px 右欄並排（見下方 @media）。
   --area-map-canvas 是地圖畫布的高度（AreaMap 的畫布讀它；手機 AreaMap 自己改成 50vh），寬螢幕右欄跟著它算高度；
   --area-map-radius 是地圖框的圓角，和右欄用同一個圓角。 */
.area-workbench {
  --area-map-canvas: 620px;
  --area-map-radius: var(--radius-lg);
  display: grid;
  gap: 16px;
  min-width: 0;
}

.area-workbench > * {
  min-width: 0;
}

.area-workbench__placeholder {
  padding: 16px;
  border: 1px solid var(--line);
  border-radius: var(--area-map-radius);
  background: var(--surface);
}

.area-workbench__side {
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  background: var(--surface);
  /* 手機選了里捲到這裡：留出後台頂端列的高度，卡片標題不被蓋住。 */
  scroll-margin-top: calc(var(--top-h) + 16px);
}

.area-grade {
  margin: 4px 0;
}

.area-peers {
  display: grid;
  gap: 20px;
  padding: 4px 12px 0;
  min-width: 0;
}

.area-footer {
  display: grid;
  gap: 4px;
  padding-top: 12px;
  border-top: 1px solid var(--line);
}

.area-footer p {
  margin: 0;
}

/* 寬螢幕：地圖與右欄並排，看起來是同一個框——地圖框（或還沒有地圖時的佔位框）保留四邊框、只有左側圓角，
   右欄拿掉左邊框，地圖框的右邊框就是中間那一條線。右欄高度＝畫布＋地圖框上下各 1px 邊框，內容超出時欄內捲動
   （AreaSidePane 在這個寬度設 height:100%）。圖例在 AreaMap 裡，留在地圖框正下方。 */
@media (min-width: 1200px) {
  .area-workbench {
    --area-map-radius: var(--radius-lg) 0 0 var(--radius-lg);
    grid-template-columns: minmax(0, 1fr) 380px;
    align-items: start;
    gap: 0;
  }

  .area-workbench__placeholder {
    min-height: calc(var(--area-map-canvas) + 2px);
  }

  .area-workbench__side {
    height: calc(var(--area-map-canvas) + 2px);
    border-inline-start: 0;
    border-radius: 0 var(--radius-lg) var(--radius-lg) 0;
  }
}

/* 手機：看什麼一列橫捲、不換行也不縮字；範圍換到下一行（radio-button 最小高 44px 是全域規則）。 */
@media (max-width: 720px) {
  .area-toolbar__modes {
    flex: 1 1 100%;
    overflow-x: auto;
    /* 留一條細捲軸：看得出右邊還有模式。 */
    scrollbar-width: thin;
  }

  .area-toolbar__mode-group {
    flex-wrap: nowrap;
  }

  .area-toolbar__range {
    margin-inline-start: 0;
  }
}
</style>
