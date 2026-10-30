// 常春藤環境頁前三章的內建內容：官網 web/server/data/site-fixture.json 的 environmentPage，一字不差
// （environmentPageDraft.test.ts 逐欄比對文字，含巢狀 spaces[].campusLabel ↔ campus_label）。從未存過任何
// 版本時編輯頁的表單就是它。照片版位是 null／''＝官網內建照片與內建說明，形狀同後端
// EnvironmentPagePayload.model_dump()：表單換了照片又改回內建時會寫回 null／''，初稿要先有這些鍵，
// 快照才對得上，不會被當成「有未儲存的修改」。
import type { EnvironmentPagePayload } from '../api/types'

export const ENVIRONMENT_CHAPTER_HINTS = [
  '第一章，也是首屏目次與章前的小標',
  '第二章',
  '第三章',
  '第四章（校園探索還沒有場景時整章不出現）',
] as const

// 官網內建照片的代號（web/public/assets/<代號>.webp）。首屏照片在 utils/responsive-image.ts，其餘在
// EnvironmentContent.vue（照顧的小事與六個空間照索引對應，順序同官網）。
export const ENVIRONMENT_BUILTIN_PHOTOS = {
  hero: 'env-hero-hug',
  care: 'env-care-teacher',
  feature: 'env-space-playground',
  careItems: ['env-care-health', 'env-care-meal', 'env-care-clothes', 'env-care-comfort', 'env-care-clean'],
  spaces: ['env-space-classroom', 'env-space-materials', 'env-space-plaza', 'env-space-corner', 'env-space-restroom', 'env-space-animals'],
} as const

// 官網實際裁切的比例（web/app/assets/css/environment.css）：首屏與主打區 3:2、保育照片 2:1 橫幅、
// 照顧的小事 4:3；六個空間照片依原本比例整張顯示，不裁切，所以沒有焦點預覽。
// 2026-10-30 官網木頭積木版：照片裝在積木形狀裡，這裡給最接近的矩形比例預覽裁切（形狀的圓角另外再裁掉一點邊緣）
export const ENVIRONMENT_PHOTO_PREVIEWS = {
  hero: [{ label: '官網裁切（彩虹最內圈的拱，約 3:4）', ratio: '3 / 4' }],
  care: [{ label: '官網裁切（桌機 2.75:1）', ratio: '2.75 / 1' }, { label: '手機（2.2:1）', ratio: '2.2 / 1' }],
  feature: [{ label: '官網裁切（3:2）', ratio: '3 / 2' }],
  careItem: [{ label: '官網裁切（約 4:5）', ratio: '4 / 5' }],
  space: [{ label: '官網裁切（約 1:1）', ratio: '1 / 1' }],
} as const

const MEAL_TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/

/** 餐點時間必須是 24 小時制的兩位數「時:分」（同後端 _MEAL_TIME）；格式正確回空字串。 */
export function mealTimeError(value: string | null | undefined): string {
  return MEAL_TIME.test(value ?? '') ? '' : '請用 24 小時制的「時:分」，例如 08:30'
}

/**
 * 第 index 個餐點的時間不比上一個晚（早或同一時間）時回說明。官網時間軸的順序與小圖示依序號固定，
 * 後端擋倒序與同時間，所以這裡先在那一個餐點提醒；任一個時間格式不對就不比（格式的提醒另外顯示）。
 */
export function mealOrderError(meals: readonly { time: string; name: string }[], index: number): string {
  const previous = meals[index - 1]
  const current = meals[index]
  if (!previous || !current || mealTimeError(previous.time) || mealTimeError(current.time)) return ''
  if (current.time > previous.time) return ''
  return `要比上一個（${previous.name} ${previous.time}）晚，時間要由早到晚，否則存不了`
}

/** 照片版位留空（官網內建照片）；每項各給一份新物件，表單改一項不會連動別項。 */
function noPhoto(): { photo: null; photo_alt: string } {
  return { photo: null, photo_alt: '' }
}

export function environmentPageDraft(): EnvironmentPagePayload {
  return {
    hero_title: '孩子的每一天，\n都在這裡安心長大。',
    hero_highlight: '安心',
    hero_lede: '保育照顧、校園環境與幼兒餐點，整理在同一頁。',
    hero_notice: '照片取自各校日常，空間配置各校略有不同。',
    hero_photo: null,
    hero_photo_alt: '',
    hero_caption: '兩個孩子，在教室裡抱得緊緊的。',
    chapter_names: ['幼兒保育', '校園環境', '幼兒餐點', '五所校園'],
    care_title: '五顆心，\n照顧每一天。',
    care_lead: '專業保育照顧，靠的是五顆心：',
    hearts: ['愛心', '細心', '耐心', '貼心', '同理心'],
    care_text: '從量體溫、吃蔬果到換衣服、安撫情緒，老師把孩子在學校的每一件小事都放在心上。',
    care_photo: null,
    care_photo_alt: '',
    care_caption: '老師帶著幼幼班的孩子，一起拍手唱歌。',
    care_photo_note: '鈴鼓',
    care_items: [
      { title: '健康把關紀錄', text: '隨時注意孩子身體狀況，每日定時測量體溫。', ...noPhoto() },
      { title: '均衡飲食', text: '每日兩蔬果，增進免疫、提升孩子的健康。', ...noPhoto() },
      { title: '衣物保暖', text: '隨時注意孩子服裝的保暖與整齊。', ...noPhoto() },
      { title: '情緒安撫', text: '穩定、安定孩子的情緒。', ...noPhoto() },
      { title: '定時消毒', text: '每日定時教室消毒。', ...noPhoto() },
    ],
    spaces_title: '把安全與好奇，\n放進每個角落。',
    spaces_text: '從教室、教具、衛廁到戶外廣場，每個空間都以孩子的安全與探索為出發點。',
    feature: {
      tag: '安全歡樂遊樂區',
      title: '在遊戲裡，\n慢慢長大。',
      text: '遊戲幫助寶貝成長發育，發展精細動作、激發想像力、提升手眼協調力，讓寶貝開心、健康、快樂地成長。',
      note: '溜滑梯',
      ...noPhoto(),
    },
    trail_hint: '跟著小腳印，走一圈看看',
    spaces: [
      { title: '乾淨溫馨的教室', text: '課程統整，全方位主題教學，帶領孩子走出戶外，接觸大自然。', note: '陽光照進來', campus_label: '', ...noPhoto() },
      { title: '多樣操作教具', text: '多樣性教具提升寶貝邏輯思維；多元玩法搭配豐富內容，讓寶貝養成自主學習的好習慣。', note: '各式操作教具', campus_label: '', ...noPhoto() },
      { title: '戶外廣場', text: '寬敞明亮的大廣場，給予寶貝充足的空間伸展肢體、跑跑跳跳，讓寶貝贏在人生的起跑點！', note: '跑跑跳跳的大廣場', campus_label: '明華校', ...noPhoto() },
      { title: '安全角落設計', text: '厚軟墊防撞設計，加強角落安全性，寶貝唱唱跳跳好開心。', note: '厚軟墊防撞', campus_label: '', ...noPhoto() },
      { title: '套房式衛廁', text: '連接教室的套房式衛廁，時刻注意寶貝的安全及如廁狀況；安心環境幫助幼幼寶貝快速戒除尿布好放心！', note: '孩子高度的洗手台', campus_label: '', ...noPhoto() },
      { title: '可愛動物區', text: '可愛動物區激發寶貝主動探索大自然生態的熱情與動力，培養責任心與好奇心。', note: '餵小兔子吃紅蘿蔔', campus_label: '', ...noPhoto() },
    ],
    meals_title: '多一點天然，\n少一點加工。',
    meals_text: '每日餐點符合營養標準，廚房每天現煮，讓孩子吃到食物最原始的味道。每個月的菜單，都收在常春藤營養餐點書裡。',
    meals_day_title: '孩子在學校，一天吃這些',
    meals: [
      { time: '08:30', name: '早餐', note: '早餐美語', text: '營養好吃的早餐，讓孩子有精神、有活力。' },
      { time: '10:00', name: '香蕉', note: '每日兩蔬果之一', text: '每日兩蔬果，增進免疫。' },
      { time: '11:40', name: '午餐', note: '廚房每天現煮', text: '最新鮮、最營養的午餐，健健康康長大。' },
      { time: '12:00', name: '蘋果', note: '每日兩蔬果之二', text: '提升孩子的健康。' },
      { time: '15:30', name: '點心', note: '西米露、玉米粥', text: '即便是點心，也是豐盛的正餐。' },
    ],
    tour_title: '每一所校園，\n都有自己的角落。',
    tour_text: '空間配置各校不同。挑一所學校，看看各校的教室、遊戲場與角落。',
    tour_hint: '挑一所學校，翻開來看',
  }
}
