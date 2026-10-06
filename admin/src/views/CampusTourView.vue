<script setup lang="ts">
import { computed, nextTick, ref, useTemplateRef, watch } from 'vue'
import { Delete, Plus } from '@element-plus/icons-vue'
import { useContentItem } from '../composables/useContentItem'
import { useCampusContent } from '../composables/useCampusContent'
import { useCampusScope } from '../composables/useCampusScope'
import type { CampusTourPayload, MediaAssetOut, TourScenePayload } from '../api/types'
import { websiteAssetUrl } from '../config'
import { mediaFileUrl } from '../api/client'
import { isMediaId, useMediaThumbs } from '../composables/mediaThumbs'
import ContentEditor from '../components/ContentEditor.vue'
import { vReadonlyValues } from '../composables/readonlyValues'
import LengthHint from '../components/LengthHint.vue'
import { IMAGE_HINTS } from '../composables/contentHints'
import CampusSelect from '../components/CampusSelect.vue'
import MediaRefField from '../components/MediaRefField.vue'
import { moveItem } from '../composables/newsContent'

const MAX_SCENES = 6

// `image` 同時相容兩種值：素材庫上傳的媒體 UUID（新的、推薦用這個），
// 跟舊 fixture 素材代號字串（例如 "campus"，還沒被取代的既有內容繼續
// 用這個顯示，見 backend CampusTourPayload 與 web content-overlay 的
// 對應相容邏輯）。預覽載原檔；場景分頁的小圖載縮圖。
function previewUrl(image: string): string {
  return isMediaId(image) ? mediaFileUrl(image) : websiteAssetUrl(image)
}

const thumbs = useMediaThumbs()

// 熱點是已拿掉的分校頁用的，官網環境頁只用場景名稱、照片、說明（2026-10-04
// 拿掉熱點編輯）。新場景不帶熱點；舊場景存著的熱點原樣跟著存回去，不顯示。
function newScene(): TourScenePayload {
  return {
    key: `scene-${Date.now()}`,
    name: '新場景',
    image: '',
    intro: '',
  }
}

const campus = ref('')
const editor = useContentItem<CampusTourPayload>('campus_tour', { scenes: [newScene()] }, campus)

const sceneIndex = ref(0)
const imageBroken = ref(false)

// 2026-10-05 起五校的校園探索由總部帳號直接控制（後端 registry 的 hq_managed）：
// 這一頁只有總管理者與有「全站共用內容」授權的人進得來，五校都能切換。
const shell = useTemplateRef<InstanceType<typeof ContentEditor>>('shell')
const { visibleCampusKeys, campusLocked } = useCampusContent(editor, campus, shell, () => {
  sceneIndex.value = 0
  imageBroken.value = false
}, { allCampuses: true })
// 素材挑選與上傳：自己範圍內的校用那一校的素材；有授權但不負責那一校的人，
// 只能挑、傳跨校共用素材（後端不讓他動別校的素材）。
const ownCampusKeys = useCampusScope({ autoSelect: false }).visibleCampusKeys
const mediaCampusKey = computed(() => (ownCampusKeys.value.includes(campus.value) ? campus.value : undefined))

const scenes = computed(() => editor.form.value.scenes)
const currentScene = computed(() => scenes.value[sceneIndex.value] ?? null)
// 表單整份換掉（換校、放棄修改、載入最新內容、套回修改、還原版本）：場景可能變少，
// 選取夾回範圍內，不然右邊整塊空白；讀圖失敗是上一份內容的狀態，跟著清掉。
// 新增、刪除、移動場景是改同一個陣列，不會觸發這裡（那幾個動作自己調整選取）。
watch(scenes, (list) => {
  sceneIndex.value = Math.min(sceneIndex.value, Math.max(0, list.length - 1))
  imageBroken.value = false
})

const sceneName = useTemplateRef<HTMLElement>('sceneName')

// 新場景選起來並聚焦場景名稱，先取名再選照片。
async function addScene() {
  scenes.value.push(newScene())
  sceneIndex.value = scenes.value.length - 1
  imageBroken.value = false
  await nextTick()
  sceneName.value?.querySelector('input')?.focus()
}

// 刪掉之後選旁邊那一個（原本的下一個，刪的是最後一個就選前一個），不跳回第一個。
function removeScene(i: number) {
  scenes.value.splice(i, 1)
  sceneIndex.value = Math.max(0, Math.min(i, scenes.value.length - 1))
  imageBroken.value = false
}

// 順序就是陣列順序（官網環境頁照這個順序排，第一個放大）。移動後選取跟著
// 那一項走，按鈕固定在側欄同一個位置，鍵盤可以連按。
function moveScene(delta: number) {
  const from = sceneIndex.value
  const to = from + delta
  if (to < 0 || to >= scenes.value.length) return
  moveItem(scenes.value, from, delta)
  sceneIndex.value = to
}

function selectScene(i: number) {
  sceneIndex.value = i
  imageBroken.value = false
}

// 值本身由 MediaRefField 的 v-model 換好了；這裡只換掉舊的縮圖與讀圖失敗狀態。
function onPickMedia(asset: MediaAssetOut) {
  thumbs.forget(asset.id)
  imageBroken.value = false
}
</script>

<template>
  <ContentEditor
    ref="shell"
    :editor="editor"
    width="wide"
  >
    <template #lead>
      官網「常春藤環境」頁「五所校園」一章的照片與說明，由總部統一管理。每校最多 {{ MAX_SCENES }} 個場景，每個場景一張照片、一個名稱和一段說明；排第一的場景在官網放大顯示（剛好兩個場景時並排）。
      發布後會整組取代該校原本的內容。
    </template>
    <template #toolbar>
      <CampusSelect v-model="campus" :keys="visibleCampusKeys" :disabled="campusLocked" />
    </template>

    <div class="tour">
      <!-- 「新增場景」不是分頁，放在 tablist 外面（tablist 只能有 tab，axe aria-required-children）。 -->
      <div class="tour__scenes">
        <div class="tour__scene-tabs" role="tablist" aria-label="場景">
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
            <span v-if="scene.image && thumbs.isBroken(scene.image)" class="tour__scene-empty tour__scene-broken" aria-hidden="true">!</span>
            <img v-else-if="scene.image" :src="thumbs.src(scene.image)" alt="" loading="lazy" @error="thumbs.onError(scene.image)" />
            <span v-else class="tour__scene-empty" aria-hidden="true" />
            <span class="tour__scene-name">{{ scene.name || `場景 ${i + 1}` }}</span>
            <span v-if="scene.image && thumbs.isBroken(scene.image)" class="tour__scene-missing">照片讀不到</span>
          </button>
        </div>
        <button
          v-if="!editor.readOnly.value"
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
            <div class="tour__stage" :class="{ 'is-empty': !currentScene.image || imageBroken }">
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
            </div>
            <p class="hint tour__stage-hint">官網照這張照片的原比例整張顯示，不裁切。</p>
          </div>

          <div class="tour__side">
            <el-form v-readonly-values="editor.readOnly.value" label-position="top" :disabled="editor.readOnly.value" @submit.prevent>
              <h3 class="tour__side-title">
                場景 {{ sceneIndex + 1 }} / {{ scenes.length }}
                <span v-if="!editor.readOnly.value && scenes.length > 1" class="tour__order">
                  <el-button text size="small" :disabled="sceneIndex === 0" :aria-label="`場景「${currentScene.name || sceneIndex + 1}」上移（往前）`" @click="moveScene(-1)">上移</el-button>
                  <el-button text size="small" :disabled="sceneIndex === scenes.length - 1" :aria-label="`場景「${currentScene.name || sceneIndex + 1}」下移（往後）`" @click="moveScene(1)">下移</el-button>
                </span>
              </h3>
              <el-form-item label="場景名稱">
                <div ref="sceneName" class="tour__name">
                  <el-input v-model="currentScene.name" placeholder="例如：戶外遊戲場" />
                </div>
              </el-form-item>
              <el-form-item label="照片">
                <MediaRefField
                  v-model="currentScene.image"
                  :campus-key="mediaCampusKey"
                  :thumb="false"
                  :clearable="false"
                  :disabled="editor.readOnly.value"
                  @picked="onPickMedia"
                >
                  <template #hint><span class="field-help">{{ IMAGE_HINTS.tour }}</span></template>
                </MediaRefField>
              </el-form-item>
              <el-form-item label="場景說明">
                <el-input v-model="currentScene.intro" type="textarea" :autosize="{ minRows: 2, maxRows: 4 }" />
                <LengthHint :value="currentScene.intro" rule="tourIntro" />
              </el-form-item>
            </el-form>
          </div>
        </div>

        <div class="tour__scene-actions" v-if="scenes.length > 1 && !editor.readOnly.value">
          <!-- 場景裡有照片和說明，重做很費工：刪除前先問一次（按鈕「先不要／刪除」）。 -->
          <el-popconfirm
            :title="`刪除「${currentScene.name || `場景 ${sceneIndex + 1}`}」？照片和說明會一起拿掉。`"
            confirm-button-text="刪除"
            cancel-button-text="先不要"
            confirm-button-type="danger"
            width="280"
            @confirm="removeScene(sceneIndex)"
          >
            <template #reference>
              <el-button text type="danger" :icon="Delete">刪除「{{ currentScene.name || `場景 ${sceneIndex + 1}` }}」</el-button>
            </template>
          </el-popconfirm>
        </div>
      </template>
    </div>

  </ContentEditor>
</template>

<style scoped>
.tour__scenes,
.tour__scene-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.tour__scenes {
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

.tour__scene-broken {
  display: grid;
  place-items: center;
  border: 1px solid var(--el-color-danger);
  color: var(--el-color-danger);
  font-size: var(--text-xs);
  font-weight: 600;
}

.tour__scene-missing {
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--el-color-danger);
}

.tour__name {
  width: 100%;
}

.tour__scene-name {
  font-weight: 500;
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

/* 官網環境頁的場景照片是原比例整張顯示（web environment.css 的 .renv-snap>img），
   這裡一樣不裁切；沒照片時給一個 8:5 的空框。 */
.tour__stage {
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface-3);
}

.tour__stage.is-empty {
  aspect-ratio: 8 / 5;
}

.tour__stage img {
  width: 100%;
  height: auto;
  display: block;
}

.tour__stage-empty {
  display: grid;
  place-items: center;
  height: 100%;
  color: var(--ink-3);
  font-size: var(--text-sm);
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

.tour__order {
  display: flex;
  flex-wrap: wrap;
  gap: 2px;
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
</style>
