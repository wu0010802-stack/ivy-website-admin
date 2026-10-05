<script setup lang="ts">
import { ANNI_MAP } from '~/utils/anniversary/map-data'

// 孩子畫的高雄地圖：不會動的線條（區界、湖、河、各區塗色）只輸出一次，
// 頁面上兩張地圖（桌機地圖卡、窄螢幕總覽）用 <use> 引用，HTML 不必放兩份路徑。
// 顏色與粗細寫在 <use> 的 class 上（路徑本身不設，才會繼承）。
const M = ANNI_MAP
</script>

<template>
  <svg class="anni-map-sprite" hidden aria-hidden="true" focusable="false">
    <defs>
      <path id="anni-map-border" :d="M.border" />
      <path id="anni-map-river" :d="M.river" />
      <template v-for="(w, i) in M.water" :key="w.name">
        <path :id="`anni-map-lake-${i}`" :d="w.shape" />
        <path :id="`anni-map-lake-fill-${i}`" :d="w.fill" />
        <path :id="`anni-map-lake-line-${i}`" :d="w.outline" />
      </template>
      <template v-for="d in M.districts" :key="d.name">
        <path v-if="d.fill" :id="`anni-map-fill-${d.campus}`" :d="d.fill" />
      </template>
    </defs>
  </svg>
</template>
