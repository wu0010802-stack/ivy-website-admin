// 關於常春藤頁（AboutContent）的固定內容：內建照片說明、核心素養、六大領域、第三章蠟筆畫的卡紙位置與濾鏡。
// 文字與照片在後台（about_page），不在這裡。2026-10-30 換版後桌機手機同一套（原本桌機立體書、手機卡紙疊各一份）。

// 內建照片的說明（不開放編輯；後台換了照片就用後台的說明，沒填用素材庫的說明）
// 首屏照片 2026-11-03 換成中都濕地校外教學（園方雲端「未分類素材區／照片」），原本的創辦人合照只留在第三章窗戶
export const HERO_ALT = '校外教學走在步道上，兩個孩子回頭對著鏡頭笑，老師在旁邊陪著'
export const HOPE_ALT = '孩子們笑著圍在戴眼鏡的長輩身邊，大家開心地擠在一起'

export const LITERACIES = ['覺知辨識', '表達溝通', '關懷合作', '推理賞析', '想像創造', '自主管理']

// 六大領域：圓點與六圈（AboutWholePerson）同色、同順序。detail 是點開後的一段說明（2026-10-29 Jason：每項寫深一點、
// 用展開的方式讀，也讓搜尋讀得到文字），依教育部《幼兒園教保活動課程大綱》各領域的說明改寫，
// 講的是課綱的方向，不寫成本園獨有的做法。
// photo／alt（2026-11-10）：每個領域配一張站上現有的實拍（特色教學、環境頁用過的園方照片），讓課綱名詞看得到畫面；
// 是內建照片、不開放後台換，照片只表示「這個領域大概長這樣」，不代表那張照片當下在上哪一課。
export const DOMAINS = [
  { name: '身體動作與健康', color: 'var(--ivy-whole-body)', photo: 'cur-daily-motor', alt: '三個孩子在草地上練足球，把球停進紅色圈圈', detail: '從自己吃飯、穿衣，到遊戲和運動，讓孩子喜歡動、懂得照顧自己的身體。先把大肌肉練好，再慢慢做更精細的動作；重點不在體適能訓練。' },
  { name: '認知', color: 'var(--ivy-whole-cognition)', photo: 'cur-daily-materials', alt: '孩子們圍在木框邊，專心看綠色的光打到小鏡子上再反射出去', detail: '認知不是背知識，而是學會找答案：蒐集訊息、整理訊息，解決生活裡遇到的問題。用手指量長短、比較菜蟲和毛毛蟲，數學和科學就在裡面。' },
  { name: '語文', color: 'var(--ivy-whole-language)', photo: 'cur-daily-reading', alt: '孩子們坐在圖書室的坐墊上，各自翻開一本繪本', detail: '語文是和人溝通的方式：聽懂別人的話、看懂圖像和文字，也能把自己的想法說清楚。注音從玩聲音開始，不急著背、也不急著寫。' },
  { name: '社會', color: 'var(--ivy-whole-social)', photo: 'env-hero-hug', alt: '教室裡兩個孩子緊緊抱在一起，旁邊的同學也在互相擁抱', detail: '認識自己、關心身邊的人，也愛護環境。孩子在團體裡長出自信，學會和別人、和環境好好相處。' },
  { name: '情緒', color: 'var(--ivy-whole-emotion)', photo: 'env-care-comfort', alt: '大人抱著剛哭過的女孩，用手指輕輕幫她擦臉', detail: '看見自己和別人的情緒，知道情緒從哪裡來，再用合適的方法調整、說出來。情緒穩了，才能專心學習、和別人合作。' },
  { name: '美感', color: 'var(--ivy-whole-aesthetic)', photo: 'cur-art', alt: '孩子們一起在大塊布上塗顏色', detail: '用眼睛、耳朵和雙手感受身邊的美，自在地想像和創作。美感不是才藝課，而是一次次參與裡慢慢累積的感受力。' }
]

// 年數（2026-10-31）：後台內建的首屏介紹與第一章標題寫死「近三十年」，2027 年就不對了；原文沒改過時，改由創校年份
// （沿革第一站）與今年（台北）算。不放 utils/public-copy.ts：已發布內容整份快取到下一次發布
// （server/utils/published-site.ts 收到 304 就沿用），放那裡跨年不會重算。後台改寫過的文字照後台。
// 第一章標題原本「近三十年，長出五所校園。」和首屏大標「從一間幼兒園，長成五所校園。」重複，改講今年是第幾年。
export const STORY_TITLE_ORIGINAL = '近三十年，\n長出五所校園。'
const HERO_LEDE_ORIGINAL = '1997 年，第一間常春藤在高雄義華路成立。近三十年來，我們守著同一份教育理念與專業保育，陪孩子過一段獨一無二的童年。'
const TENS = ['', '十', '二十', '三十', '四十', '五十', '六十', '七十', '八十', '九十']

/** 創校至今幾年的說法：整十年「三十年」、差一兩年到下個十年「近三十年」、其他「三十多年」。n＝今年減創校年。 */
export function yearsSpoken(n: number): string {
  if (n < 10) return `${n} 年`
  const tens = Math.floor(n / 10)
  const ones = n % 10
  if (ones === 0) return `${TENS[tens]}年`
  if (ones >= 8) return `近${TENS[tens + 1]}年`
  return `${TENS[tens]}多年`
}

/** 第一章標題（兩行）：創校那年是第 1 年，2026 年「走到今年⏎是第 30 年」；整十年寫「滿 30 年」。
 *  標題大字不放逗號、句號（2026-11-03，見 page-content.ts 的 plainTitleLine）。 */
export function storyYearTitle(founded: number, year: number): string[] {
  const n = year - founded
  return ['走到今年', n > 0 && n % 10 === 0 ? `滿 ${n} 年` : `是第 ${n + 1} 年`]
}

/** 首屏介紹：內建原文的「近三十年來」換成算出來的年數（從同一句寫的 1997 算）；後台改寫過就照後台。 */
export function aboutHeroLede(lede: string, year: number): string {
  return lede === HERO_LEDE_ORIGINAL ? lede.replace('近三十年來', `${yearsSpoken(year - 1997)}來`) : lede
}

// 我們的期許：卡紙與煙的位置（虛擬座標：一頁寬 620、從頁底往上量，同 scripts/about-crayon/build.mjs；
// 一個單位多寬是 about.css 的 --v，畫最寬 560px）。水平以畫面中線為準（310）。
// 煙的框（120×180，煙囪頂在框裡的 (90, 172)）要對準房子卡紙上的煙囪頂（房子座標 (218, 46)）。
// 2026-11-10 房子放大兩成（300×340 → 360×408，仍以中線為準）：窗戶照片是這章唯一一張人的照片，11-09 放到窗戶的
// 一半寬後桌機仍只有 121px。兩棵樹位置不動，被房子蓋住一點邊（房子在前）；煙囪頂跟著放大到 (218, 46) × 1.2，
// 畫的高度 540 → 600 個單位（about.css 的 .abh-art），煙才不會頂到上面的字。
const HOUSE_SCALE = 1.2
const HOUSE = { x: 310 - 300 * HOUSE_SCALE / 2, y: 102, w: 300 * HOUSE_SCALE, h: 340 * HOUSE_SCALE }
export const SCENE = {
  treeL: { x: 30, y: 94, w: 140, h: 210 },
  treeR: { x: 494, y: 90, w: 116, h: 220 },
  house: HOUSE,
  smoke: { x: HOUSE.x + 218 * HOUSE_SCALE - 90, y: HOUSE.y + HOUSE.h - 46 * HOUSE_SCALE + 6 - 8, w: 120, h: 180 }
}
export const sceneStyle = (item: { x: number, y: number, w: number, h: number }, z = 1) => ({
  '--x': `calc(50% + ${item.x - 310} * var(--v))`, '--y': `calc(${item.y} * var(--v))`, '--w': `calc(${item.w} * var(--v))`, '--ar': `${item.w} / ${item.h}`, '--z': z
})
// 蠟筆濾鏡（整頁共用 #abk-wax，AboutContent 在 main 底下放一份）：紙紋雜訊當遮罩（蠟跳過紙的凹處），
// 再用低頻雜訊推一點線條（手抖）。用 v-html 放進去：fe* 元素寫在模板裡，vue-tsc 比對 SVG 屬性型別會比到 TS2321
// （連帶 server/api/public-site.get.ts 報錯，2026-10-19 實測）。
export const WAX_FILTER = '<filter id="abk-wax" x="-8%" y="-8%" width="116%" height="116%" color-interpolation-filters="sRGB">'
  + '<feTurbulence type="fractalNoise" baseFrequency=".62" numOctaves="3" seed="4" result="tooth"/>'
  + '<feColorMatrix in="tooth" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  4.2 0 0 0 -1.25" result="mask"/>'
  + '<feComposite in="SourceGraphic" in2="mask" operator="in" result="waxed"/>'
  + '<feTurbulence type="fractalNoise" baseFrequency=".035" numOctaves="2" seed="9" result="wobble"/>'
  + '<feDisplacementMap in="waxed" in2="wobble" scale="3" xChannelSelector="R" yChannelSelector="G"/></filter>'
