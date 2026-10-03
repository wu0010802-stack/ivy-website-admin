<script setup lang="ts">
// 關於頁第一章的紀念章（2026-10-03 取代拉紙條；比稿 design/about-medal-directions-20261003/，使用者選「章名旁＋連續轉」）。
// CSS 3D 硬幣：兩面＋九層金色圓片當厚度，不載 three。面圖由 scripts/about-medal/build.py 產生：front＝大校徽正面、
// label＝米白正面小校徽、back＝墨綠反面金色剪影；校名／SINCE／年份用 SVG 疊上。2026-10-04 使用者要保留正面，改成正反交替：
// A 面印偶數步（大校徽，之後 2001、2020 用米白正面），B 面印奇數步（1997、2005、2021 用墨綠反面），見 about-popup.ts 的 medalSequence。
// 捲動時 utils/about-popup.ts 寫 --medal-turn（轉了幾個半圈）、--medal-lift（翻面時跳起）、--medal-frac（光澤位置），
// 並把背對讀者那一面換成下一步。沒有 JS 時停在大校徽。純裝飾，對報讀器隱藏（左頁沿革是同樣的資訊）。
defineProps<{ stops: { name: string, year: number }[] }>()
const FACES = ['a', 'b'] as const
</script>

<template>
  <div class="abk-medal" data-medal aria-hidden="true">
    <span class="abk-medal-shadow" />
    <span class="abk-medal-hop">
      <span class="abk-medal-coin">
        <span class="abk-medal-edge"><i v-for="k in 9" :key="k" :style="{ '--k': k - 1 }" /></span>
        <span v-for="side in FACES" :key="side" class="abk-medal-face" :class="`is-${side}`" :data-face="side" :data-state="side === 'a' ? 0 : 1" :data-look="side === 'a' ? 'crest' : 'back'">
          <img class="abk-medal-crest" src="/assets/about-medal/front.webp" alt="" width="256" height="256" loading="lazy" decoding="async">
          <span class="abk-medal-text">
            <img class="abk-medal-front" src="/assets/about-medal/label.webp" alt="" width="256" height="256" loading="lazy" decoding="async">
            <img class="abk-medal-back" src="/assets/about-medal/back.webp" alt="" width="256" height="256" loading="lazy" decoding="async">
            <svg viewBox="0 0 200 200" focusable="false">
              <text class="is-name" x="100" y="114">{{ side === 'b' ? stops[0]?.name : '' }}</text>
              <text class="is-since" x="100" y="133">SINCE</text>
              <text class="is-year" x="100" y="164">{{ side === 'b' ? stops[0]?.year : '' }}</text>
            </svg>
          </span>
          <i class="abk-medal-glint" />
        </span>
      </span>
    </span>
  </div>
</template>

<style scoped>
/* 尺寸 --size 由使用端給；靜止時往左偏 18°、往後仰 9°，看得到一點金邊厚度（about-popup.ts 的 MEDAL_YAW 要同步） */
.abk-medal {--size:128px;--half:calc(var(--size) * .036);--gold-deep:color-mix(in oklch,var(--gold) 55%,rgb(var(--ink)));--gold-light:color-mix(in oklch,var(--gold) 35%,var(--paper));position:relative;width:var(--size);height:var(--size);perspective:calc(var(--size) * 6);pointer-events:none;user-select:none}
.abk-medal-shadow {position:absolute;left:12%;right:12%;bottom:-9%;height:14%;border-radius:50%;background:radial-gradient(closest-side,rgb(var(--ink)/.34),rgb(var(--ink)/0));opacity:calc(1 - var(--medal-lift,0) * .45);transform:scale(calc(1 - var(--medal-lift,0) * .28))}
.abk-medal-hop,.abk-medal-coin {position:absolute;inset:0;transform-style:preserve-3d}
.abk-medal-hop {transform:translateY(calc(var(--medal-lift,0) * -16%))}
.abk-medal-coin {transform:rotateX(9deg) rotateY(calc(var(--medal-turn,0) * 180deg - 18deg))}
.abk-medal-edge i {position:absolute;inset:1.2%;border-radius:50%;background:linear-gradient(100deg,var(--gold-deep),var(--gold) 45%,var(--gold-light) 52%,var(--gold) 60%,var(--gold-deep));transform:translateZ(calc((var(--k) / 8 - .5) * 2 * var(--half)))}
.abk-medal-face {position:absolute;inset:0;border-radius:50%;overflow:hidden;backface-visibility:hidden;-webkit-backface-visibility:hidden}
.abk-medal-face.is-a {transform:translateZ(var(--half))}
.abk-medal-face.is-b {transform:rotateY(180deg) translateZ(var(--half))}
.abk-medal-face img,.abk-medal-back,.abk-medal-face svg {position:absolute;inset:0;display:block;width:100%;height:100%}
/* 三種樣子：crest＝大校徽正面；front＝米白正面小校徽＋墨綠字；back＝墨綠反面金色剪影＋金字。
   用透明度切換，不用 display:none（延遲載入的圖才會先載好） */
.abk-medal-text,.abk-medal-front,.abk-medal-back {opacity:0}
.abk-medal-face:not([data-look="crest"]) .abk-medal-crest {opacity:0}
.abk-medal-face:not([data-look="crest"]) .abk-medal-text {opacity:1}
.abk-medal-face[data-look="front"] .abk-medal-front,.abk-medal-face[data-look="back"] .abk-medal-back {opacity:1}
.abk-medal-face svg {font-family:var(--font-head);font-weight:700;fill:var(--gold);text-anchor:middle}
.abk-medal-face[data-look="front"] svg {fill:var(--ivy-forest)}
/* 正面的小校徽比反面剪影大：校名、SINCE 往下挪一點，年份小一號往上收，不碰米白圓心下緣 */
.abk-medal-face[data-look="front"] .is-name {transform:translateY(4px)}
.abk-medal-face[data-look="front"] .is-since {transform:translateY(2px)}
.abk-medal-face[data-look="front"] .is-year {font-size:27px;transform:translateY(-4px)}
.is-name {font-size:21px;letter-spacing:2px}
.is-since {font-size:8.5px;letter-spacing:4px}
.is-year {font-size:30px;letter-spacing:2px}
.abk-medal-glint {position:absolute;inset:0;background:linear-gradient(115deg,rgb(var(--on-dark)/0) 38%,rgb(var(--on-dark)/.55) 50%,rgb(var(--on-dark)/0) 62%) no-repeat;background-size:260% 100%;background-position:calc(120% - var(--medal-frac,0) * 140%) 0;mix-blend-mode:soft-light}
@media (forced-colors:active) {
  .abk-medal {display:none}
}
</style>
