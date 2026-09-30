<script setup lang="ts">
// 分校頁最下方的預約橫幅。分校頁（CampusPageMain）與草稿預覽的預約文案頁
// （preview?page=visit）共用；三句文字讀預約文案，空白時用原本的字（utils/campus-banner.ts）。
import type { Campus } from '~/types/site-content'
import { campusBannerCopy, type CampusBannerSource } from '~/utils/campus-banner'

const props = defineProps<{ campus: Pick<Campus, 'key' | 'name'>; booking: CampusBannerSource }>()
const banner = computed(() => campusBannerCopy(props.booking, props.campus.name))
</script>

<template>
  <section class="visit-banner" data-cta-entry="campus_banner">
    <div class="container">
      <div>
        <span class="eyebrow">預約參觀</span>
        <h2 class="section-title">{{ banner.title }}</h2>
        <p>{{ banner.body }}</p>
      </div>
      <BookingCta :campus-key="campus.key" :label="banner.buttonLabel" button-class="button yellow" />
    </div>
  </section>
</template>
