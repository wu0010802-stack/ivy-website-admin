<script setup lang="ts">
import type { NewsBlock } from '~/types/site-content'

// 消息內文的影片（素材庫上傳，或粉專影片貼文轉成消息時帶進來的）。點了才載入：
// preload="none" 只顯示封面，不先抓影片檔。窄螢幕（760px 以下，同首屏與孩子的一天）換手機版。
const props = defineProps<{ block: Extract<NewsBlock, { type: 'video' }> }>()

// 影片框的寬高比（寬÷高）。封面是縮小過的畫面（例如 270×480），不先講好比例的話，
// 按下播放、影片的真實尺寸進來時框會跳一次大小。尺寸不明時先當橫式 16:9。
const ratio = props.block.width && props.block.height ? props.block.width / props.block.height : 16 / 9

const src = ref(props.block.videoSrc)
onMounted(() => {
  if (props.block.videoSrcMobile && window.matchMedia('(max-width: 760px)').matches) src.value = props.block.videoSrcMobile
})
</script>

<template>
  <figure v-if="block.videoSrc" class="hn-video">
    <video
      :src="src" :poster="block.poster || undefined" :width="block.width ?? undefined" :height="block.height ?? undefined"
      controls playsinline preload="none" :aria-label="block.caption || '影片'" :style="{ '--hn-video-ratio': ratio }"
    />
    <figcaption v-if="block.caption">{{ block.caption }}</figcaption>
  </figure>
</template>

<style scoped>
/* 直式影片（粉專 Reel 多半 9:16）不撐滿文字欄：限高、置中，橫式影片則跟文字欄同寬。
   寬度由比例算出來（高度上限 × 寬高比，最多跟文字欄同寬），封面載入前、播放前後都是同一個大小。 */
.hn-video { margin: 20px 0; }
.hn-video video {
  display: block;
  width: min(100%, calc(min(72vh, 640px) * var(--hn-video-ratio)));
  height: auto;
  aspect-ratio: var(--hn-video-ratio);
  margin-inline: auto;
  border-radius: 3px;
}
.hn-video figcaption { margin-top: 8px; font-size: var(--fs-xs); color: var(--hn-muted); text-align: center; }
</style>
