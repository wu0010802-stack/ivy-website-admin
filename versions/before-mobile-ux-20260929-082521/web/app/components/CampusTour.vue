<script setup lang="ts">
import type { Campus } from '~/types/site-content'
import { isGeneratedTourScenes } from '~/types/site-content'
import { responsiveTourImage } from '~/utils/tour-image'
import { noscriptImage } from '~/utils/noscript-image'

const props = defineProps<{ campus: Campus }>()

const isGenerated = computed(() => isGeneratedTourScenes(props.campus.tourScenes))
const scenes = computed(() => (isGeneratedTourScenes(props.campus.tourScenes) ? [] : props.campus.tourScenes))

const sceneIndex = ref(0)
const spotIndex = ref(0)
const zoom = ref(1)
const panX = ref(0)
const panY = ref(0)
const isDragging = ref(false)
const isExpanded = ref(false)
const imageReady = ref(false)

const currentScene = computed(() => scenes.value[sceneIndex.value])
const currentSpot = computed(() => currentScene.value?.spots[spotIndex.value])
const mainImage = computed(() => responsiveTourImage(
  currentScene.value?.image ?? '',
  '(max-width: 760px) calc(100vw - 40px), (max-width: 1100px) 55vw, 860px',
  isExpanded.value || zoom.value > 1,
  currentScene.value?.imageMedia
))
const thumbnailSizes = '(max-width: 760px) 28vw, (max-width: 1100px) 16vw, 260px'

const areaEl = ref<HTMLDivElement | null>(null)
const dialogEl = ref<HTMLDialogElement | null>(null)
const expandBtnEl = ref<HTMLButtonElement | null>(null)
const tabRefs = ref<HTMLButtonElement[]>([])
const spotTitleEl = ref<HTMLHeadingElement | null>(null)

const zoomPercent = computed(() => Math.round(zoom.value * 100))
const zoomHelp = computed(() => (zoom.value > 1 ? '拖曳照片，或用方向鍵移動' : '點選標記，認識這個空間'))
const canvasStyle = computed(() => ({
  transform: `translate(${panX.value}px,${panY.value}px) scale(${zoom.value})`
}))
const pinScale = computed(() => `${1 / zoom.value}`)

function clampPan() {
  const area = areaEl.value
  if (!area) return
  const maxX = (area.clientWidth * (zoom.value - 1)) / 2
  const maxY = (area.clientHeight * (zoom.value - 1)) / 2
  panX.value = Math.max(-maxX, Math.min(maxX, panX.value))
  panY.value = Math.max(-maxY, Math.min(maxY, panY.value))
}

function setZoom(next: number) {
  zoom.value = Math.min(2, Math.max(1, next))
  if (zoom.value === 1) {
    panX.value = 0
    panY.value = 0
  }
  clampPan()
}

function onZoomAction(action: 'in' | 'out' | 'reset') {
  const wasDisabled = action === 'in' ? zoom.value >= 2 : action === 'out' ? zoom.value <= 1 : false
  setZoom(action === 'reset' ? 1 : zoom.value + (action === 'in' ? 0.5 : -0.5))
  if (wasDisabled) areaEl.value?.focus({ preventScroll: true })
}

function selectSpot(index: number, focusDetail = false) {
  spotIndex.value = index
  if (focusDetail) {
    nextTick(() => {
      spotTitleEl.value?.focus({ preventScroll: true })
      if (window.matchMedia('(max-width: 760px)').matches) {
        spotTitleEl.value?.scrollIntoView({ block: 'nearest', behavior: 'instant' })
      }
    })
  }
}

function selectScene(index: number, focusTab = false) {
  sceneIndex.value = index
  spotIndex.value = 0
  zoom.value = 1
  panX.value = 0
  panY.value = 0
  if (focusTab) nextTick(() => tabRefs.value[index]?.focus({ preventScroll: true }))
}

function onTabKeydown(event: KeyboardEvent, i: number) {
  const total = scenes.value.length
  let next: number | undefined
  if (event.key === 'ArrowRight') next = (i + 1) % total
  else if (event.key === 'ArrowLeft') next = (i - 1 + total) % total
  else if (event.key === 'Home') next = 0
  else if (event.key === 'End') next = total - 1
  if (next !== undefined) {
    event.preventDefault()
    selectScene(next, true)
  }
}

let drag: { id: number; x: number; y: number; panX: number; panY: number } | null = null

function onAreaPointerdown(event: PointerEvent) {
  if (zoom.value === 1 || (event.target as HTMLElement).closest('button')) return
  drag = { id: event.pointerId, x: event.clientX, y: event.clientY, panX: panX.value, panY: panY.value }
  areaEl.value?.setPointerCapture(event.pointerId)
  isDragging.value = true
}

function onAreaPointermove(event: PointerEvent) {
  if (!drag || event.pointerId !== drag.id) return
  panX.value = drag.panX + (event.clientX - drag.x)
  panY.value = drag.panY + (event.clientY - drag.y)
  clampPan()
}

function endDrag() {
  drag = null
  isDragging.value = false
}

const PAN_STEP = 40
const ARROW_DIRECTIONS: Record<string, [number, number]> = {
  ArrowLeft: [PAN_STEP, 0],
  ArrowRight: [-PAN_STEP, 0],
  ArrowUp: [0, PAN_STEP],
  ArrowDown: [0, -PAN_STEP]
}

function onAreaKeydown(event: KeyboardEvent) {
  if (zoom.value === 1) return
  const direction = ARROW_DIRECTIONS[event.key]
  if (!direction) return
  event.preventDefault()
  panX.value += direction[0]
  panY.value += direction[1]
  clampPan()
}

function openExpanded() {
  imageReady.value = true
  isExpanded.value = true
  nextTick(() => {
    zoom.value = 1
    panX.value = 0
    panY.value = 0
    dialogEl.value?.showModal()
  })
}

function onDialogClose() {
  isExpanded.value = false
  nextTick(() => expandBtnEl.value?.focus({ preventScroll: true }))
}

function toggleExpanded() {
  if (isExpanded.value) dialogEl.value?.close()
  else openExpanded()
}

let resizeObserver: ResizeObserver | null = null
let imageObserver: IntersectionObserver | null = null
onMounted(() => {
  if (areaEl.value && typeof IntersectionObserver !== 'undefined') {
    imageObserver = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return
      imageReady.value = true
      imageObserver?.disconnect()
    }, { rootMargin: '200px' })
    imageObserver.observe(areaEl.value)
  } else imageReady.value = true
  if (areaEl.value) {
    resizeObserver = new ResizeObserver(clampPan)
    resizeObserver.observe(areaEl.value)
  }
})
onUnmounted(() => {
  resizeObserver?.disconnect()
  imageObserver?.disconnect()
})

watch(
  () => props.campus.key,
  () => {
    sceneIndex.value = 0
    spotIndex.value = 0
    zoom.value = 1
    panX.value = 0
    panY.value = 0
  }
)
</script>

<template>
  <section class="section tour-section" id="environment" aria-labelledby="tour-heading" data-cta-entry="campus_tour">
    <div class="container">
      <div class="section-heading">
        <div>
          <span class="eyebrow">校園探索</span>
          <h2 class="section-title" id="tour-heading">先走進校園，<br>再想像孩子的日常。</h2>
        </div>
        <p>點一下照片上的標記，<br>從你最感興趣的地方開始。</p>
      </div>

      <div v-if="isGenerated" class="tour-todo-notice">
        <p>
          {{ campus.name }}的巡覽內容目前只有校園外觀單一場景，是由通用模板產生，尚未有逐校撰寫的多熱點導覽內容。
          待補內容，可先參考義華校頁面的完整版本。
        </p>
      </div>

      <template v-else>
        <Teleport :disabled="!isExpanded" to="#tour-dialog-target">
          <div class="tour-explorer" :class="{ expanded: isExpanded }" :style="{ '--tour-pin-scale': pinScale }" :data-tour-campus="campus.key">
            <div class="tour-toolbar">
              <div class="tour-location">
                <span class="tour-location-dot" aria-hidden="true" />
                <strong>{{ campus.name }}</strong><span>照片探索</span>
              </div>
              <button ref="expandBtnEl" type="button" class="tour-expand" @click="toggleExpanded">
                <svg class="icon" aria-hidden="true" focusable="false"><use :href="isExpanded ? '#i-x' : '#i-arrows-out'" /></svg>
                {{ isExpanded ? '返回頁面' : '展開檢視' }}
              </button>
            </div>
            <div class="tour-layout">
              <div class="tour-visual">
                <div
                  ref="areaEl"
                  class="tour-photo-area"
                  :class="{ zoomed: zoom > 1, dragging: isDragging }"
                  role="group"
                  tabindex="0"
                  aria-label="校園照片，放大後可以使用方向鍵移動"
                  @pointerdown="onAreaPointerdown"
                  @pointermove="onAreaPointermove"
                  @pointerup="endDrag"
                  @pointercancel="endDrag"
                  @lostpointercapture="endDrag"
                  @keydown="onAreaKeydown"
                >
                  <div class="tour-canvas" :style="canvasStyle">
                    <img class="tour-image tour-image-deferred" v-bind="mainImage" :src="imageReady ? mainImage.src : undefined" :srcset="imageReady ? mainImage.srcset : undefined" :alt="`${campus.name} · ${currentScene?.name}`" loading="lazy" decoding="async" draggable="false">
                    <noscript v-html="noscriptImage(mainImage, 'tour-image', `${campus.name} · ${currentScene?.name}`)" />
                    <button
                      v-for="(spot, i) in currentScene?.spots"
                      :key="spot.name"
                      type="button"
                      class="tour-pin"
                      :style="{ left: spot.x + '%', top: spot.y + '%' }"
                      :aria-pressed="i === spotIndex"
                      :aria-label="`${i + 1}：${spot.name}`"
                      aria-controls="tour-scene-panel"
                      @click="selectSpot(i, true)"
                    >
                      <span>{{ i + 1 }}</span>
                      <span class="tour-pin-label">{{ spot.name }}</span>
                    </button>
                  </div>
                </div>
                <div class="tour-image-tools">
                  <p class="tour-image-help">{{ zoomHelp }}</p>
                  <div class="tour-zoom">
                    <button type="button" :disabled="zoom <= 1" aria-label="縮小照片" @click="onZoomAction('out')">
                      <svg class="icon" aria-hidden="true" focusable="false"><use href="#i-minus" /></svg>
                    </button>
                    <output class="tour-zoom-value" aria-label="照片縮放比例">{{ zoomPercent }}%</output>
                    <button type="button" :disabled="zoom >= 2" aria-label="放大照片" @click="onZoomAction('in')">
                      <svg class="icon" aria-hidden="true" focusable="false"><use href="#i-plus" /></svg>
                    </button>
                    <button type="button" @click="onZoomAction('reset')">
                      <svg class="icon" aria-hidden="true" focusable="false"><use href="#i-arrow-counter-clockwise" /></svg>
                      重設
                    </button>
                  </div>
                </div>
                <div class="tour-scene-list" role="tablist" :aria-label="`${campus.name}照片場景`">
                  <button
                    v-for="(scene, i) in scenes"
                    :key="scene.key"
                    :ref="(el) => { if (el) tabRefs[i] = el as HTMLButtonElement }"
                    type="button"
                    class="tour-scene"
                    :id="`tour-scene-${campus.key}-${i}`"
                    role="tab"
                    :aria-selected="i === sceneIndex"
                    :tabindex="i === sceneIndex ? 0 : -1"
                    @click="selectScene(i)"
                    @keydown="onTabKeydown($event, i)"
                  >
                    <img v-bind="responsiveTourImage(scene.image, thumbnailSizes, false, scene.imageMedia)" :src="imageReady ? responsiveTourImage(scene.image, thumbnailSizes, false, scene.imageMedia).src : undefined" :srcset="imageReady ? responsiveTourImage(scene.image, thumbnailSizes, false, scene.imageMedia).srcset : undefined" alt="" loading="lazy" decoding="async">
                    <span>{{ scene.name }}</span>
                  </button>
                </div>
              </div>
              <div
                class="tour-detail"
                id="tour-scene-panel"
                role="tabpanel"
                :aria-labelledby="`tour-scene-${campus.key}-${sceneIndex}`"
                tabindex="0"
              >
                <div v-if="currentSpot" class="tour-detail-kicker">
                  <span>{{ currentScene?.name }}</span>
                  <span>{{ String(spotIndex + 1).padStart(2, '0') }} / {{ String(currentScene?.spots.length).padStart(2, '0') }}</span>
                </div>
                <h3 v-if="currentSpot" ref="spotTitleEl" class="tour-spot-title" tabindex="-1">{{ currentSpot.name }}</h3>
                <p v-if="currentSpot" class="tour-description">{{ currentSpot.text }}</p>
                <div v-if="currentSpot" class="tour-observe">
                  <span>到園時，還可以聊聊</span>
                  <p>{{ currentSpot.question }}</p>
                </div>
                <div v-if="currentScene && currentScene.spots.length > 1" class="tour-points">
                  <span>這張照片裡</span>
                  <button
                    v-for="(spot, i) in currentScene.spots"
                    :key="spot.name"
                    type="button"
                    :aria-pressed="i === spotIndex"
                    @click="selectSpot(i, true)"
                  >
                    <span>{{ String(i + 1).padStart(2, '0') }}</span>{{ spot.name }}<span aria-hidden="true">{{ i === spotIndex ? '●' : '○' }}</span>
                  </button>
                </div>
                <p class="tour-photo-credit">{{ campus.name }} · 官方實景照片</p>
              </div>
            </div>
            <div class="tour-footnote" data-cta-entry="campus_tour">
              <span>照片取自校區官方網站，實際環境請以到園參觀為準。</span>
              <NuxtLink :to="`/visit/${campus.key}`">預約參觀{{ campus.name }}</NuxtLink>
            </div>
          </div>
        </Teleport>
        <dialog id="tour-dialog-target" ref="dialogEl" class="tour-dialog" :aria-label="`${campus.name}照片探索`" @close="onDialogClose" />
      </template>
    </div>
  </section>
</template>
