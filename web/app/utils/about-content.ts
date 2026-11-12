// 關於常春藤頁（AboutContent）的固定內容：內建照片說明、核心素養、六大領域、年數換算、沿革用的小工具。
// 文字與照片在後台（about_page），不在這裡。2026-11-11 整頁重做「紅磚上的常春藤」（見 AboutContent.vue 開頭）。

// 內建照片的說明（不開放編輯；後台換了照片就用後台的說明，沒填用素材庫的說明）
// 首屏照片 2026-11-03 換成中都濕地校外教學（園方雲端「未分類素材區／照片」），原本的創辦人合照只留在第三章
export const HERO_ALT = '校外教學走在步道上，兩個孩子回頭對著鏡頭笑，老師在旁邊陪著'
export const HOPE_ALT = '孩子們笑著圍在戴眼鏡的長輩身邊，大家開心地擠在一起'
// 第三章內建照片底下的一行字：照片裡的長輩是創辦人（業主 2026-10-02 確認；姓名未提供，不寫名字）。
// 後台換了照片就不出現（換上的照片不一定是創辦人）。
export const HOPE_CAPTION = '創辦人和常春藤的孩子'

export const LITERACIES = ['覺知辨識', '表達溝通', '關懷合作', '推理賞析', '想像創造', '自主管理']

// 六大領域：一排六張實拍，選到的那張展開、底下換那一段說明。detail 依教育部《幼兒園教保活動課程大綱》
// 各領域的說明改寫（2026-10-29 Jason：每項寫深一點，也讓搜尋讀得到文字），講的是課綱的方向，不寫成本園獨有的做法。
// photo／alt：每個領域配一張園方的實拍，讓課綱名詞看得到畫面；是內建照片、不開放後台換，照片只表示「這個領域
// 大概長這樣」，不代表那張照片當下在上哪一課。2026-11-12 使用者說原本那六張（特色教學、環境頁用過的）和其他分頁
// 重複了，換成這頁專用的六張 about-whole-*，取自園方雲端「未分類素材區／照片」：足球賽（2024-09）、中都濕地校外教學
// （2025-05）、故事車（2024-04）、中秋節（2024-09）、感恩節（2024-11）、聖誕迷宮彩繪（2024-12），都裁成 4:3、1800×1350。
// focus／zoom：照片收成窄窄一條時要對準哪裡（object-position 與放大的原點，「水平 垂直」）、放大幾倍，
// 讓每一條都看得到一張完整的臉（2026-11-11 用 116×540 的窄條逐張試過；人拍得近的兩張不放大）。展開時回到原寸。
// 六個領域原本各有一個顏色（六圈用的 --ivy-whole-*），2026-11-11 起名牌統一米白底、選到的暖黃，不再用六色。
export const DOMAINS = [
  { name: '身體動作與健康', photo: 'about-whole-body', focus: '46% 30%', zoom: 1.3, alt: '足球賽上，兩個穿背心的男孩追著球跑', detail: '從自己吃飯、穿衣，到遊戲和運動，讓孩子喜歡動、懂得照顧自己的身體。先把大肌肉練好，再慢慢做更精細的動作；重點不在體適能訓練。' },
  { name: '認知', photo: 'about-whole-cognition', focus: '38% 34%', zoom: 1, alt: '戴眼鏡的男孩雙手捧著一片葉子，湊到鼻子前聞', detail: '認知不是背知識，而是學會找答案：蒐集訊息、整理訊息，解決生活裡遇到的問題。用手指量長短、比較菜蟲和毛毛蟲，數學和科學就在裡面。' },
  { name: '語文', photo: 'about-whole-language', focus: '33% 38%', zoom: 1.35, alt: '孩子們坐在台階上，抬頭聽老師拿著繪本說故事', detail: '語文是和人溝通的方式：聽懂別人的話、看懂圖像和文字，也能把自己的想法說清楚。注音從玩聲音開始，不急著背、也不急著寫。' },
  { name: '社會', photo: 'about-whole-social', focus: '33% 45%', zoom: 1.2, alt: '兩個穿園服的女孩笑著一起往前跑', detail: '認識自己、關心身邊的人，也愛護環境。孩子在團體裡長出自信，學會和別人、和環境好好相處。' },
  { name: '情緒', photo: 'about-whole-emotion', focus: '48% 42%', zoom: 1.05, alt: '女孩盤腿坐在草地邊，雙手在胸前比愛心，對著鏡頭笑', detail: '看見自己和別人的情緒，知道情緒從哪裡來，再用合適的方法調整、說出來。情緒穩了，才能專心學習、和別人合作。' },
  { name: '美感', photo: 'about-whole-art', focus: '57% 44%', zoom: 1.2, alt: '綁馬尾的女孩拿著綠色的筆，專心在紙箱牆上畫畫', detail: '用眼睛、耳朵和雙手感受身邊的美，自在地想像和創作。美感不是才藝課，而是一次次參與裡慢慢累積的感受力。' }
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

/** 今年是第幾年（年份里程表走過最後一站時寫在年份底下）：同第一章標題的算法，「第 30 年」／整十年「滿 30 年」。 */
export function yearsRunning(founded: number, year: number): string {
  const n = year - founded
  return n > 0 && n % 10 === 0 ? `滿 ${n} 年` : `第 ${n + 1} 年`
}

/** 首屏介紹：內建原文的「近三十年來」換成算出來的年數（從同一句寫的 1997 算）；後台改寫過就照後台。 */
export function aboutHeroLede(lede: string, year: number): string {
  return lede === HERO_LEDE_ORIGINAL ? lede.replace('近三十年來', `${yearsSpoken(year - 1997)}來`) : lede
}

/** 年份跳字（AboutYear）一欄一個數字：固定四位，不足補 0。 */
export function yearDigits(year: number): number[] {
  return String(Math.max(0, Math.trunc(year))).padStart(4, '0').slice(-4).split('').map(Number)
}

/** 引言拆成一句一句（標點跟著前一句），第三章隨捲動一句一句亮起來；沒有標點的整段算一句。 */
export function quotePhrases(quote: string): string[] {
  return quote.match(/[^，。；、！？]+[，。；、！？」』]*/g) ?? [quote]
}
