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
    class="section campuses campus-panorama campus-board campus-contact-b"
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
              <span class="board-name-area">高雄 · {{ current.district }}</span>
              <span class="board-name-zh">{{ current.name }}</span>
              <span class="board-name-en" lang="en">{{ current.key === 'international' ? 'INTERNATIONAL' : current.key.toUpperCase() }} CAMPUS</span>
            </h3>
            <div class="board-contact-group">
            <dl class="board-facts">
              <div>
                <dt><svg class="icon" aria-hidden="true" focusable="false"><use href="#i-map-pin" /></svg>校園位置</dt>
                <dd>
                  <a
                    class="board-address"
                    :href="`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(current.address)}`"
                    :aria-label="`${current.address}，在 Google 地圖開啟（另開分頁）`"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <span>{{ current.address }}</span>
                    <svg class="icon" aria-hidden="true" focusable="false"><use href="#i-arrow-up-right" /></svg>
                  </a>
                </dd>
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
                    LINE 好友
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
                    Facebook
                    <svg class="icon" aria-hidden="true" focusable="false"><use href="#i-arrow-up-right" /></svg>
                  </span>
                  <small>{{ current.fbNote }}</small>
                </span>
              </a>
            </div>
          </div>
          </div>
          <div class="campus-stage-actions">
            <BookingCta :campus-key="current.key" button-class="button primary">
              預約參觀{{ current.name }}
              <svg class="icon" aria-hidden="true" focusable="false"><use href="#i-arrow-right" /></svg>
            </BookingCta>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
/* 2026-09-21 approved direction B: campus identity leads the contact band. */
.campus-contact-b { --contact-muted: #b7c9bf; --contact-rule: #426253; }
.campus-contact-b .board-plate { grid-template-columns: minmax(0,1.25fr) minmax(0,1.1fr) auto; gap: 36px; padding: 40px 24px 46px; background: var(--deep); }
.campus-contact-b .campus-stage-info { display: contents; }
.campus-contact-b .board-name { font-family: var(--font-head); gap: 12px; }
.campus-contact-b .board-name-zh { font-size: clamp(40px,4.4vw,64px); letter-spacing: .03em; line-height: 1.2; white-space: nowrap; }
.campus-contact-b .board-name-area { color: var(--contact-muted); font-size: 13px; letter-spacing: .12em; }
.campus-contact-b .board-name-en { font-family: var(--font); font-size: 10px; font-weight: 400; letter-spacing: .2em; color: var(--contact-muted); }
.campus-contact-b .board-contact-group { border-left: 1px solid var(--contact-rule); padding-left: 32px; min-width: 0; }
.campus-contact-b .board-facts { gap: 14px; margin: 0; }
.campus-contact-b .board-facts div { display: block; }
.campus-contact-b .board-facts dt { display: flex; align-items: center; gap: 6px; color: var(--contact-muted); font-size: 12px; margin-bottom: 4px; }
.campus-contact-b .board-facts dt .icon { display: block; width: 16px; height: 16px; flex: 0 0 auto; color: var(--gold); }
.campus-contact-b .board-facts dd { font-size: 15px; }
.campus-contact-b .board-facts dd a { font-size: 18px; display: inline-flex; align-items: center; min-height: 44px; }
.campus-contact-b .board-facts dd .board-address { gap: 8px; max-width: 100%; font-size: 15px; }
.campus-contact-b .board-address span { text-decoration: underline; text-decoration-thickness: 1px; text-underline-offset: 4px; }
.campus-contact-b .board-address .icon { width: 14px; height: 14px; flex: 0 0 auto; color: var(--gold); }
.campus-contact-b .board-address:hover { color: var(--gold); }
.campus-contact-b .campus-links { border: 0; padding: 0; margin: 8px 0 0; flex-direction: row; gap: 8px 20px; }
.campus-contact-b .campus-link { min-height: 44px; gap: 8px; }
.campus-contact-b .campus-link-badge { display: grid; place-items: center; width: 20px; height: 20px; flex: 0 0 20px; border: 0; border-radius: 0; background: none; color: var(--contact-muted); }
.campus-contact-b .campus-link-badge .icon { width: 20px; height: 20px; }
.campus-contact-b .campus-link:hover .campus-link-badge { background: none; color: var(--gold); }
.campus-contact-b .campus-link-title { color: var(--contact-muted); font-size: 12px; font-weight: 400; }
.campus-contact-b .campus-link-title .icon { color: inherit; }
.campus-contact-b .campus-link:hover .campus-link-title { color: var(--paper); text-decoration: underline; }
.campus-contact-b .board-contact-group a:focus-visible { outline: 2px solid var(--gold); outline-offset: 4px; }
.campus-contact-b .campus-link.is-pending small { display: block; color: var(--contact-muted); font-size: 11px; }
.campus-contact-b .campus-stage-actions { align-items: stretch; gap: 8px; }
.campus-contact-b .campus-stage-actions :deep(.button) { border-radius: 999px; min-height: 56px; padding-inline: 24px; }
@media(max-width:1100px) {
 .campus-contact-b .board-plate { grid-template-columns: 1fr 1.2fr; gap: 24px; padding: 32px 24px; }
 .campus-contact-b .campus-stage-actions { grid-column: 1/-1; flex-direction: row; align-items: center; gap: 24px; }
}
@media(max-width:760px) {
 .campus-contact-b .board-plate { grid-template-columns: minmax(0,1fr); padding: 28px 20px; gap: 24px; }
 .campus-contact-b .board-name-zh { font-size: 48px; }
 .campus-contact-b .board-contact-group { border-left: 0; border-top: 1px solid var(--contact-rule); padding: 20px 0 0; }
 .campus-contact-b .campus-stage-actions { flex-direction: column; align-items: stretch; gap: 4px; }
 .campus-contact-b .campus-stage-actions :deep(.button) { width: 100%; }
}
</style>
