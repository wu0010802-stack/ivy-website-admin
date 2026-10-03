<script setup lang="ts">
import type { BookingContent } from '~/types/site-content'

// 草稿預覽專用（/preview?page=visit）：預約文案裡家長會看到的部分——表單
// 送出鈕前的個資使用說明入口。
// 頁首按鈕文字與頁尾的說明連結由預覽頁本身的 SiteHeader／SiteFooter 顯示。
// 2026-10-02 起官網預約不用勾選同意，不再預覽同意條款文字。
defineProps<{ booking: BookingContent }>()
</script>

<template>
  <section class="visit-page booking-draft" data-step="2" aria-label="預約表單的個資使用說明（草稿）">
    <div class="container">
      <p class="booking-draft__note">預約表單送出鈕前：家長可以打開個資使用說明（不用勾選同意）。其他欄位與已發布的表單相同。</p>
      <div class="visit-contact-form booking-draft__privacy">
        <PrivacyNoticeDialog v-if="booking.privacyNotice" :notice="booking.privacyNotice" label="閱讀個資使用說明" trigger-class="visit-privacy-link" />
        <p v-else class="booking-draft__note">尚未填寫個資使用說明，表單與頁尾不會顯示說明連結。</p>
      </div>
    </div>
  </section>
</template>

<style scoped src="../assets/css/visit-booking.css"></style>
<style scoped>
.booking-draft {
  padding-block: 48px 72px;
}
.booking-draft__note {
  max-width: 40em;
  font-size: var(--fs-sm);
  color: var(--visit-muted);
}
.booking-draft__privacy {
  max-width: 40em;
  margin-top: 24px;
}
</style>
