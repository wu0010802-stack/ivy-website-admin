<script setup lang="ts">
import PageHeader from '../components/PageHeader.vue'
import SiteTrafficPanel from '../components/SiteTrafficPanel.vue'

// 成效統計（2026-10-13 起只留官網瀏覽與速度）：全站合計、不分校區，期間在面板裡選。
// 原本的「各校預約」與「預約孩子的班別」頁籤搬到招生入學 → 統計分析 → 參觀預約（BookingStatsPane），
// 2026-10-16 統計分析再抽成獨立的招生統計頁（限總管理者）；
// 舊連結帶的 ?tab= 不再有作用，一律顯示這一頁。
</script>

<template>
  <div class="page analytics">
    <PageHeader
      lead="官網的瀏覽量與網頁速度，全站五校合計。"
      more="各校參觀預約的結果（五校比較、到場與取消、每日變化、來源與預約鈕點擊）與預約孩子的班別，在「招生統計 → 參觀預約」（限總管理者）。"
    />
    <SiteTrafficPanel />
  </div>
</template>
