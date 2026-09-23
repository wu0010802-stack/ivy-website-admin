<script setup lang="ts">
// 手機瀏覽器網址列用頁面的米白底（studio.css --paper：oklch(99% .008 95)）。
useHead({ meta: [{ name: 'theme-color', content: '#fdfcf6' }] })
</script>

<template>
  <div>
    <IconSprite />
    <a class="skip" href="#main">跳至主要內容</a>
    <NuxtPage />
  </div>
</template>
