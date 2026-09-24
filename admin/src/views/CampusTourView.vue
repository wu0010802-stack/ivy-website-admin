<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useTemplateRef, watch } from 'vue'
import { Delete, Plus } from '@element-plus/icons-vue'
import { useContentItem } from '../composables/useContentItem'
import { useCampusContent } from '../composables/useCampusContent'
import type { CampusTourPayload, MediaAssetOut, TourScenePayload } from '../api/types'
import { websiteAssetUrl } from '../config'
import { mediaFileUrl } from '../api/client'
import ContentEditor from '../components/ContentEditor.vue'
import CampusSelect from '../components/CampusSelect.vue'
import MediaPickerDialog from '../components/MediaPickerDialog.vue'

const MAX_SCENES = 6
const MAX_SPOTS = 8
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// `image` 同時相容兩種值：素材庫上傳的媒體 UUID（新的、推薦用這個），
// 跟舊 fixture 素材代號字串（例如 "campus"，還沒被取代的既有內容繼續
// 用這個顯示，見 backend CampusTourPayload 與 web content-overlay 的
// 對應相容邏輯）。
function isMediaId(image: string): boolean {
  return UUID_PATTERN.test(image)
}

function previewUrl(image: string): string {
  return isMediaId(image) ? mediaFileUrl(image) : websiteAssetUrl(image)
}

function newScene(): TourScenePayload {
  // 後端要求每個場景 1～8 個熱點（content/schemas.py 的 _spots_bounded），
  // 空陣列會讓儲存永遠 422。新場景直接給一個置中的熱點，使用者拖到對的
  // 位置就好，不會先撞一次看不懂的錯誤。
  return {
    key: `scene-${Date.now()}`,
    name: '新場景',
    image: '',
    intro: '',
    spots: [{ name: '地點 1', x: 50, y: 50, text: '', question: '' }],
  }
}

const campus = ref('')
const editor = useContentItem<CampusTourPayload>('campus_tour', { scenes: [newScene()] }, campus)

const sceneIndex = ref(0)
const spotIndex = ref<number | null>(null)

const shell = useTemplateRef<InstanceType<typeof ContentEditor>>('shell')
const { visibleCampusKeys } = useCampusContent(editor, campus, shell, () => {
  sceneIndex.value = 0
  spotIndex.value = null
})

const scenes = computed(() => editor.form.value.scenes)
const currentScene = computed(() => scenes.value[sceneIndex.value] ?? null)
const currentSpot = computed(() =>
  spotIndex.value !== null ? (currentScene.value?.spots[spotIndex.value] ?? null) : null,
)
const imageBroken = ref(false)

function addScene() {
  scenes.value.push(newScene())
  sceneIndex.value = scenes.value.length - 1
  spotIndex.value = null
}

function removeScene(i: number) {
  scenes.value.splice(i, 1)
  sceneIndex.value = 0
  spotIndex.value = null
}

function selectScene(i: number) {
  sceneIndex.value = i
  spotIndex.value = null
  imageBroken.value = false
}

const stageRef = ref<HTMLDivElement | null>(null)
const pickerVisible = ref(false)

function onPickMedia(asset: MediaAssetOut) {
  const scene = currentScene.value
  if (scene) {
    // 換照片後原本的座標可能對不上。伺服器存檔時也會這樣標，這裡先標，
    // 畫面上立刻看得到要複核。
    if (scene.image && scene.image !== asset.id) scene.spots_reviewed = false
    scene.image = asset.id
  }
  imageBroken.value = false
}

function markSpotsReviewed() {
  if (currentScene.value) currentScene.value.spots_reviewed = true
}

function relativePosition(event: MouseEvent): { x: number; y: number } | null {
  const stage = stageRef.value
  if (!stage) return null
  const rect = stage.getBoundingClientRect()
  if (!rect.width || !rect.height) return null
  const x = ((event.clientX - rect.left) / rect.width) * 100
  const y = ((event.clientY - rect.top) / rect.height) * 100
  return { x: Math.min(100, Math.max(0, x)), y: Math.min(100, Math.max(0, y)) }
}

function onStageClick(event: MouseEvent) {
  if (!currentScene.value) return
  if (currentScene.value.spots.length >= MAX_SPOTS) return
  const pos = relativePosition(event)
  if (!pos) return
  currentScene.value.spots.push({
    name: `地點 ${currentScene.value.spots.length + 1}`,
    x: Math.round(pos.x * 10) / 10,
    y: Math.round(pos.y * 10) / 10,
    text: '',
    question: '',
  })
  spotIndex.value = currentScene.value.spots.length - 1
}

function removeSpot(i: number) {
  // 至少要留一個：後端下界是 1，刪光之後這個場景就再也存不起來。
  if (!currentScene.value || currentScene.value.spots.length <= 1) return
  currentScene.value.spots.splice(i, 1)
  spotIndex.value = null
}

let dragging: { pointerId: number; target: HTMLElement; spot: TourScenePayload['spots'][number] } | null = null

function startDrag(i: number, event: PointerEvent) {
  if (!event.isPrimary || event.button !== 0 || (editor.saving.value || editor.publishing.value)) return
  const spot = currentScene.value?.spots[i]
  if (!spot) return
  stopDrag()
  event.stopPropagation()
  const target = event.currentTarget as HTMLElement
  dragging = { pointerId: event.pointerId, target, spot }
  target.setPointerCapture(event.pointerId)
  spotIndex.value = i
  window.addEventListener('pointermove', onDragMove)
  window.addEventListener('pointerup', stopDrag)
  window.addEventListener('pointercancel', stopDrag)
}

function onDragMove(event: PointerEvent) {
  if (!dragging || event.pointerId !== dragging.pointerId) return
  const pos = relativePosition(event)
  if (!pos) return
  dragging.spot.x = Math.round(pos.x * 10) / 10
  dragging.spot.y = Math.round(pos.y * 10) / 10
}

function stopDrag() {
  if (dragging?.target.hasPointerCapture(dragging.pointerId)) dragging.target.releasePointerCapture(dragging.pointerId)
  dragging = null
  window.removeEventListener('pointermove', onDragMove)
  window.removeEventListener('pointerup', stopDrag)
  window.removeEventListener('pointercancel', stopDrag)
}

watch(currentScene, stopDrag)
onBeforeUnmount(stopDrag)

// 鍵盤微調：焦點在圖釘上時用方向鍵移動 1%，Shift 為 5%
function nudge(i: number, event: KeyboardEvent) {
  const spot = currentScene.value?.spots[i]
  if (!spot) return
  const step = event.shiftKey ? 5 : 1
  const map: Record<string, [number, number]> = {
    ArrowLeft: [-step, 0],
    ArrowRight: [step, 0],
    ArrowUp: [0, -step],
    ArrowDown: [0, step],
  }
  const delta = map[event.key]
  if (!delta) return
  event.preventDefault()
  spot.x = Math.min(100, Math.max(0, Math.round((spot.x + delta[0]) * 10) / 10))
  spot.y = Math.min(100, Math.max(0, Math.round((spot.y + delta[1]) * 10) / 10))
}
</script>

<template>
  <ContentEditor
    ref="shell"
    :editor="editor"
    width="wide"
    :placeholder="visibleCampusKeys.length === 0 ? '你的帳號沒有可編輯的校區。' : undefined"
  >
    <template #lead>
      分校頁的「校園探索」互動圖。每個場景一張照片、最多 {{ MAX_SPOTS }} 個熱點；在照片上點一下新增熱點、拖曳圖釘調整位置。
      發布後會整組取代該校原本的探索內容。
    </template>
    <template #toolbar>
      <CampusSelect v-model="campus" :keys="visibleCampusKeys" />
    </template>

    <div class="tour">
      <div class="tour__scenes" role="tablist" aria-label="場景">
        <button
          v-for="(scene, i) in scenes"
          :key="scene.key"
          type="button"
          role="tab"
          class="tour__scene-tab"
          :class="{ 'is-active': i === sceneIndex }"
          :aria-selected="i === sceneIndex"
          @click="selectScene(i)"
        >
          <img v-if="scene.image" :src="previewUrl(scene.image)" alt="" @error="($event.target as HTMLImageElement).style.visibility = 'hidden'" />
          <span v-else class="tour__scene-empty" aria-hidden="true" />
          <span class="tour__scene-name">{{ scene.name || `場景 ${i + 1}` }}</span>
          <span class="tour__scene-count">{{ scene.spots.length }} 個熱點</span>
          <span v-if="scene.spots_reviewed === false" class="tour__scene-review">熱點待複核</span>
        </button>
        <button
          type="button"
          class="tour__scene-tab tour__scene-tab--add"
          :disabled="scenes.length >= MAX_SCENES"
          @click="addScene"
        >
          <el-icon><Plus /></el-icon>
          <span>新增場景</span>
        </button>
      </div>

      <template v-if="currentScene">
        <div class="tour__grid">
          <div class="tour__stage-col">
            <div
              ref="stageRef"
              class="tour__stage"
              :class="{ 'is-full': currentScene.spots.length >= MAX_SPOTS }"
              @click="onStageClick"
            >
              <img
                v-if="currentScene.image && !imageBroken"
                :src="previewUrl(currentScene.image)"
                alt=""
                @error="imageBroken = true"
              />
              <div v-else class="tour__stage-empty">
                <span v-if="!currentScene.image">尚未選擇照片</span>
                <span v-else>無法載入這張圖片，請重新選擇</span>
              </div>
              <button
                v-for="(spot, i) in currentScene.spots"
                :key="i"
                type="button"
                class="tour__pin"
                :class="{ 'is-active': i === spotIndex }"
                :style="{ left: `${spot.x}%`, top: `${spot.y}%` }"
                :aria-label="`熱點 ${i + 1}：${spot.name || '未命名'}，方向鍵可微調位置`"
                :aria-pressed="i === spotIndex"
                @pointerdown="startDrag(i, $event)"
                @lostpointercapture="stopDrag"
                @click.stop="spotIndex = i"
                @keydown="nudge(i, $event)"
              >
                {{ i + 1 }}
              </button>
            </div>
            <p class="hint tour__stage-hint">
              <span v-if="currentScene.spots.length >= MAX_SPOTS">已達 {{ MAX_SPOTS }} 個熱點上限，刪除後才能再新增。</span>
              <span v-else>點照片空白處新增熱點（{{ currentScene.spots.length }} / {{ MAX_SPOTS }}），拖曳或用方向鍵調整位置。</span>
            </p>
          </div>

          <div class="tour__side">
            <el-alert
              v-if="currentScene.spots_reviewed === false"
              type="warning"
              :closable="false"
              show-icon
              title="換了照片，熱點位置要重新確認"
              class="tour__review"
            >
              <p>逐一點開圖釘，確認每個熱點還落在對的位置。確認完按下面按鈕再儲存，這個場景才能發布。</p>
              <el-button size="small" type="primary" @click="markSpotsReviewed">熱點位置都確認過了</el-button>
            </el-alert>
            <el-form label-position="top" @submit.prevent>
              <h3 class="tour__side-title">場景</h3>
              <el-form-item label="場景名稱">
                <el-input v-model="currentScene.name" placeholder="例如：戶外遊戲場" />
              </el-form-item>
              <el-form-item label="照片">
                <div class="tour__image-row">
                  <el-button size="small" @click="pickerVisible = true">
                    {{ currentScene.image ? '更換照片' : '從素材庫選擇' }}
                  </el-button>
                  <span v-if="currentScene.image && !isMediaId(currentScene.image)" class="hint">
                    目前使用官網內建素材 <code class="mono">{{ currentScene.image }}</code>
                  </span>
                </div>
              </el-form-item>
              <el-form-item label="場景說明">
                <el-input v-model="currentScene.intro" type="textarea" :autosize="{ minRows: 2, maxRows: 4 }" />
              </el-form-item>

              <template v-if="currentSpot">
                <h3 class="tour__side-title tour__side-title--spot">
                  熱點 {{ (spotIndex ?? 0) + 1 }}
                  <el-button text size="small" type="danger" :icon="Delete" @click="removeSpot(spotIndex!)">移除</el-button>
                </h3>
                <el-form-item label="名稱">
                  <el-input v-model="currentSpot.name" />
                </el-form-item>
                <el-form-item label="說明文字">
                  <el-input v-model="currentSpot.text" type="textarea" :autosize="{ minRows: 2, maxRows: 6 }" />
                </el-form-item>
                <el-form-item label="到園時可以聊聊">
                  <el-input v-model="currentSpot.question" type="textarea" :autosize="{ minRows: 1, maxRows: 4 }" />
                  <span class="field-help">給家長的開放式提問，會顯示在熱點說明下方。</span>
                </el-form-item>
              </template>
              <p v-else class="hint tour__side-empty">點選照片上的圖釘，或在空白處新增一個熱點來編輯內容。</p>
            </el-form>
          </div>
        </div>

        <div class="tour__scene-actions" v-if="scenes.length > 1">
          <el-button text type="danger" :icon="Delete" @click="removeScene(sceneIndex)">刪除「{{ currentScene.name || `場景 ${sceneIndex + 1}` }}」</el-button>
        </div>
      </template>
    </div>

    <MediaPickerDialog v-model="pickerVisible" :campus-key="campus" @select="onPickMedia" />
  </ContentEditor>
</template>

<style scoped>
.tour__scenes {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 20px;
}

.tour__scene-tab {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px 6px 6px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--surface);
  color: var(--ink-2);
  font: inherit;
  cursor: pointer;
  transition:
    border-color 150ms var(--ease-out),
    background-color 150ms var(--ease-out);
}

.tour__scene-tab:hover {
  border-color: var(--line-strong);
}

.tour__scene-tab.is-active {
  border-color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
  color: var(--ink);
}

.tour__scene-tab img,
.tour__scene-empty {
  width: 40px;
  height: 30px;
  border-radius: 4px;
  object-fit: cover;
  background: var(--surface-3);
}

.tour__scene-name {
  font-weight: 500;
}

.tour__scene-count {
  font-size: 12px;
  color: var(--ink-3);
}

.tour__scene-tab--add {
  border-style: dashed;
  background: transparent;
  padding: 6px 12px;
}

.tour__scene-tab--add:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.tour__grid {
  display: grid;
  grid-template-columns: minmax(0, 1.5fr) minmax(280px, 1fr);
  gap: 24px;
}

.tour__stage {
  position: relative;
  aspect-ratio: 4 / 3;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface-3);
  cursor: crosshair;
  user-select: none;
}

.tour__stage.is-full {
  cursor: default;
}

.tour__stage img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  pointer-events: none;
  display: block;
}

.tour__stage-empty {
  display: grid;
  place-items: center;
  height: 100%;
  color: var(--ink-3);
  font-size: 13px;
}

.tour__pin {
  touch-action: none;
  position: absolute;
  width: 28px;
  height: 28px;
  transform: translate(-50%, -50%);
  border: 2px solid var(--on-photo-border);
  border-radius: 50%;
  background: var(--el-color-primary);
  color: var(--on-photo);
  font: 600 12px/1 var(--el-font-family);
  cursor: grab;
  box-shadow: 0 1px 4px var(--on-photo-shadow);
  transition: transform 120ms var(--ease-out);
}

.tour__pin:active {
  cursor: grabbing;
}

.tour__pin.is-active {
  background: var(--brand-gold);
  color: var(--ink);
  border-color: var(--on-photo);
  transform: translate(-50%, -50%) scale(1.15);
}

.tour__pin:focus-visible {
  outline: 2px solid var(--brand-gold);
  outline-offset: 2px;
}

.tour__stage-hint {
  margin-top: 8px;
}

.tour__side-title {
  margin: 0 0 12px;
  color: var(--ink-2);
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.tour__side-title--spot {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid var(--line);
}

.tour__scene-review {
  font-size: 12px;
  color: var(--brand-gold-ink);
  font-weight: 600;
}

.tour__review {
  margin-bottom: 12px;
}

.tour__review p {
  margin: 4px 0 8px;
}

.tour__image-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.tour__side-empty {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid var(--line);
}

.tour__scene-actions {
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid var(--line);
}

@media (max-width: 900px) {
  .tour__grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
@media (pointer: coarse) {
  .tour__pin { width:44px; height:44px; font-size:14px; }
}
</style>
