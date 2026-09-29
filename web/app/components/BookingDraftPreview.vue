<script setup lang="ts">
import type { BookingContent, Campus } from '~/types/site-content'

// 草稿預覽專用（/preview?page=visit）：預約文案裡家長會看到的部分——表單
// 送出前的同意勾選與個資使用說明，以及分校頁最下方的預約橫幅（以其中一校
// 為例）。頁首按鈕文字與頁尾的說明連結由預覽頁本身的 SiteHeader／SiteFooter
// 顯示。真正的預約表單會讀已發布的同意文字並送出案件，所以這裡不放表單，
// 只照表單的樣式排出草稿文字，勾選框停用。
defineProps<{ booking: BookingContent; bannerCampus?: Pick<Campus, 'key' | 'name'> | null }>()
</script>

<template>
  <section class="visit-page booking-draft" :class="{ 'has-banner': bannerCampus }" data-step="2" aria-label="預約表單的同意說明（草稿）">
    <div class="container">
      <p class="booking-draft__note">預約表單最後一段：家長要勾選同意才能送出。以下是草稿文字，其他欄位與已發布的表單相同。</p>
      <div class="visit-contact-form booking-draft__consent">
        <label class="visit-consent"><input type="checkbox" disabled><span>{{ booking.consentText }}</span></label>
        <PrivacyNoticeDialog v-if="booking.privacyNotice" :notice="booking.privacyNotice" label="閱讀個資使用說明" trigger-class="visit-privacy-link" />
        <p v-else class="booking-draft__note">尚未填寫個資使用說明，表單與頁尾不會顯示說明連結。</p>
      </div>
      <p v-if="bannerCampus" class="booking-draft__note booking-draft__banner-note">分校頁最下方的預約橫幅，以{{ bannerCampus.name }}為例：</p>
    </div>
  </section>
  <CampusVisitBanner v-if="bannerCampus" :campus="bannerCampus" :booking="booking" />
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
.booking-draft__consent {
  max-width: 40em;
  margin-top: 24px;
}
.booking-draft.has-banner {
  padding-bottom: 24px;
}
.booking-draft__banner-note {
  margin-top: 48px;
}
</style>
