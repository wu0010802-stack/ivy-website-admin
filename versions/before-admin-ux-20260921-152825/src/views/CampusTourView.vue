<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useContentItem } from '../composables/useContentItem'
import { CAMPUS_KEYS } from '../api/types'
import type { CampusTourPayload, MediaAssetOut, TourScenePayload } from '../api/types'
import { useAuthStore } from '../stores/auth'
import { websiteAssetUrl } from '../config'
import { mediaFileUrl } from '../api/client'
import MediaPickerDialog from '../components/MediaPickerDialog.vue'

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

const authStore = useAuthStore()

const visibleCampusKeys = computed(() => {
  if (authStore.user?.role === 'super_admin') return [...CAMPUS_KEYS]
  return authStore.user?.campus_keys ?? []
})

const selectedCampus = ref<string>('')

function newScene(): TourScenePayload {
  return {
    key: `scene-${Date.now()}`,
    name: '新場景',
    image: '',
    intro: '',
    spots: []
  }
}

const { item, form, saving, publishing, isPublished, load, save, publish } =
  useContentItem<CampusTourPayload>('campus_tour', { scenes: [newScene()] }, selectedCampus)

const sceneIndex = ref(0)
const spotIndex = ref<number | null>(null)

const currentScene = computed(() => form.value.scenes[sceneIndex.value] ?? null)
const currentSpot = computed(() =>
  spotIndex.value !== null ? (currentScene.value?.spots[spotIndex.value] ?? null) : null
)

function addScene() {
  form.value.scenes.push(newScene())
  sceneIndex.value = form.value.scenes.length - 1
  spotIndex.value = null
}

function removeScene(i: number) {
  form.value.scenes.splice(i, 1)
  sceneIndex.value = 0
  spotIndex.value = null
}

function selectScene(i: number) {
  sceneIndex.value = i
  spotIndex.value = null
}

const stageRef = ref<HTMLDivElement | null>(null)
const pickerVisible = ref(false)

function onPickMedia(asset: MediaAssetOut) {
  if (currentScene.value) currentScene.value.image = asset.id
}

function relativePosition(event: MouseEvent): { x: number; y: number } | null {
  const stage = stageRef.value
  if (!stage) return null
  const rect = stage.getBoundingClientRect()
  const x = ((event.clientX - rect.left) / rect.width) * 100
  const y = ((event.clientY - rect.top) / rect.height) * 100
  return { x: Math.min(100, Math.max(0, x)), y: Math.min(100, Math.max(0, y)) }
}

function onStageClick(event: MouseEvent) {
  if (!currentScene.value) return
  if (currentScene.value.spots.length >= 8) return
  const pos = relativePosition(event)
  if (!pos) return
  currentScene.value.spots.push({ name: '新地點', x: pos.x, y: pos.y, text: '', question: '' })
  spotIndex.value = currentScene.value.spots.length - 1
}

function removeSpot(i: number) {
  currentScene.value?.spots.splice(i, 1)
  spotIndex.value = null
}

let draggingIndex: number | null = null

function startDrag(i: number, event: MouseEvent) {
  event.stopPropagation()
  draggingIndex = i
  spotIndex.value = i
  window.addEventListener('mousemove', onDragMove)
  window.addEventListener('mouseup', stopDrag)
}

function onDragMove(event: MouseEvent) {
  if (draggingIndex === null || !currentScene.value) return
  const pos = relativePosition(event)
  if (!pos) return
  const spot = currentScene.value.spots[draggingIndex]
  if (!spot) return
  spot.x = Math.round(pos.x * 10) / 10
  spot.y = Math.round(pos.y * 10) / 10
}

function stopDrag() {
  draggingIndex = null
  window.removeEventListener('mousemove', onDragMove)
  window.removeEventListener('mouseup', stopDrag)
}

watch(
  selectedCampus,
  (key) => {
    if (key) {
      sceneIndex.value = 0
      spotIndex.value = 0
      load()
    }
  },
  { immediate: false }
)

onMounted(() => {
  if (visibleCampusKeys.value.length > 0) {
    selectedCampus.value = visibleCampusKeys.value[0]
    load()
  }
})
</script>

<template>
  <div style="max-width: 900px">
    <h2>校園探索（tourScenes）</h2>
    <el-form-item label="選擇校區">
      <el-select v-model="selectedCampus" style="width: 200px">
        <el-option v-for="key in visibleCampusKeys" :key="key" :label="key" :value="key" />
      </el-select>
    </el-form-item>

    <template v-if="selectedCampus">
      <el-tag v-if="isPublished" type="success">目前草稿已發布</el-tag>
      <el-tag v-else type="warning">尚有未發布的草稿</el-tag>
      <p style="color: var(--el-text-color-secondary)">
        點「選擇圖片」從素材庫選一張，或上傳新的；既有場景若還是顯示官網原本的素材代號（例如
        <code>campus</code>），維持原樣即可，不用換成素材庫圖片。
        在照片上點一下新增熱點，拖曳圖釘可以調整位置。發布後會**整組取代**該校原本的探索內容（含目前只有單一場景的通用模板）。
      </p>

      <div style="display: flex; gap: 8px; flex-wrap: wrap; margin: 1rem 0">
        <el-button
          v-for="(scene, i) in form.scenes"
          :key="scene.key"
          :type="i === sceneIndex ? 'primary' : 'default'"
          size="small"
          @click="selectScene(i)"
        >
          {{ scene.name || `場景 ${i + 1}` }}
        </el-button>
        <el-button size="small" :disabled="form.scenes.length >= 6" @click="addScene">新增場景</el-button>
      </div>

      <template v-if="currentScene">
        <el-form label-position="top">
          <div style="display: flex; gap: 1rem">
            <el-form-item label="場景名稱" style="flex: 1">
              <el-input v-model="currentScene.name" />
            </el-form-item>
            <el-form-item label="圖片" style="flex: 1">
              <div style="display: flex; align-items: center; gap: 8px">
                <img
                  v-if="currentScene.image"
                  :src="previewUrl(currentScene.image)"
                  style="width: 48px; height: 36px; object-fit: cover; border: 1px solid var(--el-border-color)"
                />
                <el-button size="small" @click="pickerVisible = true">選擇圖片</el-button>
              </div>
              <el-input
                v-model="currentScene.image"
                size="small"
                placeholder="或手動輸入素材代號（相容既有內容，例如 campus）"
                style="margin-top: 6px"
              />
            </el-form-item>
          </div>
          <el-form-item label="場景說明">
            <el-input v-model="currentScene.intro" />
          </el-form-item>
        </el-form>

        <div style="display: flex; gap: 1.5rem; margin-top: 1rem">
          <div style="flex: 1.4">
            <div
              ref="stageRef"
              style="position: relative; width: 100%; aspect-ratio: 4 / 3; background: #eee; cursor: crosshair; overflow: hidden; border: 1px solid var(--el-border-color)"
              @click="onStageClick"
            >
              <img
                v-if="currentScene.image"
                :src="previewUrl(currentScene.image)"
                style="width: 100%; height: 100%; object-fit: cover; pointer-events: none"
                @error="($event.target as HTMLImageElement).style.visibility = 'hidden'"
              />
              <button
                v-for="(spot, i) in currentScene.spots"
                :key="i"
                type="button"
                :style="{
                  position: 'absolute',
                  left: `${spot.x}%`,
                  top: `${spot.y}%`,
                  transform: 'translate(-50%, -50%)',
                  width: '28px',
                  height: '28px',
                  borderRadius: '50%',
                  border: i === spotIndex ? '2px solid #fff' : '2px solid rgba(255,255,255,0.7)',
                  background: i === spotIndex ? '#f56c6c' : '#409eff',
                  color: '#fff',
                  fontSize: '12px',
                  cursor: 'grab',
                  boxShadow: '0 0 4px rgba(0,0,0,0.5)'
                }"
                @mousedown="startDrag(i, $event)"
                @click.stop="spotIndex = i"
              >
                {{ i + 1 }}
              </button>
            </div>
            <p style="color: var(--el-text-color-secondary); font-size: 0.85rem">
              目前 {{ currentScene.spots.length }} / 8 個熱點；點空白處新增，拖曳圖釘調整位置。
            </p>
          </div>

          <div style="flex: 1">
            <template v-if="currentSpot">
              <el-form label-position="top">
                <el-form-item label="熱點名稱">
                  <el-input v-model="currentSpot.name" />
                </el-form-item>
                <el-form-item label="說明文字">
                  <el-input v-model="currentSpot.text" type="textarea" :rows="3" />
                </el-form-item>
                <el-form-item label="到園時可以聊聊">
                  <el-input v-model="currentSpot.question" type="textarea" :rows="2" />
                </el-form-item>
                <el-button size="small" type="danger" @click="removeSpot(spotIndex!)">移除這個熱點</el-button>
              </el-form>
            </template>
            <p v-else style="color: var(--el-text-color-secondary)">點選或新增一個熱點來編輯內容。</p>
          </div>
        </div>

        <el-button
          v-if="form.scenes.length > 1"
          size="small"
          type="danger"
          style="margin-top: 1rem"
          @click="removeScene(sceneIndex)"
        >
          刪除這個場景
        </el-button>
      </template>

      <div style="margin-top: 1.5rem">
        <el-button type="primary" :loading="saving" @click="save">儲存草稿</el-button>
        <el-button
          type="success"
          :loading="publishing"
          :disabled="!item?.latest_revision"
          @click="publish"
        >
          發布到官網
        </el-button>
      </div>
    </template>

    <MediaPickerDialog v-model="pickerVisible" :campus-key="selectedCampus" @select="onPickMedia" />
  </div>
</template>
