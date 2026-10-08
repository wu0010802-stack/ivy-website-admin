<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type * as Leaflet from 'leaflet'
import type { AdmissionsArea, AreaKindergarten, AreaVillageRow } from '../../../api/types'
import { formatRate } from '../../../admissions/statsFormat'
import {
  KIND_LABELS, KIND_ORDER, formatDistance, kindLabel, legendRanges, levelOf, shortName, villageKey,
  type RadiusKm, type VillageBoundaries, type VillageProperties,
} from './areaFormat'

// 區域分析的地圖（2026-10-08 規格 9.3）：國土測繪電子地圖當底圖，里界依參觀人數分 5 級著色，
// 標出本校、半徑虛線圓與附近幼兒園。Leaflet 的 fillColor 寫不了 CSS 變數，所以圖形只掛 class，
// 顏色由下面的 :deep 規則用 --area-* token 決定；分級變了整層重畫（class 只在建立時套用）。
// Leaflet 與它的樣式只在這裡用動態 import 載入（掛載後才下載，不進主 bundle）；載不下來顯示重試。
// 圖磚請求只帶視野範圍，不帶家長資料；家長來源只以「里」為單位聚合。
const props = defineProps<{
  boundaries: VillageBoundaries
  villages: readonly AreaVillageRow[]
  campus: AdmissionsArea['campus']
  campusName: string
  kindergartens: readonly AreaKindergarten[]
  radiusKm: RadiusKm
  narrow: boolean
}>()
const emit = defineEmits<{ 'open-area': [filter: { district: string; village: string }] }>()

const TILE_URL = 'https://wmts.nlsc.gov.tw/wmts/EMAP/default/GoogleMapsCompatible/{z}/{y}/{x}'
const TILE_ATTRIBUTION = '© 國土測繪中心'
// 初始視野：本校為中心、半徑 6 公里（12 公里見方）。
const INITIAL_SPAN_M = 12_000
// 一張都沒載到、又連續失敗這麼多張，才當成底圖壞了（偶發失敗 Leaflet 自己會再試）。
const TILE_FAILURE_LIMIT = 4
const STAR_SVG =
  '<svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true"><path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6-4.9-4.6 6.6-.8z"/></svg>'
// 本校沒標在地圖上時寫原因（主控裁定 R8）。
const CAMPUS_NOT_LOCATED: Record<string, string> = {
  no_address: '找不到本校地址',
  pending: '門牌資料尚未匯入',
  no_doorplate: '本校地址比對不到門牌',
}

type LeafletModule = typeof Leaflet
type GeoJsonInput = Parameters<LeafletModule['geoJSON']>[0]

const container = ref<HTMLElement | null>(null)
// 地圖物件不放進響應式：Leaflet 自己管狀態，包成 proxy 只會拖慢。
let L: LeafletModule | null = null
let map: Leaflet.Map | null = null
let tiles: Leaflet.TileLayer | null = null
let villageLayer: Leaflet.GeoJSON | null = null
let campusMarker: Leaflet.Marker | null = null
let radiusCircle: Leaflet.Circle | null = null
let kindergartenGroup: Leaflet.LayerGroup | null = null
const kindergartenMarkers = new Map<string, Leaflet.CircleMarker>()
let resizeObserver: ResizeObserver | null = null

const showKindergartens = ref(true)
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
const legend = computed(() => legendRanges(villageStats.value.max))
const kindLegend = KIND_ORDER.map((kind) => ({ kind, label: KIND_LABELS[kind] }))
const campusNote = computed(() => {
  if (props.campus.lat !== null && props.campus.lng !== null) return ''
  const reason = CAMPUS_NOT_LOCATED[props.campus.locate_error ?? '']
  return reason ? `本校位置未標示（${reason}）` : '本校位置未標示'
})

function villageRow(properties: VillageProperties): AreaVillageRow | undefined {
  return villageStats.value.byKey.get(villageKey(properties.TOWNNAME, properties.VILLNAME))
}

// 彈出框用 DOM 組，不用 HTML 字串（名稱一律走 textContent）。
function villagePopup(properties: VillageProperties): HTMLElement {
  const row = villageRow(properties)
  const root = document.createElement('div')
  root.className = 'area-popup'
  const title = document.createElement('strong')
  title.textContent = `${properties.TOWNNAME}${properties.VILLNAME}`
  const line = document.createElement('p')
  line.textContent = row ? `參觀 ${row.visit}・預繳 ${row.deposit}（${formatRate(row.visit_to_deposit_rate)}）` : '這個範圍沒有參觀'
  root.append(title, line)
  if (row && row.visit > 0) {
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

function drawVillages() {
  if (!L || !map) return
  villageLayer?.remove()
  const { max } = villageStats.value
  villageLayer = L.geoJSON(props.boundaries as unknown as GeoJsonInput, {
    style: (feature) => {
      const row = feature ? villageRow(feature.properties as VillageProperties) : undefined
      return { className: `area-village area-village--l${levelOf(row?.visit ?? 0, max)}`, weight: 1 }
    },
    onEachFeature: (feature, layer) => {
      const properties = feature.properties as VillageProperties
      layer.bindPopup(() => villagePopup(properties))
      if (!props.narrow) layer.bindTooltip(villageTooltip(properties), { sticky: true, direction: 'top' })
    },
  }).addTo(map)
  // 里界壓在最底下：半徑圓與幼兒園點畫在同一個 SVG 裡，要在上面。
  villageLayer.bringToBack()
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

function fitInitialView() {
  if (!L || !map) return
  const { lat, lng } = props.campus
  if (lat !== null && lng !== null) map.fitBounds(L.latLng(lat, lng).toBounds(INITIAL_SPAN_M))
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
}

function setShowKindergartens(value: boolean) {
  showKindergartens.value = value
  if (!map || !kindergartenGroup) return
  if (value) map.addLayer(kindergartenGroup)
  else map.removeLayer(kindergartenGroup)
}

/** 清單點一列：地圖移到該園並打開資訊。 */
function focusKindergarten(id: string) {
  const marker = kindergartenMarkers.get(id)
  if (!map || !marker) return
  if (!showKindergartens.value) setShowKindergartens(true)
  map.setView(marker.getLatLng(), Math.max(map.getZoom(), 15))
  marker.openPopup()
}
defineExpose({ focusKindergarten })

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
  resizeObserver?.disconnect()
  resizeObserver = null
  L = null
  map = null
  tiles = null
  villageLayer = null
  campusMarker = null
  radiusCircle = null
  kindergartenGroup = null
  kindergartenMarkers.clear()
  current?.remove()
}

function buildMap(leaflet: LeafletModule, element: HTMLElement) {
  L = leaflet
  tileErrors = 0
  tilesLoaded = 0
  map = leaflet.map(element, {
    zoomControl: true,
    scrollWheelZoom: false,
    dragging: !props.narrow,
    touchZoom: !props.narrow,
    minZoom: 8,
    maxZoom: 18,
  })
  map.attributionControl.setPrefix(false)
  tiles = leaflet.tileLayer(TILE_URL, { attribution: TILE_ATTRIBUTION, maxZoom: 18 })
  tiles.on('tileload', onTileLoad)
  tiles.on('tileerror', onTileError)
  tiles.addTo(map)
  kindergartenGroup = leaflet.layerGroup().addTo(map)
  drawVillages()
  drawCampus()
  drawKindergartens()
  fitInitialView()
  // 子分頁切走再切回來時容器尺寸會變，Leaflet 要重算。
  if (typeof ResizeObserver !== 'undefined') {
    const current = map
    resizeObserver = new ResizeObserver(() => current.invalidateSize())
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

watch(() => [props.boundaries, props.villages], drawVillages)
// 座標分開當來源：refetch 換了 campus 物件但點沒動時不重設視野（使用者的縮放與拖曳要留著）。
watch([() => props.campus.lat, () => props.campus.lng], () => {
  drawCampus()
  fitInitialView()
})
watch(() => props.radiusKm, (km) => radiusCircle?.setRadius(km * 1000))
watch(() => props.kindergartens, drawKindergartens)
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
      <div ref="container" class="area-map__canvas" />
      <p v-if="loading" class="area-map__loading" role="status">地圖載入中…</p>
      <div v-if="failure" class="area-map__notice" role="alert">
        <span>{{ failure === 'tiles' ? '底圖載入失敗。' : '地圖載入失敗，請重試或重新整理頁面。' }}</span>
        <el-button size="small" @click="retry">重試</el-button>
      </div>
      <el-button v-if="narrow && !loading && failure !== 'library'" class="area-map__move" size="small" :type="interactive ? 'primary' : 'default'" @click="setInteractive(!interactive)">
        {{ interactive ? '完成' : '移動地圖' }}
      </el-button>
    </div>
    <div class="area-map__legend">
      <ul v-if="legend.length" class="area-legend area-legend--levels" aria-label="參觀人數圖例">
        <li v-for="item in legend" :key="item.level">
          <span class="area-swatch" :class="`area-swatch--l${item.level}`" aria-hidden="true" />{{ item.label }} 人
        </li>
      </ul>
      <p v-else class="area-map__none">這個範圍還沒有定位到里的參觀。</p>
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

.area-swatch--l1 { background: var(--area-level-1); }
.area-swatch--l2 { background: var(--area-level-2); }
.area-swatch--l3 { background: var(--area-level-3); }
.area-swatch--l4 { background: var(--area-level-4); }
.area-swatch--l5 { background: var(--area-level-5); }

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
