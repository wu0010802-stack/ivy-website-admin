<script setup lang="ts">
// 常春藤環境頁主體（/environment）。2026-11-17 改成「拱窗打開」版（比稿 design/environment-grand-directions-20261117/ 的方向 B，
// 使用者說 10-30 的木頭積木版「不夠有份量、不夠驚豔」）：積木的形狀與顏色照舊，但每塊積木都是一扇窗，捲動時打開——
// 首屏的拱窗展開成一整幕、五顆心長成一張大照片、六個空間在同一扇窗裡變形、一天五餐沿著圓點小路一盤盤上桌。規則記在 DESIGN.md「環境頁拱窗打開」。
// 內容：前三章的文字與照片讀後台「常春藤環境頁」（environment_page，預設＝fixture 的 environmentPage），清單照索引對應下面的常數；
// 第四章「五所校園」讀後台發布的各校校園探索（campuses[].tourScenes）。
// 照片不放說明與註解（使用者 10-30）：首屏與保育主照片的圖說、照片上的便條、小路與選校提示、校園探索各景的說明句都不畫；
// 後台欄位照舊保留。戶外廣場的「明華校」是校別標示（後台 campusLabel），照畫。
// 2026-09-28 使用者裁定：這一頁不放預約參觀（全站共用的頁首預約鈕除外）。
// 伺服器輸出的就是完整內容（每扇窗都是打開的）；捲動敘事在 utils/environment-windows.ts，只在瀏覽器動態載入，
// 載入失敗、沒有 JS 或偏好減少動態時，頁面就是打開完成的樣子。桌機首屏「拱窗關著＋大標」的起始畫面由 CSS 媒體查詢成立，不等 JS。
import { h, type FunctionalComponent } from 'vue'
import type { Campus, EnvironmentPageContent, TourScene } from '~/types/site-content'
import { environmentHeroSources, type MediaImage } from '~/utils/media-image'
import { ENVIRONMENT_HERO_WIDE_MEDIA, responsiveImage } from '~/utils/responsive-image'
import { pageMarkedLines, pagePhotoAlt, pagePhotoAttrs, pagePhotoStyle, pageTitleLines, plainTitle } from '~/utils/page-content'
import { responsiveTourImage } from '~/utils/tour-image'
import { mealBookLink } from '~/utils/meal-book'
import { phraseChunks } from '~/utils/phrase'
import { campusMapUrl } from '~/utils/site-links'
import { isLivePreview } from '~/utils/draft-preview'
import type { EnvironmentWindows } from '~/utils/environment-windows'

// admission：後台「全站設定」的入學資訊分頁開關（隱藏時 /admission 回 404，結尾「還可以看看這幾頁」不放入學資訊）
const props = withDefaults(defineProps<{ campuses: Campus[]; page: EnvironmentPageContent; admission?: boolean }>(), { admission: true })

// ---------- 短說明不從詞中間斷行（utils/phrase.ts） ----------
// 句子切成小段、小段之間放 <wbr>，外層 .renv-phr 設 word-break: keep-all，換行只會落在小段之間。
// 斷詞用執行環境的 Intl.Segmenter：伺服器（Node）和訪客的瀏覽器詞典版本不同，切出來可能差一兩處，hydrate 會對不上。
// 所以伺服器算好的結果放進 useState 一起送到瀏覽器，hydrate 直接沿用；只有站內換頁、後台即時預覽改了字，才在瀏覽器現算。
const phraseStore = useState<Record<string, string[]>>('environment-phrases', () => ({}))
// 伺服器：邊渲染邊記進 phraseStore（渲染完才序列化）；瀏覽器：拷貝一份普通物件當快取，現算的不寫回響應式狀態（渲染中不改狀態）
const phraseCache: Record<string, string[]> = import.meta.client ? { ...phraseStore.value } : phraseStore.value
const Phrases: FunctionalComponent<{ text: string }> = ({ text }) => {
  const chunks = (phraseCache[text] ??= phraseChunks(text))
  return chunks.length > 1 ? h('span', { class: 'renv-phr' }, chunks.flatMap((chunk, i) => (i ? [h('wbr'), chunk] : [chunk]))) : text
}
Phrases.props = { text: { type: String, required: true } }

// 積木色：c-<名> 在 environment.css 對到正面色（--c）與側面色（--cs）
type Block = 'terra' | 'mustard' | 'sage' | 'mist' | 'pink'

// ---------- 照片的 sizes ----------
// 照片被 object-fit: cover 裁進比它「瘦」的框時，瀏覽器要畫的寬度＝框寬 ×（照片寬高比 ÷ 框寬高比）；只寫框寬會挑到太小的檔。
// 後台換了照片就照新照片的寬高比算。900 以下是手機與平板的單欄版面，框寬跟著視窗；901 以上寫桌機最大的顯示寬度。
const photoRatio = (builtin: string, photo: MediaImage | undefined) => {
  const { width, height } = pagePhotoAttrs(builtin, photo, '100vw')
  return width && height ? width / height : 0
}
const grow = (ratio: number, frame: number) => (ratio > 0 && frame > 0 ? Number(Math.max(1, ratio / frame).toFixed(2)) : 1)
/** desk＝[桌機框寬 px, 框的寬高比]；narrow＝[900 以下的框寬（CSS 長度）, 框的寬高比] */
function framedPhoto(builtin: string, photo: MediaImage | undefined, desk: [number, number], narrow: [string, number]) {
  const ratio = photoRatio(builtin, photo)
  return pagePhotoAttrs(builtin, photo, `(max-width: 900px) calc(${narrow[0]} * ${grow(ratio, narrow[1])}), ${Math.round(desk[0] * grow(ratio, desk[1]))}px`)
}

// 內建照片與它的 alt 留在這裡（後台沒換照片時用；換了照片就用後台的圖、焦點與說明，後台沒填說明則用素材庫的說明）。
const HERO_ALT = '兩個孩子在教室裡緊緊抱在一起'
// 2026-11-04 保育主照片換成園方雲端「外師戶外課」（2026-01-23，Canon 6090×4060，母檔 2.2:1 → 2640×1200）：
// 取代 1477px 的絲瓜棚（桌機 Retina 只有 0.56 倍）。老師和孩子在正中，橫幅置中也不會切到頭。
const CARE_PHOTO_ALT = '戴著聖誕帽的孩子握著小木槌，專心敲著桌上的彩色木樁'
// 2026-11-12 改用義華 NAS「2024-02-23 車車封面＋吃湯圓reels／IMG_5755」（3984×2656，裁 x7%–93%、y14%–100% → 1600×1067），
// 就是 ivykids.tw 首頁輪播那張；六個孩子坐在溜滑梯前揮手，取代人很小的遊戲區全景。
const FEATURE_ALT = '孩子們在大型遊具旁溜滑梯、騎小車，一個男孩朝鏡頭走來'
const CARE = [
  { image: 'env-care-health', alt: '老師幫戴著口罩的孩子確認身體狀況' },
  { image: 'env-care-meal', alt: '男孩拿著湯匙，從紅色碗裡舀飯吃' },
  { image: 'env-care-clothes', alt: '穿著淺藍色羽絨外套的女孩站在桌邊' },
  { image: 'env-care-comfort', alt: '大人抱著剛哭過的女孩，用手指輕輕幫她擦臉' },
  { image: 'env-care-clean', alt: '男孩站在一整排水龍頭前，雙手搓著肥皂洗手' }
]
// 五件照顧的小事：大小有主次的五扇窗（桌機 12 欄排成 3＋4＋5／5＋7，手機兩欄、第五張整列）。
// shape 是共用的形狀 class（拱、圓）；第三到第五張的形狀寫在 environment.css 的 .renv-ci-N（一角大圓角的方塊、底邊圓弧的寬窗）。
// ar＝桌機框的寬高比、w＝桌機框寬（版心 1200、欄距 28：3 欄 279、4 欄 381、5 欄 484、7 欄 688）、nar＝900 以下框的寬高比；pos＝內建照片的位置。
// 定時消毒的母檔是 2:1（1477×738，水龍頭在左三分之一、洗手的男孩在右三分之二），所以放在最寬的那一扇（2:1），整張都看得到。
// 2026-11-12 定時消毒換成崇德校粉專 2025-05-09 的洗手照（fbid 122188786028272677，原圖 1477×1108，母檔裁 y70–808 → 1477×738）；
// 上緣裁在 y70 是為了避開後面戴口罩的孩子，重裁時別再往上收。
// 2026-11-10 情緒安撫換成義華 NAS「2024-12-10 照片／未命名檔案夾／5D4A2780」（6720×4480，母檔裁 x1500–6300、y600–4200 → 1600×1200），
// 大人抱著剛哭過的女孩替她擦臉；大人是老師還是家長待園方確認，替代文字只寫「大人」。/about「情緒」那格也用這張。
// 健康把關的母檔 2026-11-13 從 1961×934 的橫幅重裁成 747×934（4:5，同後台的裁切預覽），放 4:5 的拱窗，焦點 50%。
const CARE_LOOKS: { shape: string; color: Block; ar: number; w: number; nar: number; wide?: boolean; pos: string }[] = [
  { shape: 'sh-arch', color: 'pink', ar: 0.8, w: 279, nar: 0.8, pos: '50% 50%' },
  { shape: 'sh-circle', color: 'mustard', ar: 1, w: 381, nar: 1, pos: '58% 30%' },
  { shape: '', color: 'mist', ar: 4 / 3, w: 484, nar: 1, pos: '50% 16%' },
  { shape: '', color: 'terra', ar: 4 / 3, w: 484, nar: 1, pos: '48% 36%' },
  { shape: '', color: 'sage', ar: 2, w: 688, nar: 2, wide: true, pos: '47% 50%' }
]
// 六個空間。戶外廣場只能用明華校的照片（後台標「明華校」）。
const SPACES = [
  { image: 'env-space-classroom', alt: '陽光照進木地板教室，牆邊是矮櫃與小桌椅' },
  { image: 'env-space-materials', alt: '女孩坐在桌前，專心組著各式彩色操作教具' },
  { image: 'env-space-plaza', alt: '明華校的戶外廣場上，女孩笑著往前跑，旁邊的孩子坐著看' },
  // 2026-11-03 安全角落改用園方雲端「115招生照片」的 Hape 遊戲室（推測崇德校、待確認，不標校別）；原本的球池照原檔只有 900px
  { image: 'env-space-corner', alt: '孩子在室內遊戲室笑著爬過軟墊積木，兩旁的欄杆也包著軟墊' },
  { image: 'env-space-restroom', alt: '孩子高度的洗手台，掛著一排小毛巾' },
  { image: 'env-space-animals', alt: '孩子蹲在圍欄邊，拿紅蘿蔔餵裡面的小兔子' }
]
// 六個空間的窗：形狀（sh-<名>，桌機舞台上窗就在這六個形狀之間變形，見 utils/environment-windows.ts 的 stopShapes）、積木色、
// 形狀的寬高比（算 sizes 用）、內建照片的位置。戶外廣場放在拱窗，對焦在跑步的女孩（33%）。
const STOP_LOOKS: { sh: string; color: Block; ar: number; pos?: string }[] = [
  { sh: 'rect', color: 'terra', ar: 5 / 4 },
  { sh: 'circle', color: 'mustard', ar: 1, pos: '50% 35%' },
  { sh: 'arch', color: 'sage', ar: 4 / 5, pos: '33% 40%' },
  { sh: 'u', color: 'pink', ar: 1, pos: '50% 38%' },
  { sh: 'dome', color: 'mist', ar: 2, pos: '50% 78%' },
  { sh: 'leaf', color: 'terra', ar: 5 / 4, pos: '68% 50%' }
]
// 桌機舞台的窗最寬 800、寬高比 1.267（environment.css 的 --ww／--wh）；照片照窗高畫滿，3:2 的照片要畫約 950px 寬
const STAGE_W = 800
const STAGE_AR = 1.267
// 一天五餐的小圖示（30×30，平塗＋同色深一階的側面往下錯開，跟頁面上的積木同一招）；依序對到五餐，後台改了餐名也照順序
// 2026-11-14：吐司從黃改珊瑚橘（黃吐司在白盤上幾乎看不出形狀）、蘋果從橘改蜜桃粉（橘色讀成橘子），五個圖示正好五個積木色
const MEAL_ICONS = [
  '<path d="M7 14a6 6 0 0 1 3.4-9.2h9.2A6 6 0 0 1 23 14v10.5a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2Z" fill="var(--renv-terra-side)" transform="translate(0 2.5)"/><path d="M7 14a6 6 0 0 1 3.4-9.2h9.2A6 6 0 0 1 23 14v10.5a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2Z" fill="var(--renv-terra)"/><rect x="10.5" y="12" width="9" height="10.5" rx="2.2" fill="var(--renv-paper)"/>',
  '<path d="M6 8 Q7.5 24 25 23.5" fill="none" stroke="var(--renv-mustard-side)" stroke-width="8" stroke-linecap="round" transform="translate(0 2.5)"/><path d="M6 8 Q7.5 24 25 23.5" fill="none" stroke="var(--renv-mustard)" stroke-width="8" stroke-linecap="round"/><path d="M5 5.5 6.2 9" stroke="var(--renv-forest)" stroke-width="3" stroke-linecap="round"/>',
  '<path d="M3.5 14h23a11.5 11.5 0 0 1-23 0Z" fill="var(--renv-sage-side)" transform="translate(0 2.5)"/><path d="M8.5 14a6.5 5 0 0 1 13 0Z" fill="var(--renv-cream-side)"/><path d="M3.5 14h23a11.5 11.5 0 0 1-23 0Z" fill="var(--renv-sage)"/>',
  '<circle cx="15" cy="19.5" r="10.5" fill="var(--renv-pink-side)"/><circle cx="15" cy="17" r="10.5" fill="var(--renv-pink)"/><path d="M15 3.5v6" stroke="var(--renv-forest)" stroke-width="3" stroke-linecap="round"/><ellipse cx="21" cy="5.5" rx="5.2" ry="2.8" transform="rotate(-28 21 5.5)" fill="var(--renv-sage)"/>',
  '<path d="M21 12h2.5a4 4 0 0 1 0 8H21" fill="none" stroke="var(--renv-mist-side)" stroke-width="3.2" stroke-linecap="round"/><path d="M6 9h15v13a4 4 0 0 1-4 4h-7a4 4 0 0 1-4-4Z" fill="var(--renv-mist-side)" transform="translate(0 2.5)"/><path d="M6 9h15v13a4 4 0 0 1-4 4h-7a4 4 0 0 1-4-4Z" fill="var(--renv-mist)"/>'
]
const MEAL_COLORS: Block[] = ['terra', 'mustard', 'sage', 'pink', 'mist']
// 五顆心：兩個圓＋一個轉 45° 的方塊拼成的幾何愛心，以心的中央為原點、寬高各約 1（utils/environment-windows.ts 的 heartPath 是同一個形狀）
const HEART = 'M0 .457L-.414 .043A.293 .293 0 0 1 0-.371A.293 .293 0 0 1 .414 .043Z'
const HEART_COLORS: Block[] = ['pink', 'terra', 'mustard', 'sage', 'mist']
// 章節色（2026-11-14 起）：01 粉、02 綠、03 黃、04 藍——首屏的四塊章節積木與各章的章名標籤同色
const CHAPTER_COLORS: Record<string, Block> = { care: 'pink', spaces: 'sage', meals: 'mustard', campuses: 'mist' }
const TOUR_COLORS: Block[] = ['terra', 'mustard', 'sage', 'mist', 'pink']

const heroLines = computed(() => pageMarkedLines(props.page.heroTitle, props.page.heroHighlight))
// 桌機起始畫面的大標字級由 CSS 算（拱窗左邊的空位 ÷ 最長那一行的字數，再看行數不要超出高度）：字數與行數用變數交給它
const heroVars = computed(() => ({
  '--n': Math.max(8, ...heroLines.value.map((line) => [...`${line.before}${line.mark}${line.after}`].length)),
  '--l': Math.max(1, heroLines.value.length)
}))
// 首屏照片：桌機是橫幅的大畫面（內建照片用橫幅母檔），900 以下只有一扇拱窗（內建照片用裁好的直幅，不必為此下載整張橫幅）。
// 和 usePageSeo 的預載共用 environmentHeroSources，兩邊才會挑到同一個檔。
const hero = computed(() => environmentHeroSources(props.page))
const careItems = computed(() => props.page.careItems.map((item, i) => ({ ...CARE[i % CARE.length]!, ...item, look: CARE_LOOKS[i % CARE_LOOKS.length]! })))
const spaces = computed(() => props.page.spaces.map((space, i) => ({ ...SPACES[i % SPACES.length]!, ...space, look: STOP_LOOKS[i % STOP_LOOKS.length]! })))
// 水果是小盤：第 2、4 餐（照位置，不比對文字；後台改了餐名也一樣）
const meals = computed(() => props.page.meals.map((item, i) => ({ ...item, icon: MEAL_ICONS[i] ?? MEAL_ICONS[2]!, color: MEAL_COLORS[i % 5]!, small: i === 1 || i === 3 })))
// 遊樂區的標題在 300px 寬的卡片裡：最長那一行的字數交給 CSS 收字級（至少當 4 個字算，短標題不會放得過大）
const featureChars = computed(() => Math.max(4, ...pageTitleLines(props.page.feature.title).map((line) => [...line].length)))
const dayTitle = computed(() => plainTitle(props.page.mealsDayTitle).split(/\s+/).filter(Boolean))

const carePhoto = (item: (typeof careItems.value)[number]) => framedPhoto(item.image, item.photo, [item.look.w, item.look.ar], [item.look.wide ? '(100vw - 40px)' : '(50vw - 27px)', item.look.nar])
// 六個空間：桌機寫舞台窗的寬（一般的三欄版面比它小，不會糊）；900 以下單欄，框寬＝版心
const spacePhoto = (space: (typeof spaces.value)[number]) => framedPhoto(space.image, space.photo, [STAGE_W, STAGE_AR], ['(100vw - 40px)', space.look.ar])
// 結尾不放預約，改成往站內其他分頁走；提示字取自各頁的章節名
const NEXT: { href: string; title: string; hint: string; color: Block }[] = [
  { href: '/#life', title: '孩子的一天', hint: '六個日常片刻', color: 'sage' },
  { href: '/curriculum', title: '特色教學', hint: '四個年段與課程方向', color: 'mist' },
  { href: '/admission', title: '入學資訊', hint: '入學流程、分班對照', color: 'pink' }
]
const nextPages = computed(() => NEXT.filter((item) => props.admission || item.href !== '/admission'))

const meal = mealBookLink()

// ---------- 第四章：五所校園（只收有場景的校） ----------
const tours = computed(() => props.campuses
  .map((campus) => ({ campus, scenes: campus.tourScenes }))
  .filter((tour): tour is { campus: Campus; scenes: TourScene[] } => tour.scenes.length > 0))
const sceneCount = computed(() => tours.value.reduce((sum, tour) => sum + tour.scenes.length, 0))
const tourKeys = computed(() => tours.value.map((tour) => tour.campus.key))
// 一開始打開哪一校（同首頁五校 CampusBoard.vue 的優先序）：網址指定 /environment?campus=<校>
// ＞ 家長上次自己選的（cookie ivy_campus：頁首選單、首頁五校卡、預約頁選校卡都會記；SSR 就讀得到，第一個畫面就是那一校）＞ 第一校。
// 訪客在這裡自己換校（點分頁、方向鍵）也記住，下次首頁、頁首、預約頁都從這一校開始；按「下一所」是依序往下看，不算選校、不記。
const route = useRoute()
const remembered = useRememberedCampus()
const requestedCampus = typeof route.query.campus === 'string' ? route.query.campus : ''
const active = ref(tourKeys.value.includes(requestedCampus) ? requestedCampus : remembered.recall(tourKeys.value) ?? '')
const activeKey = computed(() => (tours.value.some((tour) => tour.campus.key === active.value) ? active.value : tours.value[0]?.campus.key))
// 看完一校的角落接著看下一所（最後一所接回第一所），小窗的框用下一所的分頁色；只有一所時不放
const nextTours = computed(() => tours.value.map((_, t) => {
  const count = tours.value.length
  const n = (t + 1) % count
  return count > 1 ? { tour: tours.value[n]!, color: TOUR_COLORS[n % 5]! } : null
}))
// 每校的角落：第一張在大窗，其餘排在右邊。左欄的角落按鈕按哪一個，那張就換到大窗（其餘照原本的順序）；各校各記各的
const leads = ref<Record<string, string>>({})
const leadKey = (tour: { campus: Campus; scenes: TourScene[] }) => (tour.scenes.some((scene) => scene.key === leads.value[tour.campus.key]) ? leads.value[tour.campus.key]! : tour.scenes[0]!.key)
const orderedScenes = (tour: { campus: Campus; scenes: TourScene[] }) => {
  const lead = leadKey(tour)
  return [...tour.scenes.filter((scene) => scene.key === lead), ...tour.scenes.filter((scene) => scene.key !== lead)]
}
// 大窗：桌機約 526×440（版心 1200 − 面板內距 80 − 左欄 300 − 欄距 36 − 右邊一排 240 − 間距 18），照片多半 16:10，照窗高畫滿；
// 右邊的小窗 240 寬、三個角落時約 240×211。900 以下大窗和面板同寬（4:3），小窗兩欄（6:5）。
function scenePhoto(scene: TourScene, lead: boolean) {
  const { width, height } = responsiveTourImage(scene.image, '100vw', false, scene.imageMedia)
  const ratio = width && height ? width / height : 1.6
  const sizes = lead
    ? `(max-width: 900px) calc((100vw - 76px) * ${grow(ratio, 4 / 3)}), ${Math.round(526 * grow(ratio, 1.195))}px`
    : `(max-width: 900px) calc((50vw - 44px) * ${grow(ratio, 1.2)}), ${Math.round(240 * grow(ratio, 1.137))}px`
  return responsiveTourImage(scene.image, sizes, false, scene.imageMedia)
}
const lineArt = (key: string, layer: 'wash' | 'ink', sizes: string) => responsiveImage(`campus-line-art-${key}-${layer}`, sizes)
const TAB_ART_SIZES = '(max-width: 900px) 72px, 170px'

const chapters = computed(() => [
  { id: 'care', label: props.page.chapterNames[0], hint: '五顆心的照顧' },
  { id: 'spaces', label: props.page.chapterNames[1], hint: `${SPACES.length + 1} 個孩子的空間` },
  { id: 'meals', label: props.page.chapterNames[2], hint: `${meal.month} 月菜單` },
  ...(tours.value.length ? [{ id: 'campuses', label: props.page.chapterNames[3], hint: `${sceneCount.value} 個校園角落` }] : [])
].map((chapter) => ({ ...chapter, color: CHAPTER_COLORS[chapter.id]! })))

// ---------- 分頁（WAI-ARIA tabs：左右鍵、Home、End） ----------
const root = ref<HTMLElement | null>(null)
const tabRefs = ref<HTMLButtonElement[]>([])
const tabList = ref<HTMLElement | null>(null)
// remember：點分頁、方向鍵換校算家長自己選的（同首頁五校 CampusBoard 的 pick），記住；「下一所」不記
async function selectTab(key: string, focus = false, remember = true) {
  const changed = key !== activeKey.value
  active.value = key
  if (remember) remembered.remember(key, tourKeys.value)
  await nextTick()
  // 焦點移過去時不讓瀏覽器自己捲（「下一所」要用平滑捲動回到分頁列）
  if (focus) tabRefs.value.find((button) => button.dataset.key === key)?.focus({ preventScroll: true })
  // 真的換了校，新面板的窗重新打開
  const panel = root.value?.querySelector<HTMLElement>(`#tour-${key}`)
  if (changed && panel) windows?.replay(panel)
}
function onTabKey(event: KeyboardEvent, index: number) {
  const target = ({ ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: tours.value.length - 1 } as Record<string, number>)[event.key]
  if (target === undefined) return
  event.preventDefault()
  const count = tours.value.length
  void selectTab(tours.value[(target + count) % count]!.campus.key, true)
}
// 「下一所」在面板的最下面：換校後，分頁列不在畫面裡（手機看完三張照片之後）才捲回去，看得到選中的是哪一所、新的一校從頭看
async function showNextTour(key: string) {
  await selectTab(key, true, false)
  const bar = tabList.value
  const header = document.querySelector<HTMLElement>('.header')
  if (!bar || bar.getBoundingClientRect().top >= (header?.offsetHeight ?? 0) + 8) return
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
  bar.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })
}
// 角落按鈕：那張照片換到大窗，這一校的窗重新打開
async function showScene(tour: { campus: Campus; scenes: TourScene[] }, key: string) {
  if (leadKey(tour) === key) return
  leads.value = { ...leads.value, [tour.campus.key]: key }
  await nextTick()
  const list = root.value?.querySelector<HTMLElement>(`#tour-${tour.campus.key} .renv-scenes`)
  if (list) windows?.replay(list)
}

// ---------- 捲動敘事（utils/environment-windows.ts）：只在瀏覽器動態載入，載入失敗就只是沒有動態 ----------
// 後台內容編輯頁右側的即時預覽（/preview?embed=1&live=1，桌機檢視是 1280 寬）不做釘住的敘事：
// 編輯的人改到哪一個空間，預覽要直接看得到那一格；舞台上一次只顯示一站，改的那一站多半不在畫面上。
const still = route.path === '/preview' && isLivePreview(route.query)
let windows: EnvironmentWindows | null = null
let windowsModule: typeof import('~/utils/environment-windows') | null = null
let disposed = false
// 首屏章節連結保留原生 href；一般點擊交給 Router 記住前一筆位置，上一頁才回到離開處。
const onChapterLink = (event: MouseEvent) => {
  // 後台即時預覽（pages/preview.vue）在 capture 階段就把連結點擊擋下了：這裡什麼都不做
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  event.preventDefault()
  windowsModule?.smoothNextHashJump()
  const hash = (event.currentTarget as HTMLAnchorElement).hash
  void navigateTo({ path: route.path, query: route.query, hash })
}
onMounted(async () => {
  if (!root.value) return
  const loaded = await import('~/utils/environment-windows').catch(() => null)
  if (disposed || !root.value) return
  if (loaded) {
    windowsModule = loaded
    windows = loaded.createEnvironmentWindows(root.value, { pin: !still })
  }
  // Router 等這次版面量好才還原位置；模組失敗也放行，仍可讀完整的靜態內容。
  root.value.dataset.windowsReady = 'true'
})
// 跳轉還沒捲完就換頁：把暫時開的平滑捲動一起收掉（不然下一頁捲到頁頂也會慢慢滑）
onBeforeUnmount(() => { disposed = true; windows?.destroy(); windowsModule?.endSmoothHashJump() })
// 後台即時預覽（pages/preview.vue）會一直換 page／campuses：文字變長變短、照片換掉後版面跟著變，窗的位置與進度要依新版面重算。
// flush: 'post' 等畫面更新完再量，同一個 tick 內改好幾處只算一次。正式頁的 props 不會再變；還沒建好時略過。
watch([() => props.page, () => props.campuses], () => windows?.refresh(), { deep: true, flush: 'post' })
</script>

<template>
  <main id="main" ref="root" tabindex="-1" class="renv" :class="{ 'renv-still': still }" data-cta-entry="environment">
    <!-- 首屏：大標、赤陶窗（桌機起始是右邊一扇拱窗，往下捲打開成整幕）、四塊章節積木 -->
    <section class="renv-hero" data-track-section="hero" aria-labelledby="environment-title">
      <div class="renv-hero-stage" :style="heroVars">
        <div class="renv-hero-txt">
          <div class="renv-hero-txt-in">
            <h1 id="environment-title" class="renv-h-title"><span v-for="(line, i) in heroLines" :key="i" class="renv-h-line">{{ line.before }}<mark v-if="line.mark" class="renv-mark">{{ line.mark }}</mark>{{ line.after }}</span></h1>
            <p v-if="page.heroLede" class="renv-text renv-lede"><Phrases :text="page.heroLede" /></p>
            <p v-if="page.heroNotice" class="renv-notice">{{ page.heroNotice }}</p>
          </div>
        </div>
        <div class="renv-h-slot">
          <i class="renv-h-decor is-leaf" aria-hidden="true" /><i class="renv-h-decor is-sun" aria-hidden="true" />
          <div class="renv-hw">
            <i class="renv-hw-side" aria-hidden="true" /><i class="renv-hw-frame" aria-hidden="true" />
            <div class="renv-hw-photo">
              <picture class="responsive-picture">
                <template v-if="hero.wide">
                  <source v-if="hero.wide.avifSrcset" :media="ENVIRONMENT_HERO_WIDE_MEDIA" type="image/avif" :srcset="hero.wide.avifSrcset" :sizes="hero.wide.sizes" :width="hero.wide.width" :height="hero.wide.height">
                  <source :media="ENVIRONMENT_HERO_WIDE_MEDIA" :srcset="hero.wide.srcset" :sizes="hero.wide.sizes" :width="hero.wide.width" :height="hero.wide.height">
                </template>
                <source v-if="hero.img.avifSrcset" type="image/avif" :srcset="hero.img.avifSrcset" :sizes="hero.img.sizes">
                <img :src="hero.img.src" :srcset="hero.img.srcset" :sizes="hero.img.sizes" :width="hero.img.width" :height="hero.img.height" :style="pagePhotoStyle('70% 38%', page.heroPhoto)" :alt="pagePhotoAlt(HERO_ALT, page.heroPhoto, page.heroPhotoAlt)" loading="eager" fetchpriority="high">
              </picture>
            </div>
          </div>
        </div>
        <nav class="renv-index" aria-label="本頁章節">
          <a v-for="chapter in chapters" :key="chapter.id" class="renv-hb" :class="`c-${chapter.color}`" :href="`#${chapter.id}`" @click="onChapterLink">
            <b class="renv-index-name">{{ chapter.label }}</b><span class="renv-index-hint">{{ chapter.hint }}</span><svg class="icon" aria-hidden="true" focusable="false"><use href="#i-arrow-down" /></svg>
          </a>
        </nav>
      </div>
    </section>

    <!-- 幼兒保育：五顆心打開成一張大照片、五件照顧的小事 -->
    <section id="care" data-track-section="care" class="renv-section renv-care" aria-labelledby="care-title">
      <div class="renv-wrap">
        <header class="renv-care-head">
          <div>
            <p class="renv-kicker c-pink">{{ page.chapterNames[0] }}</p>
            <h2 id="care-title" class="renv-title"><span v-for="(line, i) in pageTitleLines(page.careTitle)" :key="i">{{ line }}</span></h2>
          </div>
          <p v-if="page.careLead" class="renv-lead"><Phrases :text="page.careLead" /></p>
        </header>
        <div class="renv-hearts">
          <div class="renv-hwin">
            <div class="renv-hwin-ph">
              <ResponsivePicture v-bind="framedPhoto('env-care-teacher', page.carePhoto, [1200, 2.34], ['(100vw - 40px)', 1.5])" :style="pagePhotoStyle('60% 50%', page.carePhoto)" :alt="pagePhotoAlt(CARE_PHOTO_ALT, page.carePhoto, page.carePhotoAlt)" loading="lazy" />
              <!-- 心形窗的色片：只在捲動敘事啟動時顯示（一顆心一欄），窗長大相連時褪成照片 -->
              <span class="renv-hwin-tint" aria-hidden="true"><i v-for="(_, i) in page.hearts" :key="i" :class="`c-${HEART_COLORS[i % 5]}`" /></span>
            </div>
          </div>
          <!-- 愛心蓋子：只有捲動敘事啟動時才顯示（蓋在照片上，往下捲縮成小愛心落到名稱上面）；平常名稱上面的小愛心是下面那一份 -->
          <svg class="renv-hlids" aria-hidden="true" focusable="false">
            <g v-for="(_, i) in page.hearts" :key="i" class="renv-lid" :class="`c-${HEART_COLORS[i % 5]}`"><path class="is-side" :d="HEART" transform="translate(0 .06)" /><path class="is-face" :d="HEART" /></g>
          </svg>
          <ul class="renv-hnames" :style="{ '--hn': page.hearts.length }">
            <li v-for="(heart, i) in page.hearts" :key="i" :class="`c-${HEART_COLORS[i % 5]}`">
              <svg class="renv-heart" viewBox="-.5 -.46 1 .98" aria-hidden="true" focusable="false"><path class="is-side" :d="HEART" transform="translate(0 .06)" /><path class="is-face" :d="HEART" /></svg>{{ heart }}
            </li>
          </ul>
        </div>
        <p v-if="page.careText" class="renv-text renv-care-text"><Phrases :text="page.careText" /></p>
        <ul class="renv-cares">
          <li v-for="(item, i) in careItems" :key="item.image" class="renv-ci" :class="`renv-ci-${i % 5}`">
            <figure class="renv-win renv-door" :class="[item.look.shape, `c-${item.look.color}`]">
              <div class="renv-ph"><ResponsivePicture v-bind="carePhoto(item)" :style="pagePhotoStyle(item.look.pos, item.photo)" :alt="pagePhotoAlt(item.alt, item.photo, item.photoAlt)" loading="lazy" /></div>
            </figure>
            <div class="renv-ci-tx">
              <h3>{{ item.title }}</h3>
              <p><Phrases :text="item.text" /></p>
            </div>
          </li>
        </ul>
      </div>
    </section>

    <!-- 校園環境：遊樂區大畫面、六個空間（桌機是釘住的舞台：同一扇窗在六個形狀之間變形） -->
    <section id="spaces" data-track-section="spaces" class="renv-section renv-spaces" aria-labelledby="spaces-title">
      <div class="renv-wrap">
        <header class="renv-sp-head">
          <p class="renv-kicker c-sage">{{ page.chapterNames[1] }}</p>
          <h2 id="spaces-title" class="renv-title"><span v-for="(line, i) in pageTitleLines(page.spacesTitle)" :key="i">{{ line }}</span></h2>
          <p v-if="page.spacesText" class="renv-text"><Phrases :text="page.spacesText" /></p>
        </header>
        <div class="renv-feat">
          <figure class="renv-feat-win">
            <div class="renv-ph"><ResponsivePicture v-bind="framedPhoto('env-space-playground', page.feature.photo, [900, 1.467], ['(100vw - 40px)', 4 / 3])" :style="pagePhotoStyle(undefined, page.feature.photo)" :alt="pagePhotoAlt(FEATURE_ALT, page.feature.photo, page.feature.photoAlt)" loading="lazy" /></div>
          </figure>
          <div class="renv-feat-card">
            <p class="renv-feat-tag">{{ page.feature.tag }}</p>
            <h3 :style="{ '--n': featureChars }"><span v-for="(line, i) in pageTitleLines(page.feature.title)" :key="i">{{ line }}</span></h3>
            <p class="renv-feat-text"><Phrases :text="page.feature.text" /></p>
          </div>
        </div>
      </div>
      <div class="renv-stops-sec">
        <div class="renv-stops-stage">
          <div class="renv-stops-in">
            <i class="renv-stops-side" aria-hidden="true"><i /></i>
            <ol class="renv-stops">
              <li v-for="space in spaces" :key="space.image" class="renv-stop" :data-sh="space.look.sh" :data-color="space.look.color">
                <figure class="renv-win renv-door" :class="[`sh-${space.look.sh}`, `c-${space.look.color}`]">
                  <div class="renv-ph"><ResponsivePicture v-bind="spacePhoto(space)" :style="pagePhotoStyle(space.look.pos, space.photo)" :alt="pagePhotoAlt(space.alt, space.photo, space.photoAlt)" loading="lazy" /></div>
                </figure>
                <div class="renv-stop-tx">
                  <p v-if="space.campusLabel" class="renv-stop-campus">{{ space.campusLabel }}</p>
                  <h3>{{ space.title }}</h3>
                  <p class="renv-stop-text"><Phrases :text="space.text" /></p>
                </div>
              </li>
            </ol>
            <!-- 進度：六顆小積木（形狀同各站的窗），只在桌機舞台出現，也可以按 -->
            <div class="renv-stops-nav" role="group" :aria-label="page.chapterNames[1]">
              <button v-for="space in spaces" :key="space.image" class="renv-sn" :class="`c-${space.look.color}`" type="button" :aria-label="space.title"><i :class="`m-${space.look.sh}`" /></button>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- 幼兒餐點：營養餐點書、一天五餐（圓點小路穿過五個盤子） -->
    <section id="meals" data-track-section="meals" class="renv-section renv-meals" aria-labelledby="meals-title">
      <div class="renv-wrap renv-meals-top">
        <div>
          <p class="renv-kicker c-mustard">{{ page.chapterNames[2] }}</p>
          <h2 id="meals-title" class="renv-title"><span v-for="(line, i) in pageTitleLines(page.mealsTitle)" :key="i">{{ line }}</span></h2>
          <p class="renv-text renv-meals-p"><Phrases :text="page.mealsText" /></p>
          <a class="renv-btn c-mustard" :href="meal.href" target="_blank" rel="noopener">{{ meal.label }}<svg class="icon" aria-hidden="true" focusable="false"><use href="#i-arrow-up-right" /></svg><span class="sr-only">（另開新視窗）</span></a>
        </div>
        <div class="renv-book">
          <i class="is-dome" aria-hidden="true" /><i class="is-ball" aria-hidden="true" />
          <a class="renv-book-c" :href="meal.href" target="_blank" rel="noopener" tabindex="-1" aria-hidden="true">
            <ResponsivePicture v-bind="responsiveImage('env-meal-book', '(max-width: 900px) 220px, 300px')" alt="" loading="lazy" />
          </a>
        </div>
      </div>
      <div class="renv-day">
        <div class="renv-day-in">
          <h3 class="renv-day-title"><template v-for="(part, i) in dayTitle" :key="i"><span>{{ part }}</span>{{ i < dayTitle.length - 1 ? ' ' : '' }}</template></h3>
          <div class="renv-day-tl" :style="{ '--dn': meals.length }">
            <div class="renv-day-rail" aria-hidden="true"><i /></div>
            <ol class="renv-day-list">
              <li v-for="(item, i) in meals" :key="i" class="renv-day-i" :class="[`c-${item.color}`, { 'is-small': item.small }]">
                <time class="renv-day-t" lang="en">{{ item.time }}</time>
                <!-- eslint-disable-next-line vue/no-v-html -- 本檔固定的小圖示常數，不含後台或使用者內容 -->
                <span class="renv-plate"><svg viewBox="0 0 30 30" aria-hidden="true" focusable="false" v-html="item.icon" /></span>
                <b class="renv-day-name">{{ item.name }}</b><span class="renv-day-n">{{ item.note }}</span>
                <p v-if="item.text" class="renv-day-x"><Phrases :text="item.text" /></p>
              </li>
            </ol>
          </div>
        </div>
      </div>
    </section>

    <!-- 五所校園：五扇校區窗（後台 campus_tour 發布的內容），點哪一扇哪一扇打開 -->
    <section v-if="tours.length" id="campuses" data-track-section="tour" class="renv-section renv-tour" aria-labelledby="tour-title">
      <div class="renv-wrap">
        <header class="renv-tour-head">
          <div>
            <p class="renv-kicker c-mist">{{ page.chapterNames[3] }}</p>
            <h2 id="tour-title" class="renv-title"><span v-for="(line, i) in pageTitleLines(page.tourTitle)" :key="i">{{ line }}</span></h2>
          </div>
          <p v-if="page.tourText" class="renv-lead"><Phrases :text="page.tourText" /></p>
        </header>
        <div ref="tabList" class="renv-tour-tabs" role="tablist" aria-label="選一所校園" :style="{ '--tn': tours.length }">
          <button
            v-for="(tour, i) in tours"
            :id="`tour-tab-${tour.campus.key}`"
            :key="tour.campus.key"
            ref="tabRefs"
            type="button"
            role="tab"
            class="renv-tour-tab"
            :class="`c-${TOUR_COLORS[i % 5]}`"
            :data-key="tour.campus.key"
            :aria-controls="`tour-${tour.campus.key}`"
            :aria-selected="tour.campus.key === activeKey"
            :tabindex="tour.campus.key === activeKey ? 0 : -1"
            @click="selectTab(tour.campus.key)"
            @keydown="onTabKey($event, i)"
          >
            <span class="renv-tour-art">
              <ResponsivePicture class="renv-tour-wash" v-bind="lineArt(tour.campus.key, 'wash', TAB_ART_SIZES)" alt="" loading="lazy" decoding="async" />
              <ResponsivePicture v-bind="lineArt(tour.campus.key, 'ink', TAB_ART_SIZES)" alt="" loading="lazy" decoding="async" />
            </span>
            <b class="renv-tab-name">{{ tour.campus.name }}</b>
            <span v-if="tour.campus.district" class="renv-tab-meta">{{ tour.campus.district }}</span>
          </button>
        </div>
        <div class="renv-tour-panels">
          <div
            v-for="(tour, t) in tours"
            :id="`tour-${tour.campus.key}`"
            :key="tour.campus.key"
            class="renv-tour-panel"
            :class="`c-${TOUR_COLORS[t % 5]}`"
            role="tabpanel"
            :aria-labelledby="`tour-tab-${tour.campus.key}`"
            tabindex="0"
            :hidden="tour.campus.key !== activeKey"
          >
            <!-- 左欄：校名＋地址（連到 Google 地圖，同預約頁的所選校園）→ 這一校的角落（按哪個哪張換到大窗）→「下一所」 -->
            <div class="renv-panel-info">
              <h3>{{ tour.campus.name }}</h3>
              <a v-if="tour.campus.address" class="renv-tour-map" :href="campusMapUrl(tour.campus)" target="_blank" rel="noopener noreferrer" :aria-label="`${tour.campus.address}，在 Google 地圖開啟（另開分頁）`">
                <svg class="icon" aria-hidden="true" focusable="false"><use href="#i-map-pin" /></svg><span>{{ tour.campus.address }}</span><svg class="icon" aria-hidden="true" focusable="false"><use href="#i-arrow-up-right" /></svg>
              </a>
              <p v-else-if="tour.campus.district" class="renv-tour-district">{{ tour.campus.district }}</p>
              <ul v-if="tour.scenes.length > 1" class="renv-corners">
                <li v-for="scene in tour.scenes" :key="scene.key">
                  <button class="renv-corner" type="button" :aria-pressed="scene.key === leadKey(tour)" @click="showScene(tour, scene.key)">
                    <ResponsivePicture v-bind="responsiveTourImage(scene.image, '44px', false, scene.imageMedia)" :style="pagePhotoStyle(undefined, scene.imageMedia)" alt="" loading="lazy" decoding="async" /><span>{{ scene.name }}</span>
                  </button>
                </li>
              </ul>
            </div>
            <ul class="renv-scenes" :style="{ '--rows': Math.max(1, tour.scenes.length - 1) }" :data-count="Math.min(tour.scenes.length, 4)">
              <li v-for="(scene, s) in orderedScenes(tour)" :key="scene.key" class="renv-scene">
                <figure class="renv-win renv-door" :style="{ '--d': `${(s * .12).toFixed(2)}s` }">
                  <div class="renv-ph"><ResponsivePicture v-bind="scenePhoto(scene, s === 0)" :style="pagePhotoStyle(undefined, scene.imageMedia)" :alt="`${tour.campus.name}的${scene.name}`" loading="lazy" decoding="async" /></div>
                </figure>
                <span class="renv-scene-n">{{ scene.name }}</span>
              </li>
            </ul>
            <button v-if="nextTours[t]" class="renv-panel-next" type="button" :style="{ '--nc': `var(--renv-${nextTours[t]!.color})` }" @click="showNextTour(nextTours[t]!.tour.campus.key)">
              <span class="renv-next-win" aria-hidden="true">
                <ResponsivePicture class="renv-tour-wash" v-bind="lineArt(nextTours[t]!.tour.campus.key, 'wash', '82px')" alt="" loading="lazy" decoding="async" />
                <ResponsivePicture v-bind="lineArt(nextTours[t]!.tour.campus.key, 'ink', '82px')" alt="" loading="lazy" decoding="async" />
              </span>
              <span class="renv-next-txt"><small>下一所</small><b>{{ nextTours[t]!.tour.campus.name }}</b></span>
              <svg class="icon" aria-hidden="true" focusable="false"><use href="#i-arrow-right" /></svg>
            </button>
          </div>
        </div>
      </div>
    </section>

    <!-- 結尾：接下來可以看（不放預約） -->
    <section class="renv-section renv-next" aria-labelledby="next-title">
      <div class="renv-wrap">
        <h2 id="next-title" class="renv-next-title">還可以看看這幾頁</h2>
        <ul class="renv-next-list">
          <li v-for="item in nextPages" :key="item.href">
            <NuxtLink class="renv-next-link" :class="`c-${item.color}`" :to="item.href"><b>{{ item.title }}</b><span>{{ item.hint }}</span><svg class="icon" aria-hidden="true" focusable="false"><use href="#i-arrow-right" /></svg></NuxtLink>
          </li>
        </ul>
      </div>
    </section>
  </main>
</template>

<style src="../assets/css/environment.css"></style>
