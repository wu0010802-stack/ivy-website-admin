// 關於常春藤頁桌機立體書（AboutContent）與手機卡紙疊（AboutSheets，2026-10-25）共用的固定內容：
// 內建照片說明、沿革五站的卡紙色、核心素養、第三章蠟筆畫的卡紙位置與濾鏡。文字與照片在後台（about_page），不在這裡。

// 內建照片的說明（不開放編輯；後台換了照片就用後台的說明，沒填用素材庫的說明）
export const HERO_ALT = '孩子們笑著圍在創辦人身邊，大家擠在一起'
export const HERO_BACK_ALT = '戶外教學時，孩子們笑著指向自己的發現'
export const HOPE_ALT = '孩子們笑著圍在戴眼鏡的長輩身邊，大家開心地擠在一起'

// 沿革五站的卡紙底色（依成立順序輪流用品牌色）；tint＝沿革那一列上色的濃度（%）：淡色卡紙要混多一點才看得出來，
// 各列對米白都約 1.1–1.2:1（2026-10-13）。
export const MILESTONE_LOOKS: Array<{ color: string, tint: number }> = [
  { color: 'var(--yellow)', tint: 30 },
  { color: 'var(--studio-blue)', tint: 36 },
  { color: 'var(--studio-sage)', tint: 85 },
  { color: 'var(--mint)', tint: 45 },
  { color: 'var(--studio-orange)', tint: 20 }
]
export const milestoneLook = (i: number) => MILESTONE_LOOKS[i % MILESTONE_LOOKS.length]!

export const LITERACIES = ['覺知辨識', '表達溝通', '關懷合作', '推理賞析', '想像創造', '自主管理']

// 我們的期許：卡紙與煙的位置（虛擬座標：一頁寬 620、從頁底往上量，同 scripts/about-crayon/build.mjs；
// 一個單位多寬是 about.css／about-sheets.css 的 --v）。水平以頁面中線為準：桌機中線就是 310，手機卡紙比 480px 寬時整組置中。
// 煙的框（120×180，煙囪頂在框裡的 (90, 172)）要對準房子卡紙上的煙囪頂（房子座標 (218, 46)）。
export const SCENE = {
  treeL: { x: 30, y: 94, w: 140, h: 210 },
  treeR: { x: 494, y: 90, w: 116, h: 220 },
  house: { x: 180, y: 102, w: 300, h: 340 },
  smoke: { x: 180 + 218 - 90, y: 102 + 340 - 46 + 6 - 8, w: 120, h: 180 }
}
export const sceneStyle = (item: { x: number, y: number, w: number, h: number }, z = 1) => ({
  '--x': `calc(50% + ${item.x - 310} * var(--v))`, '--y': `calc(${item.y} * var(--v))`, '--w': `calc(${item.w} * var(--v))`, '--ar': `${item.w} / ${item.h}`, '--z': z
})
// 蠟筆濾鏡（整頁共用 #abk-wax，AboutContent 在 main 底下放一份，桌機與手機都用它）：紙紋雜訊當遮罩（蠟跳過紙的凹處），
// 再用低頻雜訊推一點線條（手抖）。用 v-html 放進去：fe* 元素寫在模板裡，vue-tsc 比對 SVG 屬性型別會比到 TS2321
// （連帶 server/api/public-site.get.ts 報錯，2026-10-19 實測）。
export const WAX_FILTER = '<filter id="abk-wax" x="-8%" y="-8%" width="116%" height="116%" color-interpolation-filters="sRGB">'
  + '<feTurbulence type="fractalNoise" baseFrequency=".62" numOctaves="3" seed="4" result="tooth"/>'
  + '<feColorMatrix in="tooth" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  4.2 0 0 0 -1.25" result="mask"/>'
  + '<feComposite in="SourceGraphic" in2="mask" operator="in" result="waxed"/>'
  + '<feTurbulence type="fractalNoise" baseFrequency=".035" numOctaves="2" seed="9" result="wobble"/>'
  + '<feDisplacementMap in="waxed" in2="wobble" scale="3" xChannelSelector="R" yChannelSelector="G"/></filter>'
