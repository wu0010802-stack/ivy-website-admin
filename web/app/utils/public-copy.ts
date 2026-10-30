import type { SiteContent } from '../types/site-content'

const OLD_DESCRIPTION = '走進常春藤，認識五校的環境與孩子的校園生活。官網設計互動提案。'

// 官網已不顯示、但 fixture 還留著的欄位（後端初始化內容要讀，見 types/site-content.ts
// 開頭說明）。公開輸出前拿掉，頁面資料不帶這些舊文字。
// 2026-10-04 隨後台拿掉這些欄位一起整理；2026-10-05 再加原型預約表單的示範說明、
// 步驟與欄位清單（isDemo／demoNote／steps／fields，官網的預約表單從沒讀過）。
// 2026-10-08 常見問題（faq）、預約同意文字與橫幅（consentText／banner*）、分校簡介
// 與臉書備註（intro／description／fbNote）連同 fixture 與後端欄位一起刪除，
// 不在清單內。
const RETIRED = {
  hero: ['eyebrow'],
  campusBoard: ['note'],
  dayExperience: ['sourceNote'],
  booking: ['isDemo', 'demoNote', 'steps', 'fields'],
  campus: ['heroPhotoPos'],
  tourScene: ['spots', 'spots_reviewed']
} as const

function omit<T extends object>(value: T, keys: readonly string[]): T {
  const copy = { ...value } as Record<string, unknown>
  for (const key of keys) delete copy[key]
  return copy as T
}

// fixture 裡的 _todo 是給維護者看的待辦與來源備註（含 repo 內部路徑），任何層級都不進公開資料。
// fixture 本身要留著：後端初始化內容讀得到，維護者也靠它追待辦。
function withoutTodoNotes<T>(value: T): T {
  if (Array.isArray(value)) return value.map(withoutTodoNotes) as T
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).filter(([key]) => key !== '_todo').map(([key, child]) => [key, withoutTodoNotes(child)])
    ) as T
  }
  return value
}

/** 拿掉官網已不顯示的舊欄位與維護備註 _todo（不修改傳入的物件）。 */
export function withoutRetiredFields(site: SiteContent): SiteContent {
  return withoutTodoNotes({
    ...site,
    home: { ...site.home, hero: omit(site.home.hero, RETIRED.hero), campusBoard: omit(site.home.campusBoard, RETIRED.campusBoard) },
    dayExperience: omit(site.dayExperience, RETIRED.dayExperience),
    booking: omit(site.booking, RETIRED.booking),
    campuses: site.campuses.map((campus) => ({
      ...omit(campus, RETIRED.campus),
      tourScenes: campus.tourScenes.map((scene) => omit(scene, RETIRED.tourScene))
    }))
  })
}

// 原型時期寫給審稿看的來源說明（「提案」「取自官網」）：正式站改成一行署名（2026-10-29 前台評析）。
// 特色教學、環境頁的這幾欄後台可以改，內建內容與後台預設都還是原文；只換一字不差的原文，園方改過的照園方的。
// 2026-10-30 孩子的一天六張照片改用園方雲端的活動照，不限義華，署名跟著改成「各校日常」；
// 特色教學五件事的大肌肉時間同日換成足球賽照片，署名改成介紹與照片分開寫。
// 2026-10-30 同日使用者要版面乾淨，署名也拿掉（照片本來就是各校的，「義華校」是內部出處），換成空字串＝
// 整行不畫；只留孩子的一天那句作息提醒（片刻卡上寫了時間）。背景影片的出處影片角落另有一行，這裡不再寫。
const SOURCE_NOTES: Readonly<Record<string, string>> = {
  '日常情境提案，以義華校素材呈現；時刻取自官網一日流程，各校、各班實際安排請向園所確認。背景取自義華遊藝表演紀錄，與相片非同一天拍攝。':
    '各校、各班作息略有不同，以園所安排為準。',
  '照片取自各校日常，實際課程安排以各校說明為準。': '',
  '作品照片取自機構網站「常春藤兒童美術館」。': '',
  '照片與介紹取自義華校。': '',
  '取自義華校教學理念。': '',
  '照片取自各校日常，空間配置各校略有不同。': ''
}
const sourceNote = (text: string): string => SOURCE_NOTES[text] ?? text

/** 孩子的一天、特色教學、環境頁的原型來源說明換成署名（不修改傳入的物件）。 */
export function withSourceNotes(site: SiteContent): SiteContent {
  const { dayExperience: day, curriculumPage: curriculum, environmentPage: environment } = site
  return {
    ...site,
    dayExperience: day && { ...day, note: sourceNote(day.note) },
    curriculumPage: curriculum && { ...curriculum, heroNotice: sourceNote(curriculum.heroNotice), gallerySource: sourceNote(curriculum.gallerySource), dailySource: sourceNote(curriculum.dailySource), beliefSource: sourceNote(curriculum.beliefSource) },
    environmentPage: environment && { ...environment, heroNotice: sourceNote(environment.heroNotice) }
  }
}

// 2026-10-30 使用者要求「把沒有意義或多餘的文字拿掉，版面乾淨一點」。拿掉的是：把下面清單先念一遍的引言、
// 「整理在同一頁」這類講頁面本身的話、跟中文重複的英文小字、操作說明、只是口號的圖說。
// 這些欄位後台都能改：原文一字不差才換（換成空字串＝不顯示），園方改過的照園方的；內建內容與後台預設仍是原文。
const swap = (value: string, original: string, next = ''): string => (value === original ? next : value)
const ABOUT_STORY = '我們秉持不變的教育理念，堅持專業的保育，也不斷精進、嘗試新的教學方式，努力為孩子營造安心的環境，讓每個孩子都擁有獨一無二的童年。'
const MEALS_TEXT = '每日餐點符合營養標準，廚房每天現煮，讓孩子吃到食物最原始的味道。每個月的菜單，都收在常春藤營養餐點書裡。'
// 每一餐底下的一句話：名稱與小標已經寫了吃什麼、為什麼吃
const MEAL_FILLERS = new Set([
  '營養好吃的早餐，讓孩子有精神、有活力。',
  '每日兩蔬果，增進免疫。',
  '最新鮮、最營養的午餐，健健康康長大。',
  '提升孩子的健康。',
  '即便是點心，也是豐盛的正餐。'
])

/** 拿掉重複或沒有資訊的字（不修改傳入的物件）。 */
export function withoutRepeatedCopy(site: SiteContent): SiteContent {
  const { home, dayExperience: day, aboutPage: about, curriculumPage: curriculum, environmentPage: environment, admission } = site
  return {
    ...site,
    home: {
      ...home,
      // 「SINCE 1997」：內文第一句就是「自 1997 年在高雄創立」
      about: { ...home.about, sinceLabel: swap(home.about.sinceLabel, 'SINCE 1997'), caption: swap(home.about.caption, '把日常，變成值得記住的童年。') },
      campusBoard: { ...home.campusBoard, eyebrow: swap(home.campusBoard.eyebrow, 'Campuses') }
    },
    dayExperience: day && {
      ...day,
      eyebrowEn: swap(day.eyebrowEn, 'A DAY AT IVY'),
      filmCaption: { ...day.filmCaption, en: swap(day.filmCaption.en, 'LITTLE MOMENTS, BIG GROWTH.') }
    },
    aboutPage: about && {
      ...about,
      // 圖說和首頁大標同一句；首屏引言已經講了教育理念、專業保育與獨一無二的童年，第一章只留新的那半句
      heroCaption: swap(about.heroCaption, '把每個孩子，放在心上。'),
      storyText: swap(about.storyText, ABOUT_STORY, '我們不斷精進、嘗試新的教學方式，為孩子營造安心的環境。'),
      outroText: swap(about.outroText, '三民、左營、鳥松、仁武，五所校園各有自己的樣子。拉一條書籤，看看那所校園。')
    },
    curriculumPage: curriculum && {
      ...curriculum,
      heroEyebrow: swap(curriculum.heroEyebrow, '常春藤幼兒園 · 特色教學'),
      heroLede: swap(curriculum.heroLede, '幼幼班到大班的四個年段、七個課程方向、孩子的作品，還有每天常做的五件事。'),
      directionsText: swap(curriculum.directionsText, '從每天的繪本共讀，到音樂、美語、戶外教學與藝術創作。'),
      directions: curriculum.directions.map((item) => ({ ...item, text: swap(item.text, '完整豐富的統整課程。') })),
      galleryText: swap(curriculum.galleryText, '帆布袋、畫布、黏土到木頭飛機，這裡是孩子們的作品。'),
      dailyText: swap(curriculum.dailyText, '安靜下來、動手操作、創作、閱讀，再到戶外盡情跑跳。')
    },
    environmentPage: environment && {
      ...environment,
      heroLede: swap(environment.heroLede, '保育照顧、校園環境與幼兒餐點，整理在同一頁。'),
      careText: swap(environment.careText, '從量體溫、吃蔬果到換衣服、安撫情緒，老師把孩子在學校的每一件小事都放在心上。'),
      spacesText: swap(environment.spacesText, '從教室、教具、衛廁到戶外廣場，每個空間都以孩子的安全與探索為出發點。'),
      trailHint: swap(environment.trailHint, '跟著小腳印，走一圈看看'),
      mealsText: swap(environment.mealsText, MEALS_TEXT, '每日餐點符合營養標準，廚房每天現煮，讓孩子吃到食物最原始的味道。'),
      meals: environment.meals.map((meal) => (MEAL_FILLERS.has(meal.text) ? { ...meal, text: '' } : meal)),
      tourText: swap(environment.tourText, '空間配置各校不同。挑一所學校，看看各校的教室、遊戲場與角落。', '空間配置各校不同。'),
      tourHint: swap(environment.tourHint, '挑一所學校，翻開來看')
    },
    admission: admission && { ...admission, intro: swap(admission.intro, '入學流程、新生準備、收退費與分班，整理在同一頁。') }
  }
}

/** 僅替換已知原型原文，不蓋掉園方後來發布的自訂說明；順便拿掉官網已不顯示的舊欄位。 */
export function publicCopy(source: SiteContent): SiteContent {
  const site = withoutRepeatedCopy(withSourceNotes(withoutRetiredFields(source)))
  return {
    ...site,
    siteMeta: { ...site.siteMeta, description: site.siteMeta.description === OLD_DESCRIPTION
      ? '認識高雄常春藤幼兒園義華、明華、崇德、國際與仁武五校，查看校園環境、所在地、聯絡方式與參觀資訊。'
      : site.siteMeta.description },
    // 原型說明在正式站不顯示；頁尾底列遇空字串會整段隱藏，CMS 另填的備註照常顯示。
    footer: { ...site.footer, bottomNote: site.footer.bottomNote === '官網設計提案 · 預約為操作示範，不會送出資料'
      ? '' : site.footer.bottomNote }
  }
}
