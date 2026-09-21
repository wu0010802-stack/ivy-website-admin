<script setup lang="ts">
import type { Campus, CampusBoardContent } from '~/types/site-content'

const props = defineProps<{ board: CampusBoardContent; campuses: Campus[] }>()

const orderedCampuses = computed(() =>
  props.board.campusOrder
    .map((key) => props.campuses.find((c) => c.key === key))
    .filter((c): c is Campus => Boolean(c))
)

const index = ref(
  Math.max(
    0,
    orderedCampuses.value.findIndex((c) => c.key === props.board.defaultCampus)
  )
)

const current = computed(() => orderedCampuses.value[index.value]!)

function go(step: number) {
  const total = orderedCampuses.value.length
  index.value = (index.value + step + total) % total
}

function select(i: number) {
  index.value = i
}
</script>

<template>
  <section
    class="section campuses campus-panorama campus-board"
    id="campuses"
    aria-roledescription="輪播"
    aria-labelledby="campuses-heading"
  >
    <div class="campus-artwork" aria-hidden="true">
      <img
        class="campus-art-building"
        :src="`/assets/campus-line-art-${current.key}.webp`"
        alt=""
        loading="lazy"
        decoding="async"
      >
    </div>
    <div class="container">
      <div class="section-heading is-centered">
        <div>
          <span class="eyebrow">{{ board.eyebrow }}</span>
          <h2 class="section-title" id="campuses-heading">{{ board.sectionTitle }}</h2>
        </div>
      </div>
      <div class="campus-picker">
        <span class="campus-picker-nav">
          <button type="button" class="campus-stage-btn" aria-label="上一校" @click="go(-1)">
            <svg class="icon" aria-hidden="true" focusable="false"><use href="#i-arrow-left" /></svg>
          </button>
        </span>
        <div class="campus-track" role="tablist" aria-label="選擇校區">
          <button
            v-for="(c, i) in orderedCampuses"
            :key="c.key"
            type="button"
            role="tab"
            class="campus-seg"
            :aria-selected="i === index"
            :tabindex="i === index ? 0 : -1"
            aria-controls="campus-stage"
            @click="select(i)"
          >
            {{ c.name }}
          </button>
        </div>
        <span class="campus-picker-nav">
          <button type="button" class="campus-stage-btn" aria-label="下一校" @click="go(1)">
            <svg class="icon" aria-hidden="true" focusable="false"><use href="#i-arrow-right" /></svg>
          </button>
        </span>
      </div>
      <div
        class="campus-stage board-stage"
        id="campus-stage"
        role="tabpanel"
        :aria-labelledby="`campus-tab-${current.key}`"
      >
        <figure
          class="campus-stage-media"
          :style="{ '--photo-pos': current.photoPos || 'center', '--panorama-pos': current.panoramaPos || 'center 55%' }"
        >
          <img class="campus-stage-photo" :src="`/assets/${current.image}.webp`" :alt="`${current.name}校園外觀`">
        </figure>
        <div class="campus-stage-nav">
          <button type="button" class="campus-stage-btn" aria-label="上一校" @click="go(-1)">
            <svg class="icon" aria-hidden="true" focusable="false"><use href="#i-arrow-left" /></svg>
          </button>
          <button type="button" class="campus-stage-btn" aria-label="下一校" @click="go(1)">
            <svg class="icon" aria-hidden="true" focusable="false"><use href="#i-arrow-right" /></svg>
          </button>
        </div>
        <div class="board-plate">
          <div class="campus-stage-info">
            <h3 class="board-name">
              <span class="board-name-zh">{{ current.name }}</span>
              <span class="board-name-area">高雄 · {{ current.district }}</span>
            </h3>
            <dl class="board-facts">
              <div>
                <dt><svg class="icon" aria-hidden="true" focusable="false"><use href="#i-map-pin" /></svg>所在地</dt>
                <dd>{{ current.address }}</dd>
              </div>
              <div>
                <dt><svg class="icon" aria-hidden="true" focusable="false"><use href="#i-phone" /></svg>參觀專線</dt>
                <dd><a :href="`tel:${current.phone}`">{{ current.phone }}</a></dd>
              </div>
            </dl>
            <div class="campus-links">
              <a
                v-if="current.line"
                class="campus-link line"
                :href="current.line"
                target="_blank"
                rel="noopener noreferrer"
              >
                <span class="campus-link-badge">
                  <svg class="icon" aria-hidden="true" focusable="false"><use href="#i-line" /></svg>
                </span>
                <span class="campus-link-text">
                  <span class="campus-link-title">
                    加 LINE 好友
                    <svg class="icon" aria-hidden="true" focusable="false"><use href="#i-arrow-up-right" /></svg>
                  </span>
                  <small>{{ current.name }}官方帳號</small>
                </span>
              </a>
              <span v-else class="campus-link line is-pending">
                <span class="campus-link-badge">
                  <svg class="icon" aria-hidden="true" focusable="false"><use href="#i-line" /></svg>
                </span>
                <span class="campus-link-text">
                  <span class="campus-link-title">LINE 官方帳號</span>
                  <small>{{ current.name }}帳號待園方提供</small>
                </span>
              </span>
              <a class="campus-link facebook" :href="current.facebook" target="_blank" rel="noopener noreferrer">
                <span class="campus-link-badge">
                  <svg class="icon" aria-hidden="true" focusable="false"><use href="#i-facebook" /></svg>
                </span>
                <span class="campus-link-text">
                  <span class="campus-link-title">
                    Facebook 粉絲專頁
                    <svg class="icon" aria-hidden="true" focusable="false"><use href="#i-arrow-up-right" /></svg>
                  </span>
                  <small>{{ current.fbNote }}</small>
                </span>
              </a>
            </div>
          </div>
          <div class="campus-stage-actions">
            <BookingCta :campus-key="current.key" button-class="button primary">
              預約參觀{{ current.name }}
              <svg class="icon" aria-hidden="true" focusable="false"><use href="#i-arrow-right" /></svg>
            </BookingCta>
            <a
              class="text-link"
              :href="`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(current.address)}`"
              target="_blank"
              rel="noopener noreferrer"
            >
              在 Google 地圖開啟
              <svg class="icon" aria-hidden="true" focusable="false"><use href="#i-arrow-up-right" /></svg>
            </a>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
