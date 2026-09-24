<script setup lang="ts">
// 手機瀏覽器網址列用頁面的米白底（tokens.css --paper：oklch(99% .008 95)）。<meta> 讀不到 CSS 變數，改色時兩邊一起改。
useHead({ meta: [{ name: 'theme-color', content: '#fdfcf6' }] })
</script>

<template>
  <div>
    <IconSprite />
    <a class="skip" href="#main">跳至主要內容</a>
    <NuxtPage />
  </div>
</template>
