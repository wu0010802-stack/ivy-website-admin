// 特色教學頁的內建內容：官網 web/server/data/site-fixture.json 的 curriculumPage，一字不差
// （curriculumPage.test.ts 逐欄比對）。這份內容從未存過任何版本時，編輯頁的表單就是它，
// 官網這時顯示的也是同一份。照片版位不寫＝官網內建照片。
import type { CurriculumPagePayload } from '../api/types'

// 版面固定的項目（同後端 content/page_schemas.py 與官網 CurriculumContent.vue）。
export const CURRICULUM_YEAR_NAMES = ['幼幼班', '小班', '中班', '大班'] as const
export const CURRICULUM_DIRECTION_KEYS = ['cognitive', 'integrated', 'multicultural', 'quote', 'autonomy', 'activities', 'art'] as const

// 官網內建照片的代號（web/public/assets/<代號>.webp，同 CurriculumContent.vue 的常數）；
// 課程方向的 quote（品德培養）沒有照片，留空字串。
export const CURRICULUM_BUILTIN_PHOTOS = {
  hero: 'cur-hero',
  years: 'cur-years',
  directions: ['cur-cognitive', 'cur-integrated', 'cur-multicultural', '', 'cur-autonomy', 'cur-activities', 'cur-art'],
  gallery: [
    'cur-gallery-canvas-yellow', 'cur-gallery-clay-ball', 'cur-gallery-tote', 'cur-gallery-plane-pink',
    'cur-gallery-tee', 'cur-gallery-canvas-blue', 'cur-gallery-tape', 'cur-gallery-plane-dots',
  ],
  daily: ['cur-daily-calm', 'cur-daily-materials', 'cur-daily-art', 'cur-daily-reading', 'cur-daily-motor'],
} as const

/** 內建照片的預覽網址（後台和官網同源，/assets 由官網提供）。 */
export function builtinPhotoSrc(code: string): string {
  return `/assets/${code}.webp`
}

/** 大標裡找不到顏料標示的字（或跨行）時回 true；留空不算（同後端 page_schemas.py）。 */
export function highlightMissing(title: string, highlight: string): boolean {
  return Boolean(highlight) && !title.split('\n').some((line) => line.includes(highlight))
}

export function curriculumPageDraft(): CurriculumPagePayload {
  return {
    hero_eyebrow: '常春藤幼兒園 · 特色教學',
    hero_title: '從動手做開始，\n愛上學習。',
    hero_highlight: '動手做',
    hero_lede: '幼幼班到大班的四個年段、七個課程方向、孩子的作品，還有每天常做的五件事。',
    hero_notice: '照片取自各校日常，實際課程安排以各校說明為準。',
    chapters: [
      { label: '四個年段', hint: '幼幼班到大班' },
      { label: '課程方向', hint: '7 個方向' },
      { label: '兒童美術館', hint: '孩子的作品' },
      { label: '五件事', hint: '靜心到大肌肉' },
    ],
    years_title: '從幼幼班到大班，\n一年一個樣子。',
    years_text: '給孩子樂於學習、創造思考、勇敢表現、帶著走的核心素養。',
    spiral_label: '螺旋式課程',
    spiral_text: '以螺旋式的方法加深、加廣課程，延伸孩子各項能力。',
    years_caption: '老師和孩子們一起笑成一團。',
    years: [
      { motto: '老師好愛我', text: '全方位的保育環境，給孩子安全感及信賴感，這是寶貝第一個團體生活喔。' },
      { motto: '我會自己做', text: '會自己吃飯、會自己整理，會跟好朋友玩，也會跟老師分享，更會自己主動唸好好玩的故事書喔。' },
      { motto: '我喜歡學習', text: '打造扎實的學習基礎，語文、認知、邏輯、創造能力都好厲害喔。' },
      { motto: '要上小學囉', text: '打好基礎做準備，我長大了，好期待上小學喔！' },
    ],
    directions_title: '每一種學習，\n都從好奇開始。',
    directions_text: '從每天的繪本共讀，到音樂、美語、戶外教學與藝術創作。',
    directions: [
      { key: 'cognitive', title: '認知課程', sub: '每日一繪本親子共讀', text: '打好學齡前語文基礎，幼小銜接不擔心。' },
      { key: 'integrated', title: '統整課程', sub: '奧福音樂、感覺統合、主題學習', text: '完整豐富的統整課程。' },
      { key: 'multicultural', title: '多元文化課程', sub: '沉浸式美語活動', text: '孩子勇敢、自信、快樂表現。' },
      { key: 'quote', title: '品德培養', sub: '六歲定八十', text: '好習慣一生受用無窮。' },
      { key: 'autonomy', title: '自主學習', sub: '動手做、做中學', text: '讓孩子主動學習教具操作。' },
      { key: 'activities', title: '課程活動', sub: '主題戶外教學', text: '節慶活動及好玩的親子活動。' },
      { key: 'art', title: '藝術共創', sub: '每個孩子都是與生俱來的藝術家', text: '給孩子創造思考、解決問題的能力。' },
    ],
    gallery_title: '每一件作品，\n都從動手做開始。',
    gallery_text: '帆布袋、畫布、黏土到木頭飛機，這裡是孩子們的作品。',
    gallery_source: '作品照片取自機構網站「常春藤兒童美術館」。',
    gallery: [
      { label: '畫布上的人' }, { label: '黏土球' }, { label: '帆布袋' }, { label: '木頭飛機' },
      { label: '染色 T 恤' }, { label: '畫布上的人' }, { label: '膠帶留白畫' }, { label: '木頭飛機' },
    ],
    daily_title: '五件事，\n陪孩子慢慢練習。',
    daily_text: '安靜下來、動手操作、創作、閱讀，再到戶外盡情跑跳。',
    daily_source: '照片與介紹取自義華校。',
    daily: [
      { title: '靜心', text: '透過靜心活動，引導孩子穩定情緒、學習自我調節，陪伴寶貝在日常中培養尊重、關懷與自我接納，學會愛自己，也溫柔對待他人。' },
      { title: '教具操作', text: '以個別化的自主教具，引導孩子主動探索與學習。堅持動手做、從做中學，老師依孩子的年齡與能力，自行設計合適的教具，讓寶貝在操作中累積知識，一步步建立學習帶來的自信心。' },
      { title: '美術創作', text: '配合孩子的發展，提供主題式的完整學習架構，以孩子為本，引導思考與感受，在學習中培養美學素養，讓寶貝愛上探索美感，逐步發展多元的創作能力。' },
      { title: '閱讀素養', text: '以「親子共讀」拉近親子距離，在溫馨的閱讀時光中，培養寶貝愛閱讀的好習慣，穩定情緒、提升認知能力，為學齡前的學習素養奠定更好的基礎。' },
      { title: '大肌肉時間', text: '重視寶貝成長中不可或缺的推動力量，透過大量戶外活動與陽光陪伴，讓寶貝盡情與同儕互動、開心放電，在歡笑中學習，在自然中健康成長。' },
    ],
    belief_title: '我們相信，教育是\n「生命影響生命」的使命。',
    beliefs: ['重視愛與關懷', '注重閱讀素養', '培養生活自理能力', '養成終生學習的好習慣', '尊重個別差異，鼓勵自信探索'],
    belief_close: '期許幼兒在成長階段，擁有快樂、健康的環境。',
    belief_source: '取自義華校教學理念。',
  }
}
