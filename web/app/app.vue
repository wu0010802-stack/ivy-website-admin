<template>
  <div>
    <IconSprite />
    <a class="skip" href="#main">跳至主要內容</a>
    <!-- SPA 換頁時替讀屏唸出新頁標題（2026-10-12）：原本換頁後焦點留在 body、也沒有任何播報。 -->
    <NuxtRouteAnnouncer />
    <NuxtPage />
  </div>
</template>
