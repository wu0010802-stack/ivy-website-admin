<script setup lang="ts">
/**
 * 內建照片的 `<img>`：看得懂 AVIF 的瀏覽器下載 AVIF（約省三成），其餘照舊 WebP。
 *
 * 用法跟 `<img v-bind="responsiveImage(…)">` 一樣，把 helper 的輸出整包 `v-bind` 上來，
 * 其他屬性（class、alt、loading、fetchpriority、decoding、style、事件）原封不動轉給 `<img>`：
 *   <ResponsivePicture v-bind="pickImage(name, media, sizes)" alt="…" loading="lazy" />
 *
 * - 有 `avifSrcset`（只有 manifest 裡的內建照片會有，見 utils/responsive-image.ts）：輸出
 *   `<picture class="responsive-picture"><source type="image/avif"><img></picture>`。`<picture>` 一律
 *   `display: contents`（styles.css），`<img>` 的版面身分和原本一樣；只有選擇器寫成 `> img`、
 *   `:first-child` 這類看 DOM 父子關係的規則要另外處理。`<source>` 同時設 `display: none`：picture 是
 *   contents 時，空的 source 在 grid／flex 父元素裡也算一個項目，會佔掉一格把 `<img>` 擠走（入學頁新生兩部曲
 *   的照片曾被擠到第二欄，2026-11-05 版面比對抓到）；source 的挑選不受 display 影響。
 * - 沒有（後台素材、線稿、去背、插畫）：只輸出 `<img>`，DOM 和改版前一模一樣。
 *
 * `<source>` 的 `sizes` 取自 `<img>` 的 sizes（同一份），兩組 srcset 的寬度級距也相同，
 * 所以瀏覽器挑的是同一個寬度，只差格式。
 */
import { getCurrentInstance, ref } from 'vue'

defineOptions({ inheritAttrs: false })
defineProps<{ avifSrcset?: string }>()

const img = ref<HTMLImageElement | null>(null)
// 要拿到 <img> 本身的呼叫端（HeroVideo 看圖有沒有載完）用 `ref` 抓元件、再讀 `.img`。
defineExpose({ img })

// 呼叫端若是 <style scoped>，Vue 只把它的 data-v-* 加在子元件的「根元素」上；
// 根是 <picture> 時 <img> 少了這個屬性，`.cls[data-v-*]` 這類 scoped 規則就對不上。手動補上。
const scopeId = getCurrentInstance()?.vnode.scopeId
const scopeAttrs: Record<string, string> = scopeId ? { [scopeId]: '' } : {}
</script>

<template>
  <picture v-if="avifSrcset" class="responsive-picture">
    <source type="image/avif" :srcset="avifSrcset" :sizes="$attrs.sizes as string | undefined">
    <img ref="img" v-bind="{ ...$attrs, ...scopeAttrs }">
  </picture>
  <img v-else ref="img" v-bind="$attrs">
</template>
