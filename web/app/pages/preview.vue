<script setup lang="ts">
// 私有草稿預覽殼：整頁 client-only，SSR 完全不輸出任何內容或管理端
// 資料，避免管理 session cookie／草稿內容混進公開快取或搜尋引擎快照。
definePageMeta({ ssr: false })

useHead({
  meta: [{ name: 'robots', content: 'noindex, nofollow' }]
})

const status = ref<'checking' | 'denied' | 'ready'>('checking')
const draft = ref<Awaited<ReturnType<typeof useDraftPreview>>['content']>(null)

onMounted(async () => {
  const result = await useDraftPreview()
  if (!result.authorized || !result.content) {
    status.value = 'denied'
    return
  }
  draft.value = result.content
  status.value = 'ready'
})
</script>

<template>
  <div class="preview-shell">
    <div v-if="status === 'checking'" class="preview-notice">
      <p>正在確認管理身分…</p>
    </div>
    <div v-else-if="status === 'denied'" class="preview-notice">
      <p>這個頁面只給已登入的後台管理者看草稿內容。</p>
      <p>請先登入後台管理系統，再重新整理這一頁。</p>
    </div>
    <template v-else-if="draft">
      <div class="preview-banner" role="note">草稿預覽 · 尚未發布的內容，僅管理者可見</div>
      <SiteHeader :content="draft" />
      <main id="main" tabindex="-1">
        <HeroVideo :hero="draft.home.hero" />
        <AboutSection :about="draft.home.about" />
        <DayExperience :day="draft.dayExperience" />
        <CampusBoard :board="draft.home.campusBoard" :campuses="draft.campuses" />
        <NewsDialog :news="draft.news" />
      </main>
      <SiteFooter :content="draft" />
    </template>
  </div>
</template>

<style scoped>
.preview-notice {
  padding: 80px 24px;
  text-align: center;
  font-size: var(--fs-lg);
}
.preview-banner {
  position: sticky;
  top: 0;
  z-index: 999;
  background: var(--ivy-dev-bar);
  color: var(--ivy-dev-bar-text);
  text-align: center;
  padding: 8px 16px;
  font-size: var(--fs-sm);
}
</style>
