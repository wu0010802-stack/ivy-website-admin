<script setup lang="ts">
// avif-picture.spec.ts 用：呼叫端是 <style scoped> 時，<picture> 裡的 <img> 也要拿到呼叫端的 data-v-*。
import ResponsivePicture from '../../app/components/ResponsivePicture.vue'

defineProps<{ avifSrcset?: string }>()
</script>

<template>
  <div class="host">
    <ResponsivePicture class="photo" src="/a.webp" srcset="/a-480.webp 480w, /a.webp 800w" sizes="100vw" :avif-srcset="avifSrcset" alt="" />
  </div>
</template>

<style scoped>
.host .photo { display: block; }
</style>
