<script setup lang="ts">
import type { NuxtError } from '#app'

// 全站錯誤頁（2026-09-29 評析：原本掉進 Nuxt 預設的英文 404，沒有品牌也沒有路可走）。
// 找不到頁面時列出五校電話與入口；內容服務本身掛掉（503 等）時讀不到發布內容，只留回首頁與重新整理。
const props = defineProps<{ error: NuxtError }>()

const notFound = computed(() => props.error.statusCode === 404)
const { data } = usePublishedSite()
const content = computed(() => data.value?.content)
const campuses = computed(() => content.value?.campuses ?? [])

useHead({
  title: computed(() => `${notFound.value ? '找不到這一頁' : '網站暫時無法顯示'}｜常春藤教育機構`),
  meta: [{ name: 'robots', content: 'noindex' }]
})

const goHome = () => clearError({ redirect: '/' })
const reload = () => { window.location.reload() }
</script>

<template>
  <div>
    <IconSprite />
    <a class="skip" href="#main">跳至主要內容</a>
    <SiteHeader v-if="content" :content="content" />
    <main id="main" class="error-page" tabindex="-1">
      <div class="error-inner">
        <p class="error-code">{{ error.statusCode }}</p>
        <h1>{{ notFound ? '找不到這一頁' : '網站暫時無法顯示' }}</h1>
        <p class="error-lead">
          {{ notFound
            ? '網址可能打錯了，或這一頁已經搬家。可以從下面的校區找起，或回到首頁。'
            : '我們正在處理，請稍後重新整理。急著聯絡的話，可以直接打電話給校區。' }}
        </p>
        <div class="error-actions">
          <button class="button primary" type="button" @click="goHome">回到首頁</button>
          <NuxtLink v-if="notFound" class="error-text-link" to="/visit">預約參觀<svg class="icon" aria-hidden="true"><use href="#i-arrow-right" /></svg></NuxtLink>
          <button v-else class="error-text-link" type="button" @click="reload">重新整理</button>
        </div>
        <section v-if="campuses.length" class="error-campuses" aria-labelledby="error-campuses-title">
          <h2 id="error-campuses-title">五所校園</h2>
          <ul>
            <li v-for="campus in campuses" :key="campus.key">
              <span class="error-campus-name">{{ campus.name }}</span>
              <span class="error-campus-district">{{ campus.district }}</span>
              <a v-if="campus.phone" class="error-campus-phone" :href="`tel:${campus.phone}`"><svg class="icon" aria-hidden="true"><use href="#i-phone" /></svg>{{ campus.phone }}</a>
            </li>
          </ul>
        </section>
      </div>
    </main>
    <SiteFooter v-if="content" :content="content" />
  </div>
</template>

<style scoped>
.error-page {padding:clamp(56px,10vw,120px) 0 clamp(64px,10vw,128px);background:var(--paper);color:var(--text)}
.error-page:focus {outline:none}
.error-inner {width:min(720px,calc(100% - 40px));margin-inline:auto}
.error-code {margin:0 0 12px;color:var(--muted);font-size:var(--fs-sm);letter-spacing:.12em}
h1 {margin:0;color:var(--green);font:700 clamp(2rem,1.5rem + 2vw,2.75rem)/1.35 var(--font-head);letter-spacing:.02em}
.error-lead {max-width:34em;margin:20px 0 0;font-size:var(--fs-md);line-height:1.9;color:var(--muted)}
.error-actions {display:flex;flex-wrap:wrap;align-items:center;gap:12px 28px;margin-top:32px}
.error-text-link {display:inline-flex;align-items:center;gap:8px;min-height:44px;padding:0;border:0;background:none;color:var(--green);font:inherit;font-size:var(--fs-md);text-decoration:underline;text-underline-offset:6px;cursor:pointer}
.error-campuses {margin-top:clamp(48px,7vw,72px);padding-top:28px;border-top:1px solid var(--line)}
.error-campuses h2 {margin:0 0 8px;font:700 var(--fs-lg)/1.5 var(--font-head);color:var(--green)}
.error-campuses ul {margin:0;padding:0;list-style:none}
.error-campuses li {display:grid;grid-template-columns:minmax(6em,auto) 1fr auto;align-items:center;gap:4px 20px;padding:10px 0;border-bottom:1px solid var(--line)}
.error-campus-name {display:inline-flex;align-items:center;min-height:44px;color:var(--green);font-weight:700;text-decoration:underline;text-underline-offset:5px}
.error-campus-district {color:var(--muted);font-size:var(--fs-sm)}
.error-campus-phone {display:inline-flex;align-items:center;gap:8px;min-height:44px;color:var(--text);font-variant-numeric:tabular-nums}
.error-campus-phone .icon {width:16px;height:16px;color:var(--green)}
@media(max-width:520px) {
  .error-campuses li {grid-template-columns:1fr auto;row-gap:0}
  .error-campus-district {grid-row:2;grid-column:1}
  .error-campus-phone {grid-row:1 / span 2;grid-column:2}
}
</style>
