<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type * as Leaflet from 'leaflet'
import type {
  AdmissionsArea, AreaBabycareItem, AreaEnrolled, AreaEnrolledPoint, AreaKindergarten, AreaOpportunity, AreaOpportunityRow, AreaTrends,
  AreaTrendsVillage, AreaVillageRow, VillageBoundaries, VillageProperties,
} from '../../../api/types'
import { formatRate } from '../../../admissions/statsFormat'
import {
  KIDS_LEVEL_LABELS, KIND_LABELS, KIND_ORDER, MAP_MODES, babycareKindLabel, babycareMeta, babycareShortName,
  campusNotLocatedReason, districtBounds, enrolledLegendText, expectedText, formatCount, formatDistance, gradeOptions, homesCount, homesMax,
  kidsLevelTone, kidsNetText, kindLabel, legendRanges, levelOf, pointCount, pointPopupText, shortName, signalText, signalTone, signedCount,
  trendsPlaceName, villageKey,
  type GradeFilter, type MapMode, type RadiusKm,
} from './areaFormat'

// 區域分析的地圖（2026-10-08 規格 9.3）：國土測繪電子地圖當底圖，里界依參觀人數分 5 級著色，
// 標出本校、半徑虛線圓與附近幼兒園。Leaflet 的 fillColor 寫不了 CSS 變數，所以圖形只掛 class，
// 顏色由下面的 :deep 規則用 --area-* token 決定。分級或著色模式變了只換各里圖形的 class（restyleVillages）：
// Leaflet 只在建立圖形時套用 className（setStyle 不管它），整層重建 893 個里在手機上一次要好幾百 ms。
// Leaflet 與它的樣式只在這裡用動態 import 載入（掛載後才下載，不進主 bundle）；載不下來顯示重試。
// 圖磚請求只帶視野範圍，不帶家長資料；家長來源只以「里」為單位聚合。
// 2026-10-13 招生機會：著色可以切成「2–5 歲孩子」（半徑內依孩子數分 5 級）或「招生機會」（明顯偏少／差不多／
// 比附近多三色，孩子少與不判斷不上色），半徑外的里這兩種都不上色。招生機會資料用不了時（讀取中、人口沒匯入、
// 本校沒座標、讀取失敗）後兩種停用，opportunityNote 寫原因；讀取中（opportunity 是 null、沒有原因）照常可選，先不上色。
// 2026-10-14 里的變化：多一種「孩子增減」（這一年 2–5 歲孩子淨增的分級：增加兩級、減少兩級、差不多），里界調整
// 合併的組、孩子少、半徑外不上色。資料用不了時（讀取失敗、本校沒座標、淨增算不出來）停用，trendNote 寫原因。
// 2026-10-14 新屋交屋（B2 段）：近 4 季到里的新成屋筆數依半徑內最多的那一里分 5 級（同參觀人數的切法），0 筆、半徑外
// 不上色。里界調整合併的組，列上的數字是整組的，組內各里用各自的筆數上色（new_homes_by_code）。新成屋沒匯入、
// 本校沒座標、讀取失敗時停用，homesNote 寫原因。
// 2026-10-14 托嬰與園所異動：托嬰中心用菱形標點、獨立圖層（預設不勾）。
// 2026-10-15 在籍學生：第六種「在籍學生」不給里上色，改畫一層點（每格約 100 公尺一點，兩位以上畫大一級），班別用圖例上的
// 篩選鈕切換（gradeFilter 由 AreaTab 持有、和下方表格同步）。清冊沒匯入或讀取失敗時停用，enrolledNote 寫原因。
const props = withDefaults(
  defineProps<{
    boundaries: VillageBoundaries
    villages: readonly AreaVillageRow[]
    campus: AdmissionsArea['campus']
    campusName: string
    kindergartens: readonly AreaKindergarten[]
    babycare?: readonly AreaBabycareItem[]
    radiusKm: RadiusKm
    narrow: boolean
    opportunity?: AreaOpportunity | null
    /** 招生機會用不了的原因；空字串＝可以用。 */
    opportunityNote?: string
    trends?: AreaTrends | null
    /** 「孩子增減」用不了的原因；空字串＝可以用。 */
    trendNote?: string
    /** 「新屋交屋」用不了的原因；空字串＝可以用。 */
    homesNote?: string
    /** 在籍學生（2026-10-15 規格 §6）；沒讀到是 null。 */
    enrolled?: AreaEnrolled | null
    /** 「在籍學生」用不了的原因；空字串＝可以用。 */
    enrolledNote?: string
    /** 在籍學生的班別篩選（AreaTab 持有，和下方表格同步）。 */
    gradeFilter?: GradeFilter
  }>(),
  {
    babycare: () => [], opportunity: null, opportunityNote: '', trends: null, trendNote: '', homesNote: '',
    enrolled: null, enrolledNote: '', gradeFilter: 'all',
  },
)
const emit = defineEmits<{ 'open-area': [filter: { district: string; village: string }]; 'update:gradeFilter': [value: GradeFilter] }>()

const TILE_URL = 'https://wmts.nlsc.gov.tw/wmts/EMAP/default/GoogleMapsCompatible/{z}/{y}/{x}'
const TILE_ATTRIBUTION = '© 國土測繪中心'
// 視野：本校為中心、剛好框住半徑圈，四邊留一點空（圈線不貼邊）；本校沒座標時框住校址所在的行政區。
const VIEW_PADDING: [number, number] = [24, 24]
// 一張都沒載到、又連續失敗這麼多張，才當成底圖壞了（偶發失敗 Leaflet 自己會再試）。
const TILE_FAILURE_LIMIT = 4
const STAR_SVG =
  '<svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true"><path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6-4.9-4.6 6.6-.8z"/></svg>'
const DIAMOND_SVG = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M8 1l7 7-7 7-7-7z"/></svg>'

type LeafletModule = typeof Leaflet

const container = ref<HTMLElement | null>(null)
// 地圖物件不放進響應式：Leaflet 自己管狀態，包成 proxy 只會拖慢。
let L: LeafletModule | null = null
let map: Leaflet.Map | null = null
// 建這張地圖用的容器：remove() 失敗後要清它身上 Leaflet 留的記號（見 destroyMap）。
let mapElement: (HTMLElement & { _leaflet_id?: number }) | null = null
let tiles: Leaflet.TileLayer | null = null
let villageLayer: Leaflet.GeoJSON | null = null
let campusMarker: Leaflet.Marker | null = null
let radiusCircle: Leaflet.Circle | null = null
let kindergartenGroup: Leaflet.LayerGroup | null = null
const kindergartenMarkers = new Map<string, Leaflet.CircleMarker>()
let babycareGroup: Leaflet.LayerGroup | null = null
const babycareMarkers = new Map<string, Leaflet.Marker>()
// 在籍學生的點（2026-10-15）：只在「在籍學生」模式加到地圖上；後加的圖層畫在上面，點蓋過幼兒園。
let enrolledGroup: Leaflet.LayerGroup | null = null
let resizeObserver: ResizeObserver | null = null

const showKindergartens = ref(true)
// 托嬰中心圖層預設不勾（維持現有畫面）；卡片切到托嬰中心或點清單某一列時自動打開。
const showBabycare = ref(false)
// 手機上地圖能不能拖曳縮放；桌機一直可以。
const interactive = ref(!props.narrow)
// loading：Leaflet 還在下載；library：下載或建立地圖失敗；tiles：底圖圖磚一直載不到。
const loading = ref(true)
const failure = ref<'library' | 'tiles' | null>(null)
let tileErrors = 0
let tilesLoaded = 0

const villageStats = computed(() => ({
  max: Math.max(0, ...props.villages.map((row) => row.visit)),
  byKey: new Map(props.villages.map((row) => [villageKey(row.district, row.village), row])),
}))
// 招生機會的列以里代碼對（後端回 village_code，里界屬性有 VILLCODE）。
const opportunityStats = computed(() => {
  const rows = props.opportunity?.villages ?? []
  return {
    maxChildren: Math.max(0, ...rows.map((row) => row.children)),
    byCode: new Map(rows.map((row) => [row.village_code, row])),
    // 半徑內但人口表沒有的里：沒有列，也不是半徑外。
    noPopulation: new Map((props.opportunity?.no_population_villages ?? []).map((item) => [item.village_code, item])),
  }
})
// 里的變化的列以里代碼對：合併組的每個代碼都指到同一列。
const trendStats = computed(() => {
  const byCode = new Map<string, AreaTrendsVillage>()
  for (const row of props.trends?.villages ?? []) for (const code of row.codes) byCode.set(code, row)
  return byCode
})
// 新屋交屋的分級用半徑內各里自己的筆數的最大值。
const homesMaxValue = computed(() => homesMax(props.trends?.villages ?? []))
const mode = ref<MapMode>('visits')
function modeNote(value: MapMode): string {
  if (value === 'visits') return ''
  if (value === 'enrolled') return props.enrolledNote
  if (value === 'homes') return props.homesNote
  return value === 'trend' ? props.trendNote : props.opportunityNote
}
const modeOptions = computed(() => MAP_MODES.map((option) => ({ ...option, disabled: Boolean(modeNote(option.value)) })))
// 切換列旁邊寫停用的原因：招生機會那兩種的原因優先（同一個原因時只寫一次）。
const modeNotes = computed(() => [...new Set([props.opportunityNote, props.trendNote, props.homesNote, props.enrolledNote].filter(Boolean))])
const modeLabel = computed(() => MAP_MODES.find((option) => option.value === mode.value)!.label)
const gradeChoices = computed(() => (props.enrolled?.status === 'ready' ? gradeOptions(props.enrolled) : []))
const enrolledLegend = computed(() =>
  props.enrolled?.status === 'ready' ? enrolledLegendText(props.enrolled, props.gradeFilter) : null,
)
const canvasLabel = computed(() => {
  if (mode.value === 'enrolled') return `${props.campusName}周邊在籍學生住處地圖（每格約 100 公尺標一點）；同樣的資料在下方的在籍學生表`
  const table = mode.value === 'visits' ? '里排行' : mode.value === 'trend' || mode.value === 'homes' ? '里的變化表' : '招生機會表'
  return `${props.campusName}周邊里界地圖（依${modeLabel.value}著色）；同樣的資料在下方的${table}與幼兒園清單`
})
const legend = computed(() =>
  legendRanges(
    mode.value === 'children' ? opportunityStats.value.maxChildren : mode.value === 'homes' ? homesMaxValue.value : villageStats.value.max,
  ),
)
const legendUnit = computed(() => (mode.value === 'children' ? '位' : mode.value === 'homes' ? '筆' : '人'))
const noneText = computed(() =>
  mode.value === 'children'
    ? '半徑內的里沒有 2–5 歲孩子的資料。'
    : mode.value === 'homes'
      ? '半徑內近 4 季沒有新屋交屋。'
      : '這個範圍還沒有定位到里的參觀。',
)
const kindLegend = KIND_ORDER.map((kind) => ({ kind, label: KIND_LABELS[kind] }))
const campusLocated = computed(() => props.campus.lat !== null && props.campus.lng !== null)
// 校址所在行政區的外框（後端從地址文字解析，不需要門牌）；里界檔沒有這個區時為 null。
const districtBox = computed(() => districtBounds(props.boundaries, props.campus.district))
const campusNote = computed(() => {
  if (campusLocated.value) return ''
  const reason = campusNotLocatedReason(props.campus.locate_error)
  const note = reason ? `本校位置未標示（${reason}）` : '本校位置未標示'
  return districtBox.value ? `${note}，地圖先顯示${props.campus.district}。` : `${note}。`
})

function villageRow(properties: VillageProperties): AreaVillageRow | undefined {
  return villageStats.value.byKey.get(villageKey(properties.TOWNNAME, properties.VILLNAME))
}

function opportunityRow(properties: VillageProperties): AreaOpportunityRow | undefined {
  return opportunityStats.value.byCode.get(properties.VILLCODE)
}

/** 里的 class：依目前的著色模式。分級 l0 與招生機會、孩子增減的 none 都是不上色。 */
function villageClass(properties: VillageProperties): string {
  if (mode.value === 'enrolled') return 'area-village area-village--l0'
  if (mode.value === 'visits') return `area-village area-village--l${levelOf(villageRow(properties)?.visit ?? 0, villageStats.value.max)}`
  if (mode.value === 'trend') {
    const row = trendStats.value.get(properties.VILLCODE)
    const tone = row && !row.merged ? kidsLevelTone(row.kids_level) : 'none'
    return tone === 'none' ? 'area-village area-village--l0' : `area-village area-village--${tone}`
  }
  if (mode.value === 'homes') {
    const row = trendStats.value.get(properties.VILLCODE)
    return row ? `area-village area-village--l${levelOf(homesCount(row, properties.VILLCODE), homesMaxValue.value)}` : 'area-village area-village--l0'
  }
  const row = opportunityRow(properties)
  if (mode.value === 'children') return `area-village area-village--l${levelOf(row?.children ?? 0, opportunityStats.value.maxChildren)}`
  const tone = row ? signalTone(row.signal) : 'none'
  return tone === 'none' ? 'area-village area-village--l0' : `area-village area-village--${tone}`
}

function popupLine(text: string): HTMLParagraphElement {
  const line = document.createElement('p')
  line.textContent = text
  return line
}

// 2–5 歲孩子、招生機會兩種模式的彈出框：孩子數、參觀與應有、判讀；半徑外的里寫不在範圍內，
// 半徑內但人口表沒有的里寫沒有人口資料（不能說成不在範圍內）。
function opportunityLines(properties: VillageProperties): HTMLParagraphElement[] {
  if (!props.opportunity) return [popupLine('招生機會讀取中…')]
  const row = opportunityRow(properties)
  if (!row) {
    const missing = opportunityStats.value.noPopulation.get(properties.VILLCODE)
    if (missing) return [popupLine('這個里沒有人口資料，沒有算進附近平均'), popupLine(`參觀 ${formatCount(missing.visit)} 位`)]
    return [popupLine(`不在本校 ${props.opportunity?.radius_km ?? props.radiusKm} 公里內`)]
  }
  const expected = row.expected === null ? '' : `，照附近應有${expectedText(row.expected)}`
  return [
    popupLine(`2–5 歲 ${formatCount(row.children)} 位・0–1 歲 ${formatCount(row.infants)} 位`),
    popupLine(`參觀 ${formatCount(row.visit)} 位（${formatRate(row.rate)}）${expected}`),
    popupLine(signalText(row)),
  ]
}

// 孩子增減模式的彈出框：孩子數與一年前、淨增與分級、出生與淨遷入；合併組先寫和哪些里合併，數字是整組的。
function trendLines(properties: VillageProperties): HTMLParagraphElement[] {
  if (!props.trends) return [popupLine('里的變化讀取中…')]
  const row = trendStats.value.get(properties.VILLCODE)
  if (!row) return [popupLine(`不在本校 ${props.trends.radius_km} 公里內`)]
  const lines: HTMLParagraphElement[] = []
  if (row.merged) lines.push(popupLine(`里界調整過，和同區的里合併計算：${trendsPlaceName(row)}`))
  if (row.children !== null) {
    const before = row.kids_base === null ? '' : `（一年前 1–4 歲 ${formatCount(row.kids_base)} 位）`
    lines.push(popupLine(`2–5 歲 ${formatCount(row.children)} 位${before}`))
  }
  if (row.kids_net !== null) lines.push(popupLine(`這一年淨增 ${kidsNetText(row)}・${KIDS_LEVEL_LABELS[row.kids_level]}`))
  const births = row.births_12m === null ? '' : `近 12 個月出生 ${formatCount(row.births_12m)} 位`
  const moves = row.migration_net_12m === null ? '' : `淨遷入 ${signedCount(row.migration_net_12m)} 人`
  if (births || moves) lines.push(popupLine([births, moves].filter(Boolean).join('・')))
  return lines.length ? lines : [popupLine('這個里還沒有資料')]
}

// 新屋交屋模式的彈出框：近 4 季與最近一季的筆數；合併組先寫和哪些里合併，再寫這個里自己的筆數與整組的筆數。
function homesLines(properties: VillageProperties): HTMLParagraphElement[] {
  if (!props.trends) return [popupLine('里的變化讀取中…')]
  const row = trendStats.value.get(properties.VILLCODE)
  if (!row) return [popupLine(`不在本校 ${props.trends.radius_km} 公里內`)]
  const lines: HTMLParagraphElement[] = []
  if (row.merged) lines.push(popupLine(`里界調整過，和同區的里合併計算：${trendsPlaceName(row)}`))
  if (row.new_homes === null) return [...lines, popupLine('新成屋資料尚未匯入')]
  const latest = props.trends.sources.new_homes.latest
  if (row.merged) {
    lines.push(popupLine(`近 4 季新屋交屋 ${formatCount(homesCount(row, properties.VILLCODE))} 筆（整組 ${formatCount(row.new_homes)} 筆）`))
    if (latest) lines.push(popupLine(`最近一季（${latest}）整組 ${formatCount(row.new_homes_latest ?? 0)} 筆`))
    return lines
  }
  lines.push(popupLine(`近 4 季新屋交屋 ${formatCount(row.new_homes)} 筆`))
  if (latest) lines.push(popupLine(`最近一季（${latest}）${formatCount(row.new_homes_latest ?? 0)} 筆`))
  return lines
}

// 在籍學生模式的里彈出框：這個里依目前篩選的在籍人數。
function enrolledVillageLines(properties: VillageProperties): HTMLParagraphElement[] {
  const row = props.enrolled?.villages.find((item) => item.village_code === properties.VILLCODE)
  const count = row ? pointCount(row.counts, props.gradeFilter) : 0
  return [popupLine(count ? `在籍 ${formatCount(count)} 位` : '這個里沒有在籍學生')]
}

// 彈出框用 DOM 組，不用 HTML 字串（名稱一律走 textContent）。
function villagePopup(properties: VillageProperties): HTMLElement {
  const row = villageRow(properties)
  const root = document.createElement('div')
  root.className = 'area-popup'
  const title = document.createElement('strong')
  title.textContent = `${properties.TOWNNAME}${properties.VILLNAME}`
  const lines =
    mode.value === 'visits'
      ? [popupLine(row ? `參觀 ${row.visit}・預繳 ${row.deposit}（${formatRate(row.visit_to_deposit_rate)}）` : '這個範圍沒有參觀')]
      : mode.value === 'enrolled'
        ? enrolledVillageLines(properties)
        : mode.value === 'trend'
          ? trendLines(properties)
          : mode.value === 'homes'
            ? homesLines(properties)
            : opportunityLines(properties)
  root.append(title, ...lines)
  if (mode.value !== 'enrolled' && row && row.visit > 0) {
    const link = document.createElement('button')
    link.type = 'button'
    link.className = 'area-popup__link'
    link.textContent = '查看明細'
    link.addEventListener('click', () => emit('open-area', { district: properties.TOWNNAME, village: properties.VILLNAME }))
    root.append(link)
  }
  return root
}

// hover 提示：Leaflet 的字串內容走 innerHTML，里名來自匯入的外部資料，所以一律給文字節點。
function villageTooltip(properties: VillageProperties): HTMLElement {
  const root = document.createElement('span')
  root.textContent = `${properties.TOWNNAME}${properties.VILLNAME}`
  return root
}

function kindergartenPopup(item: AreaKindergarten): HTMLElement {
  const root = document.createElement('div')
  root.className = 'area-popup'
  const title = document.createElement('strong')
  title.textContent = shortName(item.name)
  const line = document.createElement('p')
  const capacity = item.approved_capacity === null ? '' : `・核定 ${item.approved_capacity} 人`
  line.textContent = `${item.is_own ? '本機構' : kindLabel(item.kind)}・${formatDistance(item.distance_m)}${capacity}`
  root.append(title, line)
  return root
}

function babycarePopup(item: AreaBabycareItem): HTMLElement {
  const root = document.createElement('div')
  root.className = 'area-popup'
  const title = document.createElement('strong')
  title.textContent = babycareShortName(item.name)
  root.append(title, popupLine(`${babycareKindLabel(item.kind)}・${babycareMeta(item)}`))
  if (item.phone) root.append(popupLine(item.phone))
  return root
}

function drawVillages() {
  if (!L || !map) return
  villageLayer?.remove()
  villageLayer = L.geoJSON(props.boundaries, {
    style: (feature) => ({
      className: feature ? villageClass(feature.properties as VillageProperties) : 'area-village area-village--l0',
      weight: 1,
    }),
    onEachFeature: (feature, layer) => {
      const properties = feature.properties as VillageProperties
      layer.bindPopup(() => villagePopup(properties))
      if (!props.narrow) layer.bindTooltip(villageTooltip(properties), { sticky: true, direction: 'top' })
    },
  }).addTo(map)
  // 里界壓在最底下：半徑圓與幼兒園點畫在同一個 SVG 裡，要在上面。
  villageLayer.bringToBack()
}

// 資料或著色模式變了：不重建圖層，逐一換掉各里 SVG 圖形的 class（沒變的不動）。options.className 一起改，
// Leaflet 之後重建這個圖形（移出再加回地圖）時也是新的 class。彈出框在打開時才組，本來就讀目前的資料與模式。
function restyleVillages() {
  villageLayer?.eachLayer((layer) => {
    const path = layer as Leaflet.Path & { feature?: GeoJSON.Feature }
    const next = path.feature ? villageClass(path.feature.properties as VillageProperties) : 'area-village area-village--l0'
    const current = path.options.className ?? ''
    if (next === current) return
    path.options.className = next
    const element = path.getElement()
    if (!element) return
    element.classList.remove(...current.split(' ').filter(Boolean))
    element.classList.add(...next.split(' '))
  })
}

function drawCampus() {
  if (!L || !map) return
  campusMarker?.remove()
  radiusCircle?.remove()
  campusMarker = null
  radiusCircle = null
  const { lat, lng } = props.campus
  if (lat === null || lng === null) return
  campusMarker = L.marker([lat, lng], {
    icon: L.divIcon({ className: 'area-campus', html: STAR_SVG, iconSize: [28, 28], iconAnchor: [14, 14] }),
    title: props.campusName,
    alt: props.campusName,
    keyboard: false,
    zIndexOffset: 1000,
  }).addTo(map)
  radiusCircle = L.circle([lat, lng], {
    radius: props.radiusKm * 1000, className: 'area-radius', fill: false, interactive: false, dashArray: '6 6', weight: 2,
  }).addTo(map)
}

// 有座標：框住半徑圈（直徑見方）；沒座標：框住校址所在的區；連區都不知道才看整個里界（半個南台灣）。
function fitInitialView() {
  if (!L || !map) return
  const { lat, lng } = props.campus
  if (lat !== null && lng !== null) map.fitBounds(L.latLng(lat, lng).toBounds(props.radiusKm * 2000), { padding: VIEW_PADDING })
  else if (districtBox.value) map.fitBounds(districtBox.value)
  else if (villageLayer) map.fitBounds(villageLayer.getBounds())
}

function drawKindergartens() {
  const group = kindergartenGroup
  if (!L || !group) return
  group.clearLayers()
  kindergartenMarkers.clear()
  for (const item of props.kindergartens) {
    const kind = item.is_own ? 'own' : item.kind
    const marker = L.circleMarker([item.lat, item.lng], { radius: item.is_own ? 8 : 6, className: `area-kg area-kg--${kind}`, weight: 1.5 })
    marker.bindPopup(() => kindergartenPopup(item))
    group.addLayer(marker)
    kindergartenMarkers.set(item.source_id, marker)
  }
  raiseEnrolled()
}

function setShowKindergartens(value: boolean) {
  showKindergartens.value = value
  if (!map || !kindergartenGroup) return
  if (value) map.addLayer(kindergartenGroup)
  else map.removeLayer(kindergartenGroup)
  raiseEnrolled()
}

/** 清單點一列：地圖移到該園並打開資訊。 */
function focusKindergarten(id: string) {
  const marker = kindergartenMarkers.get(id)
  if (!map || !marker) return
  if (!showKindergartens.value) setShowKindergartens(true)
  map.setView(marker.getLatLng(), Math.max(map.getZoom(), 15))
  marker.openPopup()
}

function drawBabycare() {
  const group = babycareGroup
  if (!L || !group) return
  group.clearLayers()
  babycareMarkers.clear()
  for (const item of props.babycare) {
    const marker = L.marker([item.lat, item.lng], {
      icon: L.divIcon({ className: 'area-bc', html: DIAMOND_SVG, iconSize: [16, 16], iconAnchor: [8, 8] }),
      title: item.name,
      alt: item.name,
      keyboard: false,
    })
    marker.bindPopup(() => babycarePopup(item))
    group.addLayer(marker)
    babycareMarkers.set(item.source_id, marker)
  }
}

function enrolledPopup(point: AreaEnrolledPoint): HTMLElement {
  const root = document.createElement('div')
  root.className = 'area-popup'
  root.append(popupLine(pointPopupText(point.counts, props.gradeFilter)))
  return root
}

// 每格一個點（後端已依取整座標合併）；依篩選只畫有人的格，兩位以上畫大一級。
function drawEnrolled() {
  const group = enrolledGroup
  if (!L || !group) return
  group.clearLayers()
  for (const point of props.enrolled?.points ?? []) {
    const count = pointCount(point.counts, props.gradeFilter)
    if (count === 0) continue
    const marker = L.circleMarker([point.lat, point.lng], {
      radius: count > 1 ? 7 : 5,
      className: count > 1 ? 'area-enrolled area-enrolled--multi' : 'area-enrolled',
      weight: 1.5,
    })
    marker.bindPopup(() => enrolledPopup(point))
    group.addLayer(marker)
  }
}

// 規格 §6：學生的點要在最上層。Leaflet 的 SVG 依加入順序疊（後加的在上面），幼兒園圖層重畫或重新加回地圖
// （換半徑、開關、清單點一列）就會蓋過學生的點，所以在「在籍學生」模式下每次都把學生的點再拉到最前面。
function raiseEnrolled() {
  if (mode.value !== 'enrolled' || !enrolledGroup) return
  enrolledGroup.eachLayer((layer) => (layer as Leaflet.CircleMarker).bringToFront())
}

function syncEnrolledLayer() {
  if (!map || !enrolledGroup) return
  if (mode.value === 'enrolled') map.addLayer(enrolledGroup)
  else map.removeLayer(enrolledGroup)
  raiseEnrolled()
}

function setShowBabycare(value: boolean) {
  showBabycare.value = value
  if (!map || !babycareGroup) return
  if (value) map.addLayer(babycareGroup)
  else map.removeLayer(babycareGroup)
}

/** 卡片切到托嬰中心：打開圖層（已經開著就不動）。 */
function revealBabycare() {
  if (!showBabycare.value) setShowBabycare(true)
}

/** 托嬰清單點一列：地圖移到該點並打開資訊（圖層沒開就先打開）。 */
function focusBabycare(id: string) {
  const marker = babycareMarkers.get(id)
  if (!map || !marker) return
  revealBabycare()
  map.setView(marker.getLatLng(), Math.max(map.getZoom(), 15))
  marker.openPopup()
}
defineExpose({ focusKindergarten, focusBabycare, revealBabycare })

function setInteractive(value: boolean) {
  interactive.value = value
  if (!map) return
  for (const handler of [map.dragging, map.touchZoom]) {
    if (value) handler.enable()
    else handler.disable()
  }
}

function onTileLoad() {
  tilesLoaded++
  if (failure.value === 'tiles') failure.value = null
}

function onTileError() {
  tileErrors++
  if (tilesLoaded === 0 && tileErrors >= TILE_FAILURE_LIMIT) failure.value = 'tiles'
}

function retryTiles() {
  tileErrors = 0
  tilesLoaded = 0
  failure.value = null
  tiles?.redraw()
}

// 先把狀態清乾淨再移除地圖：remove() 就算丟錯，重試也不會碰到舊的半成品。
function destroyMap() {
  const current = map
  const element = mapElement
  // 圖磚層的監聽拿掉：remove() 之後飛來的 tileload／tileerror 不能再動到下一張地圖的計數與提示。
  tiles?.off('tileload', onTileLoad)
  tiles?.off('tileerror', onTileError)
  resizeObserver?.disconnect()
  resizeObserver = null
  L = null
  map = null
  mapElement = null
  tiles = null
  villageLayer = null
  campusMarker = null
  radiusCircle = null
  kindergartenGroup = null
  kindergartenMarkers.clear()
  babycareGroup = null
  babycareMarkers.clear()
  enrolledGroup = null
  try {
    current?.remove()
  } catch (error) {
    // remove() 做到一半丟錯：容器上的 _leaflet_id 還在、半拆的圖層節點也還在，重試時 L.map() 會丟
    // "Map container is already initialized."（真 Leaflet 才會，mock 看不到）。把記號與殘留節點清掉。
    if (element) {
      delete element._leaflet_id
      element.replaceChildren()
    }
    throw error
  }
}

function buildMap(leaflet: LeafletModule, element: HTMLElement) {
  L = leaflet
  tileErrors = 0
  tilesLoaded = 0
  mapElement = element
  map = leaflet.map(element, {
    zoomControl: true,
    scrollWheelZoom: false,
    dragging: !props.narrow,
    touchZoom: !props.narrow,
    minZoom: 8,
    maxZoom: 18,
  })
  map.attributionControl.setPrefix(false)
  // 先有視野再加圖層：地圖還沒有視野時，Leaflet 把「加圖層」都排到 load 事件、依登記順序執行；
  // 半徑圓一加就先建好向量圖層共用的 renderer、排在里界與幼兒園點之後，那兩種圖層先被加進還沒
  // 初始化的 renderer 而丟 TypeError（真瀏覽器才會發生，mock 看不到）。視野要靠里界圖層本身算
  // （本校沒座標、也不知道在哪一區）時沒有半徑圓，等里界畫好再取。
  const viewFirst = campusLocated.value || districtBox.value !== null
  if (viewFirst) fitInitialView()
  tiles = leaflet.tileLayer(TILE_URL, { attribution: TILE_ATTRIBUTION, maxZoom: 18 })
  tiles.on('tileload', onTileLoad)
  tiles.on('tileerror', onTileError)
  tiles.addTo(map)
  kindergartenGroup = leaflet.layerGroup().addTo(map)
  babycareGroup = leaflet.layerGroup()
  if (showBabycare.value) babycareGroup.addTo(map)
  enrolledGroup = leaflet.layerGroup()
  drawVillages()
  drawCampus()
  drawKindergartens()
  drawBabycare()
  drawEnrolled()
  syncEnrolledLayer()
  if (!viewFirst) fitInitialView()
  // 子分頁切走再切回來時容器尺寸會變，Leaflet 要重算。子分頁切走是 v-show 藏起來（容器 0×0），
  // 藏著的時候重建的地圖 fitBounds 是在 0×0 裡算的（縮到最小級）：容器從沒尺寸變回有尺寸，視野要重取。
  if (typeof ResizeObserver !== 'undefined') {
    const current = map
    const sized = (width: number, height: number) => width > 0 && height > 0
    let hidden = !sized(element.clientWidth, element.clientHeight)
    resizeObserver = new ResizeObserver((entries) => {
      const box = entries.at(-1)?.contentRect
      const visible = box ? sized(box.width, box.height) : sized(element.clientWidth, element.clientHeight)
      current.invalidateSize()
      if (visible && hidden) fitInitialView()
      hidden = !visible
    })
    resizeObserver.observe(element)
  }
}

// Leaflet 與樣式分開載：樣式不進全站 CSS，只跟著這個元件下載。
async function startMap() {
  failure.value = null
  loading.value = true
  try {
    const [leaflet] = await Promise.all([import('leaflet'), import('leaflet/dist/leaflet.css')])
    // 載入期間已經離開（卸載會清掉 ref）：不建地圖。
    if (!container.value) return
    buildMap(leaflet, container.value)
  } catch (error) {
    // 沒有家長資料牽涉在內（載入或建圖階段），可以直接記錄。
    console.error('[AreaMap] 地圖建立失敗', error)
    try {
      destroyMap()
    } catch (cleanupError) {
      console.error('[AreaMap] 清除未完成的地圖失敗', cleanupError)
    }
    failure.value = 'library'
  } finally {
    loading.value = false
  }
}

function retry() {
  if (failure.value === 'tiles') retryTiles()
  else void startMap()
}

onMounted(() => void startMap())

watch(() => props.boundaries, drawVillages)
watch([() => props.villages, () => props.opportunity, () => props.trends, mode], restyleVillages)
// 正在看的模式變得用不了（換校區後人口未匯入、讀取失敗）：退回參觀人數，不留在畫不出東西的模式。讀取中不退。
watch([() => props.opportunityNote, () => props.trendNote, () => props.homesNote, () => props.enrolledNote], () => {
  if (modeNote(mode.value)) mode.value = 'visits'
})
// 座標分開當來源：refetch 換了 campus 物件但點沒動時不重設視野（使用者的縮放與拖曳要留著）。
watch([() => props.campus.lat, () => props.campus.lng], () => {
  drawCampus()
  fitInitialView()
})
// 換半徑是使用者自己按的：視野跟著框住新的圈。本校沒座標時沒有圈，視野不動。
watch(() => props.radiusKm, (km) => {
  if (!radiusCircle) return
  radiusCircle.setRadius(km * 1000)
  fitInitialView()
})
watch(() => props.kindergartens, drawKindergartens)
watch(() => props.babycare, drawBabycare)
watch([() => props.enrolled, () => props.gradeFilter], drawEnrolled)
watch(mode, syncEnrolledLayer)
watch(() => props.narrow, (narrow) => {
  setInteractive(!narrow)
  // 里名的 hover 提示只在桌機綁，換版面要重綁。
  drawVillages()
})

onBeforeUnmount(destroyMap)
</script>

<template>
  <section class="area-map" aria-label="區域地圖">
    <div class="area-map__frame">
      <!-- Leaflet 的容器可以用鍵盤聚焦，要有名稱；地圖不是唯一的路徑，同樣的數字在下方的表格與清單。 -->
      <div ref="container" class="area-map__canvas" role="group" :aria-label="canvasLabel" />
      <!-- 常駐的 status 區域：動態插入的 live region 常被讀屏漏掉，所以元素一直在，只換文字。 -->
      <p class="area-map__loading" role="status">{{ loading ? '地圖載入中…' : '' }}</p>
      <div v-if="failure" class="area-map__notice" role="alert">
        <span>{{ failure === 'tiles' ? '底圖載入失敗。' : '地圖載入失敗，請重試或重新整理頁面。' }}</span>
        <el-button size="small" @click="retry">重試</el-button>
      </div>
      <el-button
        v-if="narrow && !loading && failure !== 'library'"
        class="area-map__move"
        size="small"
        :type="interactive ? 'primary' : 'default'"
        :aria-label="interactive ? '完成移動地圖' : undefined"
        @click="setInteractive(!interactive)"
      >
        {{ interactive ? '完成' : '移動地圖' }}
      </el-button>
    </div>
    <div class="area-map__modes">
      <el-radio-group v-model="mode" size="small" aria-label="地圖著色">
        <el-radio-button v-for="option in modeOptions" :key="option.value" :value="option.value" :disabled="option.disabled">
          {{ option.label }}
        </el-radio-button>
      </el-radio-group>
      <span v-for="note in modeNotes" :key="note" class="area-map__mode-note">{{ note }}</span>
    </div>
    <div class="area-map__legend">
      <div v-if="mode === 'enrolled'" class="area-legend area-legend--enrolled">
        <el-radio-group
          v-if="gradeChoices.length"
          :model-value="gradeFilter"
          size="small"
          aria-label="在籍學生班別"
          @update:model-value="emit('update:gradeFilter', $event as GradeFilter)"
        >
          <el-radio-button v-for="option in gradeChoices" :key="option.value" :value="option.value">{{ option.label }}</el-radio-button>
        </el-radio-group>
        <p v-if="enrolledLegend" class="area-map__enrolled-note">
          <span class="area-dot area-dot--enrolled" aria-hidden="true" />{{ enrolledLegend.lead }}
        </p>
        <p v-if="enrolledLegend?.unplaced" class="area-map__enrolled-note">{{ enrolledLegend.unplaced }}</p>
      </div>
      <ul v-else-if="mode === 'trend'" class="area-legend area-legend--signals" aria-label="孩子增減圖例">
        <li><span class="area-swatch area-swatch--up2" aria-hidden="true" />增加多</li>
        <li><span class="area-swatch area-swatch--up1" aria-hidden="true" />增加</li>
        <li><span class="area-swatch area-swatch--flat" aria-hidden="true" />差不多</li>
        <li><span class="area-swatch area-swatch--down1" aria-hidden="true" />減少</li>
        <li><span class="area-swatch area-swatch--down2" aria-hidden="true" />減少多</li>
        <li><span class="area-swatch area-swatch--l0" aria-hidden="true" />孩子少、里界調整、在半徑外或沒有資料</li>
      </ul>
      <ul v-else-if="mode === 'opportunity'" class="area-legend area-legend--signals" aria-label="招生機會圖例">
        <li><span class="area-swatch area-swatch--chance" aria-hidden="true" />明顯偏少</li>
        <li><span class="area-swatch area-swatch--typical" aria-hidden="true" />差不多</li>
        <li><span class="area-swatch area-swatch--strong" aria-hidden="true" />比附近多</li>
        <li><span class="area-swatch area-swatch--l0" aria-hidden="true" />孩子少、還不判斷、在半徑外或沒有人口資料</li>
      </ul>
      <ul v-else-if="legend.length" class="area-legend area-legend--levels" :aria-label="`${modeLabel}圖例`">
        <li v-for="item in legend" :key="item.level">
          <span class="area-swatch" :class="`area-swatch--l${item.level}`" aria-hidden="true" />{{ item.label }} {{ legendUnit }}
        </li>
        <li v-if="mode === 'homes'"><span class="area-swatch area-swatch--l0" aria-hidden="true" />0 筆或在半徑外</li>
      </ul>
      <p v-else class="area-map__none">{{ noneText }}</p>
      <div class="area-legend area-legend--kinds">
        <el-switch
          :model-value="showKindergartens"
          aria-label="在地圖上顯示幼兒園"
          active-text="幼兒園"
          @update:model-value="setShowKindergartens(Boolean($event))"
        />
        <ul v-if="showKindergartens" class="area-legend" aria-label="幼兒園類型圖例">
          <li v-for="item in kindLegend" :key="item.kind"><span class="area-dot" :class="`area-dot--${item.kind}`" aria-hidden="true" />{{ item.label }}</li>
          <li><span class="area-dot area-dot--own" aria-hidden="true" />本機構</li>
        </ul>
      </div>
      <div class="area-legend area-legend--kinds">
        <el-switch
          :model-value="showBabycare"
          aria-label="在地圖上顯示托嬰中心"
          active-text="托嬰中心"
          @update:model-value="setShowBabycare(Boolean($event))"
        />
        <ul v-if="showBabycare" class="area-legend" aria-label="托嬰中心圖例">
          <li><span class="area-dot area-dot--babycare" aria-hidden="true" />托嬰中心與托育家園</li>
        </ul>
      </div>
      <p v-if="campusNote" class="area-map__campus-note">{{ campusNote }}</p>
    </div>
  </section>
</template>

<style scoped>
.area-map {
  display: grid;
  gap: 8px;
  min-width: 0;
}

.area-map__frame {
  position: relative;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: var(--radius);
}

.area-map__canvas {
  height: 520px;
  background: var(--surface-2);
  /* Leaflet 預設用 Helvetica，里名與彈出框的中文要跟後台一致。 */
  font-family: inherit;
}

.area-map__loading {
  position: absolute;
  inset: 0;
  z-index: 500;
  display: grid;
  place-items: center;
  margin: 0;
  color: var(--ink-2);
  font-size: var(--text-sm);
  pointer-events: none;
}

.area-map__notice {
  position: absolute;
  inset: 12px 12px auto;
  z-index: 500;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 12px;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--ink);
}

.area-map__move {
  position: absolute;
  right: 10px;
  bottom: 28px;
  z-index: 500;
}

.area-map__legend {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px 16px;
  color: var(--ink-2);
  font-size: var(--text-sm);
}

.area-map__none,
.area-map__campus-note {
  margin: 0;
}

.area-map__campus-note {
  flex-basis: 100%;
}

.area-legend {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 12px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.area-legend li {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.area-swatch {
  width: 14px;
  height: 14px;
  border: 1px solid var(--area-boundary);
  border-radius: 3px;
}

.area-swatch--l0 { background: var(--surface); }
.area-swatch--l1 { background: var(--area-level-1); }
.area-swatch--l2 { background: var(--area-level-2); }
.area-swatch--l3 { background: var(--area-level-3); }
.area-swatch--l4 { background: var(--area-level-4); }
.area-swatch--l5 { background: var(--area-level-5); }
.area-swatch--chance { background: var(--area-chance); }
.area-swatch--typical { background: var(--area-level-1); }
.area-swatch--strong { background: var(--area-level-4); }
.area-swatch--up2 { background: var(--area-level-4); }
.area-swatch--up1 { background: var(--area-level-2); }
.area-swatch--flat { background: var(--area-level-1); }
.area-swatch--down1 { background: var(--area-down-1); }
.area-swatch--down2 { background: var(--area-down-2); }

.area-map__modes {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 12px;
}

.area-map__mode-note {
  color: var(--ink-2);
  font-size: var(--text-sm);
}

.area-dot {
  width: 10px;
  height: 10px;
  border: 1px solid var(--surface);
  border-radius: 50%;
}

.area-dot--public { background: var(--area-kind-public); }
.area-dot--nonprofit { background: var(--area-kind-nonprofit); }
.area-dot--quasi_public { background: var(--area-kind-quasi-public); }
.area-dot--private { background: var(--area-kind-private); }
.area-dot--own { background: var(--area-kind-own); border-color: var(--area-kind-own-ink); }

.area-dot--babycare {
  width: 9px;
  height: 9px;
  border-radius: 0;
  background: var(--area-kind-babycare);
  transform: rotate(45deg);
}

.area-legend--enrolled {
  display: grid;
  flex-basis: 100%;
  gap: 6px;
}

.area-map__enrolled-note {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin: 0;
}

.area-dot--enrolled { background: var(--area-enrolled); }

/* Leaflet 畫的 SVG：CSS 屬性蓋過 Leaflet 寫的 presentation attribute。
   0 級填透明但仍有 fill（visiblePainted），點得到、看得到 hover 里名。 */
.area-map :deep(.area-village) {
  fill: var(--surface);
  fill-opacity: 0;
  stroke: var(--area-boundary);
  stroke-opacity: 0.8;
  stroke-width: 0.6;
}

.area-map :deep(.area-village--l1) { fill: var(--area-level-1); fill-opacity: 0.6; }
.area-map :deep(.area-village--l2) { fill: var(--area-level-2); fill-opacity: 0.6; }
.area-map :deep(.area-village--l3) { fill: var(--area-level-3); fill-opacity: 0.6; }
.area-map :deep(.area-village--l4) { fill: var(--area-level-4); fill-opacity: 0.6; }
.area-map :deep(.area-village--l5) { fill: var(--area-level-5); fill-opacity: 0.6; }
.area-map :deep(.area-village--chance) { fill: var(--area-chance); fill-opacity: 0.65; }
.area-map :deep(.area-village--typical) { fill: var(--area-level-1); fill-opacity: 0.6; }
.area-map :deep(.area-village--strong) { fill: var(--area-level-4); fill-opacity: 0.6; }
.area-map :deep(.area-village--up2) { fill: var(--area-level-4); fill-opacity: 0.6; }
.area-map :deep(.area-village--up1) { fill: var(--area-level-2); fill-opacity: 0.6; }
.area-map :deep(.area-village--flat) { fill: var(--area-level-1); fill-opacity: 0.6; }
.area-map :deep(.area-village--down1) { fill: var(--area-down-1); fill-opacity: 0.65; }
.area-map :deep(.area-village--down2) { fill: var(--area-down-2); fill-opacity: 0.65; }

.area-map :deep(.area-radius) {
  stroke: var(--area-radius);
  stroke-width: 2;
}

.area-map :deep(.area-kg) {
  fill-opacity: 1;
  stroke: var(--surface);
}

.area-map :deep(.area-kg--public) { fill: var(--area-kind-public); }
.area-map :deep(.area-kg--nonprofit) { fill: var(--area-kind-nonprofit); }
.area-map :deep(.area-kg--quasi_public) { fill: var(--area-kind-quasi-public); }
.area-map :deep(.area-kg--private) { fill: var(--area-kind-private); }
.area-map :deep(.area-kg--own) { fill: var(--area-kind-own); stroke: var(--area-kind-own-ink); }

.area-map :deep(.area-enrolled) {
  fill: var(--area-enrolled);
  fill-opacity: 0.85;
  stroke: var(--surface);
}

.area-map :deep(.area-bc svg path) {
  fill: var(--area-kind-babycare);
  stroke: var(--surface);
  stroke-width: 1.5;
}

.area-map :deep(.area-campus svg path) {
  fill: var(--area-kind-own);
  stroke: var(--area-kind-own-ink);
  stroke-width: 1.5;
}

.area-map :deep(.area-popup) {
  display: grid;
  gap: 4px;
  color: var(--ink);
  font-size: var(--text-sm);
}

.area-map :deep(.area-popup p) {
  margin: 0;
  color: var(--ink-2);
}

.area-map :deep(.area-popup__link) {
  justify-self: start;
  padding: 0;
  border: 0;
  background: none;
  color: var(--el-color-primary);
  font: inherit;
  text-decoration: underline;
  cursor: pointer;
}

@media (max-width: 720px) {
  .area-map__canvas {
    height: 50vh;
    min-height: 280px;
  }
}
</style>
