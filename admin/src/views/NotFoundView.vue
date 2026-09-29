<script setup lang="ts">
// 對不到任何頁面的網址（舊書籤、打錯字、改過名的頁面）。原本整頁空白、連側欄都沒有，
// 非技術人員只會覺得後台壞了；現在留在外框裡說明，並給一顆回起始頁的按鈕。
import { computed } from 'vue'
import { landingPath } from '../router/nav'
import { useAuthStore } from '../stores/auth'

const auth = useAuthStore()
const homePath = computed(() => landingPath(auth.user?.role))
</script>

<template>
  <div class="page page--narrow">
    <section class="panel">
      <div class="panel__body not-found">
        <h2>找不到這個頁面</h2>
        <p>網址可能打錯了，或這個頁面已經改名。可以從主選單找要用的功能，或回到起始頁。</p>
        <!-- 是換頁不是動作：用連結（可以中鍵開新分頁、報讀器念「連結」），外觀沿用主要按鈕。 -->
        <router-link :to="homePath" class="el-button el-button--primary not-found__home" data-test="not-found-home">回到起始頁</router-link>
      </div>
    </section>
  </div>
</template>

<style scoped>
.not-found {
  display: grid;
  justify-items: start;
  gap: 12px;
}

.not-found h2 {
  font-size: 17px;
}

.not-found p {
  margin: 0;
  color: var(--ink-2);
}

.not-found__home:hover {
  text-decoration: none;
}
</style>
