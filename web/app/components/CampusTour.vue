<script setup lang="ts">
import type { Campus } from '~/types/site-content'
import { isGeneratedTourScenes } from '~/types/site-content'

const props = defineProps<{ campus: Campus }>()

const isGenerated = computed(() => isGeneratedTourScenes(props.campus.tourScenes))

const sceneIndex = ref(0)
const spotIndex = ref(0)

const scenes = computed(() => (isGeneratedTourScenes(props.campus.tourScenes) ? [] : props.campus.tourScenes))
const currentScene = computed(() => scenes.value[sceneIndex.value])
const currentSpot = computed(() => currentScene.value?.spots[spotIndex.value])

function selectScene(i: number) {
  sceneIndex.value = i
  spotIndex.value = 0
}

function selectSpot(i: number) {
  spotIndex.value = i
}
</script>

<template>
  <section class="section tour-section" id="environment" aria-labelledby="tour-heading">
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

      <div v-else class="tour-explorer" :data-tour-campus="campus.key">
        <div class="tour-toolbar">
          <div class="tour-location">
            <span class="tour-location-dot" aria-hidden="true" />
            <strong>{{ campus.name }}</strong><span>照片探索</span>
          </div>
        </div>
        <div class="tour-layout">
          <div class="tour-visual">
            <div class="tour-photo-area">
              <div class="tour-canvas">
                <img class="tour-image" :src="`/assets/${currentScene?.image}.webp`" :alt="`${campus.name} · ${currentScene?.name}`">
                <button
                  v-for="(spot, i) in currentScene?.spots"
                  :key="spot.name"
                  type="button"
                  class="tour-pin"
                  :style="{ left: spot.x + '%', top: spot.y + '%' }"
                  :aria-pressed="i === spotIndex"
                  :aria-label="`${i + 1}：${spot.name}`"
                  @click="selectSpot(i)"
                >
                  <span>{{ i + 1 }}</span>
                  <span class="tour-pin-label">{{ spot.name }}</span>
                </button>
              </div>
            </div>
            <div class="tour-scene-list" role="tablist" :aria-label="`${campus.name}照片場景`">
              <button
                v-for="(scene, i) in scenes"
                :key="scene.key"
                type="button"
                class="tour-scene"
                role="tab"
                :aria-selected="i === sceneIndex"
                :tabindex="i === sceneIndex ? 0 : -1"
                @click="selectScene(i)"
              >
                <img :src="`/assets/${scene.image}.webp`" alt="">
                <span>{{ scene.name }}</span>
              </button>
            </div>
          </div>
          <div class="tour-detail" role="tabpanel">
            <div v-if="currentSpot" class="tour-detail-kicker">
              <span>{{ currentScene?.name }}</span>
              <span>{{ String(spotIndex + 1).padStart(2, '0') }} / {{ String(currentScene?.spots.length).padStart(2, '0') }}</span>
            </div>
            <h3 v-if="currentSpot" class="tour-spot-title">{{ currentSpot.name }}</h3>
            <p v-if="currentSpot" class="tour-description">{{ currentSpot.text }}</p>
            <div v-if="currentSpot" class="tour-observe">
              <span>到園時，還可以聊聊</span>
              <p>{{ currentSpot.question }}</p>
            </div>
            <p class="tour-photo-credit">{{ campus.name }} · 官方實景照片</p>
          </div>
        </div>
        <div class="tour-footnote">
          <span>照片取自校區官方網站，實際環境請以到園參觀為準。</span>
          <NuxtLink :to="`/visit/${campus.key}`">預約參觀{{ campus.name }}</NuxtLink>
        </div>
      </div>
    </div>
  </section>
</template>
