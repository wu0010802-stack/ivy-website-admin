<script setup lang="ts">
// 常春藤環境頁主體（/environment）。2026-10-30 改成「木頭積木」版（比稿 design/environment-style-directions-20261030/，
// 使用者選 D，再要求校園環境與幼兒餐點照 A 用圓點串起來、照片不放說明或註解＝D2）：北歐木玩／蒙特梭利教具的幾何，
// 照片裝在積木形狀裡，每塊積木有同色深一階的「側面」表現厚度；取代 09-28 起的手繪版（Rough.js 手繪線、GSAP 小腳印、蠟筆塗鴉）。
// 內容：前三章的文字與照片讀後台「常春藤環境頁」（environment_page，預設＝fixture 的 environmentPage），清單照索引對應下面的常數；
// 第四章「五所校園」讀後台發布的各校校園探索（campuses[].tourScenes）。
// 照片不放說明與註解（使用者 10-30）：首屏與保育主照片的圖說、照片上的便條、小路與選校提示、校園探索各景的說明句都不畫；
// 後台欄位照舊保留。戶外廣場照片上的「明華校」是校別標示（後台 campusLabel），照畫。
// 2026-09-28 使用者裁定：這一頁不放預約參觀（全站共用的頁首預約鈕除外）。
// 動態只有兩樣，都在瀏覽器才做、減少動態時不做：積木由上往下落定（只套在一開始不在視窗裡的元素），
// 圓點小路捲到才一顆顆亮（utils/environment-route.ts）。
import { h, type FunctionalComponent } from 'vue'
import type { Campus, EnvironmentPageContent, TourScene } from '~/types/site-content'
import { environmentHeroAttrs } from '~/utils/media-image'
import { responsiveImage } from '~/utils/responsive-image'
import { pageCoverPhotoAttrs, pageMarkedLines, pagePhotoAlt, pagePhotoAttrs, pagePhotoStyle, pageTitleLines, plainTitle } from '~/utils/page-content'
import { responsiveTourImage } from '~/utils/tour-image'
import { mealBookLink } from '~/utils/meal-book'
import { phraseChunks } from '~/utils/phrase'
import type { EnvironmentRoutes } from '~/utils/environment-route'

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

// 積木色：c-<名> 在 environment.css 對到正面色與側面色
type Block = 'terra' | 'mustard' | 'sage' | 'mist' | 'pink'
// 照片積木的樣子：形狀、寬高比（寬/高）、正面色、後面錯開墊的積木 [形狀, 色, 寬高比]、照片寬（佔欄寬）、墊塊錯開量、內建照片的位置
interface Look { shape: string; ar?: number; color: Block; back?: [string, Block, number?]; w?: string; bx?: string; by?: string; q?: string; pos?: string }

// 內建照片與它的 alt 留在這裡（後台沒換照片時用；換了照片就用後台的圖、焦點與說明，後台沒填說明則用素材庫的說明）。
const HERO_ALT = '兩個孩子在教室裡緊緊抱在一起'
// 2026-11-04 保育主照片換成園方雲端「外師戶外課」（2026-01-23，Canon 6090×4060，母檔 2.2:1 → 2640×1200）：
// 取代 1477px 的絲瓜棚（桌機 Retina 只有 0.56 倍）。老師和孩子在正中，桌機 2.75:1 置中也不會切到頭。
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
// 五件照顧的小事：五種形狀高低錯落排一排（拱、圓、右上四分之一圓、U、圓角方塊）。
// 2026-11-13 第五張從「半圓＋底下一塊平板」改成圓角方塊：半圓只有其他四張的一半高，照片太小，平板像沒放東西的空欄。
// 定時消毒的母檔是 2:1（1477×738）：水龍頭在左三分之一、洗手的男孩在右三分之二，框太瘦會只剩後腦勺，所以這塊比其他四塊寬扁（1.1:1）；
// 用方塊不用四分之一圓，是因為大圓角不管放哪一角都會切到人（左上切到後排的孩子、右上切到男孩的頭）。
// 2026-11-12 定時消毒換成崇德校粉專 2025-05-09 的洗手照（fbid 122188786028272677，原圖 1477×1108，母檔裁 y70–808 → 1477×738），
// 取代 11-10 那張背對鏡頭、半圓裡看不到頭的洗手照；母檔就是 2:1，和半圓同比例，焦點置中即可。
// 上緣裁在 y70 是為了避開後面戴口罩的孩子；男孩的頭頂離圓弧只有 3% 左右，重裁時別再往上收。
// 2026-11-10 情緒安撫換成義華 NAS「2024-12-10 照片／未命名檔案夾／5D4A2780」（6720×4480，母檔裁 x1500–6300、y600–4200 → 1600×1200），
// 大人抱著剛哭過的女孩替她擦臉；大人是老師還是家長待園方確認，替代文字只寫「大人」。/about「情緒」那格也用這張。
// 健康把關的母檔 2026-11-13 從 1961×934 的橫幅重裁成 747×934（4:5，同後台的裁切預覽）：拱框只看得到橫幅的 37%，
// 手機卻要為了它下載 1600w（91 KB）。裁法：原本拱框 0.78、焦點 33% 看到的是 x 407–1135，取 x 397–1144 讓那一段落在正中，焦點改 50%，取景不變。
const CARE_LOOKS: Look[] = [
  { shape: 's-arch', ar: 0.78, color: 'terra', pos: '50% 50%' },
  { shape: 's-circle', color: 'mustard', pos: '58% 30%' },
  { shape: 's-qtr', ar: 0.92, color: 'sage', q: '64%', pos: '50% 16%' },
  { shape: 's-u', ar: 0.82, color: 'mist', pos: '48% 36%' },
  { shape: 's-sq', ar: 1.1, color: 'pink', pos: '47% 50%' }
]
// 形狀的預設寬高比（同 environment.css 的 --ar 預設值），算 sizes 用
const SHAPE_AR: Record<string, number> = { 's-circle': 1, 's-sq': 1, 's-arch': 0.8, 's-u': 0.85, 's-semi': 2, 's-qtl': 1, 's-qtr': 1 }
const lookAr = (look: Look) => look.ar ?? SHAPE_AR[look.shape] ?? 1
// 照顧小照的框寬：桌機五欄最寬 221px（版心 1240 − 4 個欄距）、平板三欄更窄；手機兩欄，一欄約視窗的 44%。
// 照片比框寬的部分由 pageCoverPhotoAttrs 乘倍率（內建的 4:3 照片放進圓或拱約 ×1.3–1.7；後台換上的橫幅照片倍率更大）。
const careSizes = (factor: number) => `(max-width: 640px) calc(44vw * ${factor}), ${Math.round(221 * factor)}px`
// 六個空間：照片形狀各不相同、後面錯開墊一塊別色（多半也別種形狀）的積木。戶外廣場只能用明華校的照片（後台標「明華校」）。
// 照片在各自那一欄置中（圓點小路走欄的中線）。寬度只用三種：右欄的 1、5 撐滿（右緣貼版心）、拱 66%、左欄的 2、4、6 一律 76%
// ——2026-11-13 前是 96／74／66／72／100／78，同一欄的照片左右緣各差 6–17px，讀起來像沒對齊。
const SPACES = [
  { image: 'env-space-classroom', alt: '陽光照進木地板教室，牆邊是矮櫃與小桌椅' },
  { image: 'env-space-materials', alt: '女孩坐在桌前，專心組著各式彩色操作教具' },
  { image: 'env-space-plaza', alt: '明華校的戶外廣場上，女孩笑著往前跑，旁邊的孩子坐著看' },
  // 2026-11-03 安全角落改用園方雲端「115招生照片」的 Hape 遊戲室（推測崇德校、待確認，不標校別）；原本的球池照原檔只有 900px
  { image: 'env-space-corner', alt: '孩子在室內遊戲室笑著爬過軟墊積木，兩旁的欄杆也包著軟墊' },
  { image: 'env-space-restroom', alt: '孩子高度的洗手台，掛著一排小毛巾' },
  { image: 'env-space-animals', alt: '孩子蹲在圍欄邊，拿紅蘿蔔餵裡面的小兔子' }
]
const SPACE_LOOKS: Look[] = [
  { shape: 's-qtl', ar: 1.3, color: 'mist', back: ['s-qtl', 'mustard', 1.3], w: '100%', bx: '-22px', by: '22px', q: '58%' },
  { shape: 's-circle', color: 'pink', back: ['s-sq', 'sage'], w: '76%', bx: '24px', by: '24px', pos: '50% 35%' },
  { shape: 's-arch', ar: 0.82, color: 'terra', back: ['s-arch', 'mist', 0.82], w: '66%', bx: '-24px', by: '24px', pos: '80% 40%' },
  { shape: 's-u', ar: 0.9, color: 'sage', back: ['s-circle', 'pink'], w: '76%', bx: '26px', by: '-26px', pos: '50% 38%' },
  { shape: 's-semi', color: 'mustard', back: ['s-semi', 'terra'], w: '100%', bx: '0px', by: '-30px', pos: '50% 78%' },
  { shape: 's-sq', ar: 1.08, color: 'mist', back: ['s-circle', 'mustard'], w: '76%', bx: '26px', by: '-26px', pos: '68% 50%' }
]
// 一天五餐的小圖示（30×30，平塗＋同色深一階的側面往下錯開，跟頁面上的積木同一招）；依序對到五餐，後台改了餐名也照順序
// 2026-11-14：吐司從黃改珊瑚橘（黃吐司在白盤上幾乎看不出形狀）、蘋果從橘改蜜桃粉（橘色讀成橘子），五個圖示正好五個積木色
const MEAL_ICONS = [
  '<path d="M7 14a6 6 0 0 1 3.4-9.2h9.2A6 6 0 0 1 23 14v10.5a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2Z" fill="var(--renv-terra-side)" transform="translate(0 2.5)"/><path d="M7 14a6 6 0 0 1 3.4-9.2h9.2A6 6 0 0 1 23 14v10.5a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2Z" fill="var(--renv-terra)"/><rect x="10.5" y="12" width="9" height="10.5" rx="2.2" fill="var(--renv-paper)"/>',
  '<path d="M6 8 Q7.5 24 25 23.5" fill="none" stroke="var(--renv-mustard-side)" stroke-width="8" stroke-linecap="round" transform="translate(0 2.5)"/><path d="M6 8 Q7.5 24 25 23.5" fill="none" stroke="var(--renv-mustard)" stroke-width="8" stroke-linecap="round"/><path d="M5 5.5 6.2 9" stroke="var(--renv-forest)" stroke-width="3" stroke-linecap="round"/>',
  '<path d="M3.5 14h23a11.5 11.5 0 0 1-23 0Z" fill="var(--renv-sage-side)" transform="translate(0 2.5)"/><path d="M8.5 14a6.5 5 0 0 1 13 0Z" fill="var(--renv-cream-side)"/><path d="M3.5 14h23a11.5 11.5 0 0 1-23 0Z" fill="var(--renv-sage)"/>',
  '<circle cx="15" cy="19.5" r="10.5" fill="var(--renv-pink-side)"/><circle cx="15" cy="17" r="10.5" fill="var(--renv-pink)"/><path d="M15 3.5v6" stroke="var(--renv-forest)" stroke-width="3" stroke-linecap="round"/><ellipse cx="21" cy="5.5" rx="5.2" ry="2.8" transform="rotate(-28 21 5.5)" fill="var(--renv-sage)"/>',
  '<path d="M21 12h2.5a4 4 0 0 1 0 8H21" fill="none" stroke="var(--renv-mist-side)" stroke-width="3.2" stroke-linecap="round"/><path d="M6 9h15v13a4 4 0 0 1-4 4h-7a4 4 0 0 1-4-4Z" fill="var(--renv-mist-side)" transform="translate(0 2.5)"/><path d="M6 9h15v13a4 4 0 0 1-4 4h-7a4 4 0 0 1-4-4Z" fill="var(--renv-mist)"/>'
]
// 五顆心：兩個圓＋一個轉 45° 的方塊拼成的幾何愛心
const HEART = 'M0 30 L-30 0 A21.21 21.21 0 0 1 0 -30 A21.21 21.21 0 0 1 30 0 Z'
const HEART_COLORS: Block[] = ['terra', 'mustard', 'sage', 'mist', 'pink']
// 目次四塊積木的形狀與顏色
// 顏色＝那一章的章節色（2026-11-14）：01 粉、02 綠、03 黃、04 藍，和各章底板的底色、章節標籤的小圓同一個色相家族；
// 原本 01 是黃、03 是粉，和它們的章節底色（粉、黃）正好相反。
const INDEX_LOOKS: [string, Block][] = [['s-circle', 'pink'], ['s-arch', 'sage'], ['s-sq', 'mustard'], ['s-semi', 'mist']]
const TOUR_COLORS: Block[] = ['mustard', 'sage', 'mist', 'pink', 'terra']
// 照片後面墊的積木：不用藍（這一章的底板是藍的，藍墊塊會糊掉），也不和那一校照片框的顏色相同。i＝0 是大圖，其餘依序是小照片
const tourBack = (t: number, i: number): Block => {
  const pool = TOUR_COLORS.filter((color) => color !== 'mist' && color !== TOUR_COLORS[t % 5])
  return pool[(t + i) % pool.length]!
}

const heroLines = computed(() => pageMarkedLines(props.page.heroTitle, props.page.heroHighlight))
const careItems = computed(() => props.page.careItems.map((item, i) => ({ ...CARE[i]!, ...item, look: CARE_LOOKS[i]! })))
const spaces = computed(() => props.page.spaces.map((space, i) => ({ ...SPACES[i]!, ...space, look: SPACE_LOOKS[i]! })))
const meals = computed(() => props.page.meals.map((item, i) => ({ ...item, icon: MEAL_ICONS[i] ?? MEAL_ICONS[2]! })))

// 照片積木的 CSS 變數（形狀比例、墊塊錯開量）
const frameStyle = (look: Look) => ({ ...(look.ar ? { '--ar': String(look.ar) } : {}), ...(look.q ? { '--q': look.q } : {}) })
const phStyle = (look: Look) => ({ ...(look.w ? { width: look.w } : {}), ...(look.bx ? { '--bx': look.bx } : {}), ...(look.by ? { '--by': look.by } : {}) })
const backStyle = (look: Look) => (look.back?.[2] ? { '--ar': String(look.back[2]) } : undefined)

// 結尾不放預約，改成往站內其他分頁走；提示字取自各頁的章節名
const NEXT = [
  { href: '/#life', title: '孩子的一天', hint: '六個日常片刻', look: ['s-arch', 'sage'] },
  { href: '/curriculum', title: '特色教學', hint: '四個年段與課程方向', look: ['s-circle', 'mustard'] },
  { href: '/admission', title: '入學資訊', hint: '入學流程、分班對照', look: ['s-sq', 'mist'] }
]
const nextPages = computed(() => NEXT.filter((item) => props.admission || item.href !== '/admission'))

const meal = mealBookLink()

// 第四章：只收有場景的校
const tours = computed(() => props.campuses
  .map((campus) => ({ campus, scenes: campus.tourScenes }))
  .filter((tour): tour is { campus: Campus; scenes: TourScene[] } => tour.scenes.length > 0))
const sceneCount = computed(() => tours.value.reduce((sum, tour) => sum + tour.scenes.length, 0))
const active = ref('')
const activeKey = computed(() => (tours.value.some((tour) => tour.campus.key === active.value) ? active.value : tours.value[0]?.campus.key))
// 第一張拱形（桌機、平板約 1.28:1，手機 1.05:1）；其餘的小照片圓與方交替（邊長 --ph：桌機最大 250、平板 150、手機最大 170）。
// 照片多半是 16:10、比框寬，cover 裁切後要畫的寬度約框寬 × 1.25（拱）或 × 1.6（圓、方、手機的拱）。
const SCENE_SHAPES = ['s-circle', 's-sq']
const sceneImage = (scene: TourScene, lead: boolean) => responsiveTourImage(scene.image, lead
  ? '(max-width: 640px) calc((100vw - 32px) * 1.55), (max-width: 900px) 62vw, 820px'
  : '(max-width: 640px) 272px, (max-width: 900px) 240px, 400px', false, scene.imageMedia)

const chapters = computed(() => [
  { id: 'care', label: props.page.chapterNames[0], hint: '五顆心的照顧' },
  { id: 'spaces', label: props.page.chapterNames[1], hint: `${SPACES.length + 1} 個孩子的空間` },
  { id: 'meals', label: props.page.chapterNames[2], hint: `${meal.month} 月菜單` },
  ...(tours.value.length ? [{ id: 'campuses', label: props.page.chapterNames[3], hint: `${sceneCount.value} 個校園角落` }] : [])
].map((chapter, i) => ({ ...chapter, no: String(i + 1).padStart(2, '0') })))
const chapterNo = (id: string) => chapters.value.find((chapter) => chapter.id === id)?.no

// ---------- 分頁（WAI-ARIA tabs：左右鍵、Home、End） ----------
const tabRefs = ref<HTMLButtonElement[]>([])
async function selectTab(key: string, focus = false) {
  const changed = key !== activeKey.value
  active.value = key
  await nextTick()
  if (focus) tabRefs.value.find((button) => button.dataset.key === key)?.focus()
  // 真的換了校，新分頁的照片積木落下來
  const panel = root.value?.querySelector<HTMLElement>(`#tour-${key}`)
  if (changed && panel) drop?.replay(panel)
}
function onTabKey(event: KeyboardEvent, index: number) {
  const target = ({ ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: tours.value.length - 1 } as Record<string, number>)[event.key]
  if (target === undefined) return
  event.preventDefault()
  const count = tours.value.length
  void selectTab(tours.value[(target + count) % count]!.campus.key, true)
}

// ---------- 積木落下：一開始就在視窗裡的不動（首屏與 LCP 照片不能先藏起來），往下捲到才落定 ----------
interface Drop { replay: (scope: HTMLElement) => void; destroy: () => void }
function createDrop(scope: HTMLElement): Drop {
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue
      e.target.classList.add('is-in')
      io.unobserve(e.target)
    }
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.1 })
  const fold = innerHeight
  const waiting = [...scope.querySelectorAll<HTMLElement>('[data-drop]')].filter((el) => !el.closest('[hidden]') && el.getBoundingClientRect().top >= fold)
  for (const el of waiting) {
    el.classList.add('is-waiting')
    io.observe(el)
  }
  return {
    replay(panel) {
      for (const el of panel.querySelectorAll<HTMLElement>('[data-drop]')) {
        el.classList.remove('is-in')
        el.classList.add('is-waiting')
        io.observe(el)
      }
    },
    destroy: () => io.disconnect()
  }
}

const root = ref<HTMLElement | null>(null)
let drop: Drop | null = null
let routes: EnvironmentRoutes | null = null
let disposed = false
onMounted(async () => {
  if (!root.value) return
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches
  if (!reducedMotion && 'IntersectionObserver' in window) drop = createDrop(root.value)
  // 圓點小路是裝飾，動態載入；載入失敗就沒有圓點，其餘照常
  const loaded = await import('~/utils/environment-route').catch(() => null)
  if (disposed || !root.value || !loaded) return
  routes = loaded.createEnvironmentRoutes(root.value, { reducedMotion })
})
onBeforeUnmount(() => { disposed = true; drop?.destroy(); routes?.destroy() })
// 後台即時預覽（pages/preview.vue）會一直換 page／campuses：文字變長變短、照片換掉後版面高度跟著變，圓點小路要依新版面重算。
// flush: 'post' 等畫面更新完再量，同一個 tick 內改好幾處只算一次。正式頁的 props 不會再變；小路還沒建好時略過。
watch([() => props.page, () => props.campuses], () => routes?.refresh(), { deep: true, flush: 'post' })
</script>

<template>
  <main id="main" ref="root" tabindex="-1" class="renv" data-cta-entry="environment">
    <!-- 首屏：大標、赤陶拱積木裡的照片、四塊積木目次 -->
    <section class="renv-hero" data-track-section="hero" aria-labelledby="environment-title">
      <div class="renv-wrap renv-hero-grid">
        <div class="renv-hero-txt">
          <h1 id="environment-title"><span v-for="(line, i) in heroLines" :key="i">{{ line.before }}<mark v-if="line.mark" class="renv-mark">{{ line.mark }}</mark>{{ line.after }}</span></h1>
          <p v-if="page.heroLede" class="renv-text renv-lede"><Phrases :text="page.heroLede" /></p>
          <p v-if="page.heroNotice" class="renv-notice">{{ page.heroNotice }}</p>
        </div>
        <div class="renv-hero-fig">
          <!-- 一塊赤陶拱積木：拱窗放照片，後面錯開墊一塊芥末拱（2026-11-04 取代五道的彩虹疊疊樂） -->
          <div class="renv-arch">
            <div class="renv-arch-back renv-blk c-mustard" aria-hidden="true" />
            <div class="renv-arch-face c-terra">
              <ResponsivePicture class="renv-arch-photo" v-bind="environmentHeroAttrs(page)" :style="pagePhotoStyle('70% 38%', page.heroPhoto)" :alt="pagePhotoAlt(HERO_ALT, page.heroPhoto, page.heroPhotoAlt)" loading="eager" fetchpriority="high" />
            </div>
          </div>
        </div>
        <nav class="renv-index" aria-label="本頁章節">
          <ul>
            <li v-for="(chapter, i) in chapters" :key="chapter.id">
              <a :class="[INDEX_LOOKS[i]![0], `c-${INDEX_LOOKS[i]![1]}`]" :href="`#${chapter.id}`">
                <b class="renv-index-no" lang="en">{{ chapter.no }}</b><span class="renv-index-name">{{ chapter.label }}</span><span class="renv-index-hint">{{ chapter.hint }}</span>
              </a>
            </li>
          </ul>
        </nav>
      </div>
    </section>

    <!-- 01 幼兒保育：幾何愛心、主照片、五件照顧的小事 -->
    <section id="care" data-track-section="care" class="renv-section renv-care" aria-labelledby="care-title">
      <div class="renv-wrap">
        <div class="renv-care-head">
          <div>
            <p class="renv-kicker"><span class="renv-dot c-forest" lang="en">{{ chapterNo('care') }}</span>{{ page.chapterNames[0] }}</p>
            <h2 id="care-title" class="renv-title"><span v-for="(line, i) in pageTitleLines(page.careTitle)" :key="i">{{ line }}</span></h2>
          </div>
          <div class="renv-hearts-box">
            <p v-if="page.careLead" class="renv-text"><Phrases :text="page.careLead" /></p>
            <ul class="renv-hearts">
              <li v-for="(heart, i) in page.hearts" :key="i" :class="`c-${HEART_COLORS[i % 5]}`" data-drop :style="{ '--i': i }">
                <svg class="renv-heart" viewBox="-37 -38 74 76" aria-hidden="true" focusable="false"><path class="is-side" :d="HEART" transform="translate(0 6)" /><path class="is-face" :d="HEART" /></svg>
                <b>{{ heart }}</b>
              </li>
            </ul>
            <p v-if="page.careText" class="renv-text"><Phrases :text="page.careText" /></p>
          </div>
        </div>
        <div class="renv-care-main">
          <div class="renv-ph" data-drop>
            <div class="renv-ph-back renv-blk s-d c-mustard" aria-hidden="true" />
            <div class="renv-frame s-d c-terra">
              <ResponsivePicture v-bind="pagePhotoAttrs('env-care-teacher', page.carePhoto, '(max-width: 640px) calc((100vw - 32px) * 1.3), (max-width: 900px) calc(100vw - 48px), 1320px')" :style="pagePhotoStyle('60% 50%', page.carePhoto)" :alt="pagePhotoAlt(CARE_PHOTO_ALT, page.carePhoto, page.carePhotoAlt)" loading="lazy" />
            </div>
          </div>
        </div>
        <ol class="renv-cares">
          <li v-for="(item, i) in careItems" :key="item.image">
            <div class="renv-care-ph">
              <div class="renv-ph" data-drop :style="{ '--i': i }">
                <div class="renv-frame" :class="[item.look.shape, `c-${item.look.color}`]" :style="frameStyle(item.look)">
                  <ResponsivePicture v-bind="pageCoverPhotoAttrs(item.image, item.photo, lookAr(item.look), careSizes)" :style="pagePhotoStyle(item.look.pos, item.photo)" :alt="pagePhotoAlt(item.alt, item.photo, item.photoAlt)" loading="lazy" />
                </div>
              </div>
            </div>
            <div class="renv-care-txt">
              <h3><span class="renv-dot" :class="`c-${item.look.color}`" lang="en">{{ i + 1 }}</span>{{ item.title }}</h3>
              <p><Phrases :text="item.text" /></p>
            </div>
          </li>
        </ol>
      </div>
    </section>

    <!-- 02 校園環境：遊樂區主打，六個空間左右交錯、圓點小路從一張照片接到下一張 -->
    <section id="spaces" data-track-section="spaces" class="renv-section renv-spaces" aria-labelledby="spaces-title">
      <div class="renv-wrap">
        <p class="renv-kicker"><span class="renv-dot c-forest" lang="en">{{ chapterNo('spaces') }}</span>{{ page.chapterNames[1] }}</p>
        <h2 id="spaces-title" class="renv-title"><span v-for="(line, i) in pageTitleLines(page.spacesTitle)" :key="i">{{ line }}</span></h2>
        <p v-if="page.spacesText" class="renv-text"><Phrases :text="page.spacesText" /></p>
        <div class="renv-feature">
          <div class="renv-ph" data-drop>
            <div class="renv-ph-back renv-blk s-qbl c-mustard" aria-hidden="true" />
            <div class="renv-frame s-qbl c-sage">
              <ResponsivePicture v-bind="pagePhotoAttrs('env-space-playground', page.feature.photo, '(max-width: 640px) calc(100vw - 32px), (max-width: 900px) 54vw, 680px')" :style="pagePhotoStyle(undefined, page.feature.photo)" :alt="pagePhotoAlt(FEATURE_ALT, page.feature.photo, page.feature.photoAlt)" loading="lazy" />
            </div>
          </div>
          <div class="renv-feature-copy">
            <p class="renv-tag renv-blk c-sage">{{ page.feature.tag }}</p>
            <h3><span v-for="(line, i) in pageTitleLines(page.feature.title)" :key="i">{{ line }}</span></h3>
            <p class="renv-text"><Phrases :text="page.feature.text" /></p>
          </div>
        </div>
        <div class="renv-stops">
          <svg class="renv-route" data-route="map" aria-hidden="true" focusable="false" />
          <ol class="renv-stop-list">
            <li v-for="(space, i) in spaces" :key="space.image" class="renv-stop" :data-route-color="`var(--renv-${space.look.color}-side)`">
              <div class="renv-stop-ph">
                <div class="renv-ph" data-drop :style="phStyle(space.look)">
                  <div class="renv-ph-back renv-blk" :class="[space.look.back![0], `c-${space.look.back![1]}`]" :style="backStyle(space.look)" aria-hidden="true" />
                  <div class="renv-frame" :class="[space.look.shape, `c-${space.look.color}`]" :style="frameStyle(space.look)">
                    <ResponsivePicture v-bind="pagePhotoAttrs(space.image, space.photo, '(max-width: 640px) calc((100vw - 82px) * 1.6), (max-width: 900px) 84vw, 660px')" :style="pagePhotoStyle(space.look.pos, space.photo)" :alt="pagePhotoAlt(space.alt, space.photo, space.photoAlt)" loading="lazy" />
                  </div>
                  <span v-if="space.campusLabel" class="renv-campus renv-blk c-mustard">{{ space.campusLabel }}</span>
                  <span class="renv-dot renv-stop-no" :class="`c-${space.look.color}`" lang="en" aria-hidden="true">{{ i + 1 }}</span>
                </div>
              </div>
              <div class="renv-stop-copy" data-drop :style="{ '--i': 1 }">
                <h3>{{ space.title }}</h3>
                <p><Phrases :text="space.text" /></p>
              </div>
            </li>
          </ol>
        </div>
      </div>
    </section>

    <!-- 03 幼兒餐點：營養餐點書、一天五餐的時間軸 -->
    <section id="meals" data-track-section="meals" class="renv-section renv-meals" aria-labelledby="meals-title">
      <div class="renv-wrap renv-meals-top">
        <div>
          <p class="renv-kicker"><span class="renv-dot c-forest" lang="en">{{ chapterNo('meals') }}</span>{{ page.chapterNames[2] }}</p>
          <h2 id="meals-title" class="renv-title"><span v-for="(line, i) in pageTitleLines(page.mealsTitle)" :key="i">{{ line }}</span></h2>
          <p class="renv-text"><Phrases :text="page.mealsText" /></p>
          <a class="renv-btn c-forest" :href="meal.href" target="_blank" rel="noopener">{{ meal.label }}<svg class="icon" aria-hidden="true" focusable="false"><use href="#i-arrow-up-right" /></svg><span class="sr-only">（另開新視窗）</span></a>
        </div>
        <a class="renv-book" :href="meal.href" target="_blank" rel="noopener" tabindex="-1" aria-hidden="true">
          <span class="renv-book-arch renv-blk s-arch c-terra" data-drop />
          <ResponsivePicture class="renv-book-cover" v-bind="responsiveImage('env-meal-book', '(max-width: 900px) 162px, 224px')" alt="" loading="lazy" data-drop :style="{ '--i': 1 }" />
          <span class="renv-book-semi renv-blk s-semi c-sage" data-drop :style="{ '--i': 2 }" />
        </a>
      </div>
      <div class="renv-wrap renv-day">
        <h3 class="renv-day-title">{{ plainTitle(page.mealsDayTitle) }}</h3>
        <div class="renv-day-track">
          <svg class="renv-route" data-route="day" aria-hidden="true" focusable="false" />
          <ol class="renv-day-list">
            <li v-for="(item, i) in meals" :key="i" data-drop :style="{ '--i': i }">
              <time lang="en">{{ item.time }}</time>
              <!-- eslint-disable-next-line vue/no-v-html -- 本檔固定的小圖示常數，不含後台或使用者內容 -->
              <span class="renv-stn renv-blk c-cream"><svg viewBox="0 0 30 30" aria-hidden="true" focusable="false" v-html="item.icon" /></span>
              <b>{{ item.name }}</b><small>{{ item.note }}</small>
              <p v-if="item.text"><Phrases :text="item.text" /></p>
            </li>
          </ol>
        </div>
      </div>
    </section>

    <!-- 04 五所校園：各校校園探索的實景（後台 campus_tour 發布的內容） -->
    <section v-if="tours.length" id="campuses" data-track-section="tour" class="renv-section renv-tour" aria-labelledby="tour-title">
      <div class="renv-wrap">
        <div class="renv-tour-head">
          <div>
            <p class="renv-kicker"><span class="renv-dot c-forest" lang="en">{{ chapterNo('campuses') }}</span>{{ page.chapterNames[3] }}</p>
            <h2 id="tour-title" class="renv-title"><span v-for="(line, i) in pageTitleLines(page.tourTitle)" :key="i">{{ line }}</span></h2>
          </div>
          <p v-if="page.tourText" class="renv-text"><Phrases :text="page.tourText" /></p>
        </div>
        <div class="renv-tour-tabs" role="tablist" aria-label="選一所校園">
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
              <ResponsivePicture class="renv-tour-wash" v-bind="responsiveImage(`campus-line-art-${tour.campus.key}-wash`, '(max-width: 900px) 124px, 200px')" alt="" loading="lazy" decoding="async" />
              <ResponsivePicture v-bind="responsiveImage(`campus-line-art-${tour.campus.key}-ink`, '(max-width: 900px) 124px, 200px')" alt="" loading="lazy" decoding="async" />
            </span>
            <b>{{ tour.campus.name }}</b>
          </button>
        </div>
        <div
          v-for="(tour, t) in tours"
          :id="`tour-${tour.campus.key}`"
          :key="tour.campus.key"
          class="renv-tour-panel"
          role="tabpanel"
          :aria-labelledby="`tour-tab-${tour.campus.key}`"
          tabindex="0"
          :hidden="tour.campus.key !== activeKey"
        >
          <div class="renv-tour-panel-head"><h3>{{ tour.campus.name }}</h3><p>{{ tour.campus.district }}・{{ tour.scenes.length }} 個角落</p></div>
          <div class="renv-scenes">
            <div class="renv-scene renv-scene-lead">
              <div class="renv-ph" data-drop>
                <div class="renv-ph-back renv-blk s-arch" :class="`c-${tourBack(t, 0)}`" aria-hidden="true" />
                <div class="renv-frame s-arch" :class="`c-${TOUR_COLORS[t % 5]}`">
                  <ResponsivePicture v-bind="sceneImage(tour.scenes[0]!, true)" :style="pagePhotoStyle(undefined, tour.scenes[0]!.imageMedia)" :alt="`${tour.campus.name}的${tour.scenes[0]!.name}`" loading="lazy" decoding="async" />
                </div>
              </div>
              <h4>{{ tour.scenes[0]!.name }}</h4>
            </div>
            <ul v-if="tour.scenes.length > 1" class="renv-scene-list">
              <li v-for="(scene, s) in tour.scenes.slice(1)" :key="scene.key" class="renv-scene">
                <div class="renv-ph" data-drop :style="{ '--i': s + 1 }">
                  <div class="renv-ph-back renv-blk" :class="[SCENE_SHAPES[s % 2], `c-${tourBack(t, s + 1)}`]" aria-hidden="true" />
                  <div class="renv-frame" :class="[SCENE_SHAPES[s % 2], `c-${TOUR_COLORS[t % 5]}`]">
                    <ResponsivePicture v-bind="sceneImage(scene, false)" :style="pagePhotoStyle(undefined, scene.imageMedia)" :alt="`${tour.campus.name}的${scene.name}`" loading="lazy" decoding="async" />
                  </div>
                </div>
                <h4>{{ scene.name }}</h4>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </section>

    <!-- 結尾：接下來可以看（不放預約） -->
    <section class="renv-section renv-next" aria-labelledby="next-title">
      <div class="renv-wrap">
        <h2 id="next-title" class="renv-next-title">還可以看看這幾頁</h2>
        <ul class="renv-next-list">
          <li v-for="(item, i) in nextPages" :key="item.href" data-drop :style="{ '--i': i }">
            <NuxtLink class="renv-next-link" :class="[item.look[0], `c-${item.look[1]}`]" :to="item.href"><b>{{ item.title }}</b><small>{{ item.hint }}</small></NuxtLink>
          </li>
        </ul>
      </div>
    </section>
  </main>
</template>

<style src="../assets/css/environment.css"></style>
