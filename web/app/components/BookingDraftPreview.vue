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
    </div>
  </section>
  <!-- 橫幅例子的引言放在同意說明區塊外面：讀螢幕的人不會把它聽成同意說明的一部分。 -->
  <div v-if="bannerCampus" class="visit-page booking-draft booking-draft--banner-lead" data-step="2">
    <div class="container">
      <p class="booking-draft__note booking-draft__banner-note">分校頁最下方的預約橫幅，以{{ bannerCampus.name }}為例：</p>
    </div>
  </div>
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
/* 有橫幅例子時，同意說明與引言之間的 48px、引言與橫幅之間的 24px 都用內距排
   （用外距會穿出底色，兩塊之間露出一條頁面底色）。 */
.booking-draft.has-banner {
  padding-bottom: 0;
}
.booking-draft--banner-lead {
  padding-block: 48px 24px;
}
</style>
