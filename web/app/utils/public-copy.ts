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

// 孩子的一天大標下的小字：10-30 拿掉的是跟中文重複的英文；2026-11-05 使用者要這行改成英文，反過來只留英文。
// 兩欄都是原文才換；園方改過任一欄就照園方的（只改了中文的話，英文原文仍照 10-30 拿掉）。
const DAY_EYEBROW = { zh: '孩子的一天', en: 'A DAY AT IVY' } as const
function dayEyebrow(day: SiteContent['dayExperience']): Pick<SiteContent['dayExperience'], 'eyebrow' | 'eyebrowEn'> {
  if (day.eyebrow === DAY_EYEBROW.zh && day.eyebrowEn === DAY_EYEBROW.en) return { eyebrow: '', eyebrowEn: DAY_EYEBROW.en }
  return { eyebrow: day.eyebrow, eyebrowEn: swap(day.eyebrowEn, DAY_EYEBROW.en) }
}

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
      ...dayEyebrow(day),
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

// 2026-11-04 TA 檢視（前台給目標家長看的事實）：首頁關於段第一句改成交代身分（高雄五所幼兒園、1997 年創立），
// 一整段約 300 字拆成三段；孩子的一天背面原本六則都回答「參觀時再問」，站上別頁其實已經寫了答案的五則改成事實
// （入學頁新生準備與接送安全、特色教學五件事、常見問題的餐點；下雨天怎麼調整站上沒有資料，照舊）。頁尾校區清單
// 同日加過地址與「各校地址與電話」標題，11-05 使用者嫌太長、退回原版（標題照舊「我們的大家庭」）。後台都能改：原文一字不差才換，園方改過的照園方的；內建內容與後台預設仍是原文。
const ABOUT_BODY = '自 1997 年在高雄創立，常春藤以專業保育與溫暖陪伴，為孩子打造安全、安心的成長環境。近三十年來，我們始終相信，幼兒園不只是上學的地方，更是孩子第一次離開家、認識世界的起點。因此，我們的課程從孩子的興趣與生活出發，讓他們在遊戲、繪本、藝術與戶外觀察中提問、動手嘗試，也在相處中練習合作與關懷；老師細心觀察、適時引導，尊重每個孩子不同的步調，陪伴他們學會照顧自己、理解他人。美語同樣融入每一天，從早晨問候、歌謠繪本到點心時間與遊戲對話，孩子在自然的互動裡聽、說、玩，先喜歡上這個語言，再慢慢累積開口的自信。我們希望每個孩子離開常春藤時，都帶著充滿好奇、值得珍藏的童年，以及面對世界的勇氣。'
// 2026-11-05 使用者給了一份四段約 600 字的新介紹（各校成立年份、全人教育六大領域、美語商店街、教具、中英書籍），
// 先濃縮成三段，使用者再要「再幫我改，不一定要是我們學校真正的特色」：改寫成給家長讀的介紹，不逐條列特色與課綱
// 術語。各校成立年份 /about 沿革已有，這裡只交代五所；不寫查證不到的具體設施或活動，只寫幼兒園日常（課綱六大領域
// 是全國幼兒園共用的架構）。手機只露第一句（身分）。數字和「年」之間用不換行空白（U+00A0），窄欄才不會斷開。
const ABOUT_BODY_FACTS = [
  '民國\u00a086\u00a0年，第一間常春藤在高雄三民區義華路成立；之後有了明華、崇德、國際和仁武，現在是五所幼兒園。近三十年來，孩子換了一屆又一屆，我們想做的事一直沒變：讓孩子喜歡上學。',
  '課程照著幼兒園課綱的六大領域安排，孩子感覺到的卻是每天都在玩：在院子裡追跑、在教室裡動手做、窩在角落讀繪本。老師不急著給答案，會蹲下來聽孩子說，等他自己試出來。',
  '英語也放進每天的生活裡，早上問好、唱英文歌、點心時間聊兩句，先玩熟了再開口。幼兒園是孩子的第一所學校，我們希望這裡也像他的第二個家。'
].join('\n')
const DAY_ANSWERS: Readonly<Record<string, string>> = {
  '參觀時可以與園所聊聊：初次入園的陪伴方式、家長如何與老師聯繫，以及可以事先做哪些準備。':
    '前三天以半天為主，入園時爸爸媽媽可以稍微陪一下；開學前約一週，導師會先打電話了解孩子。',
  '可以詢問該校如何安排探索活動、使用哪些教具與素材，以及如何依照年齡和孩子的興趣調整內容。':
    '常做五件事：靜心、教具操作、美術創作、閱讀和大肌肉時間；教具由老師依孩子的年齡與能力設計。',
  '參觀時可詢問餐點安排、食物過敏或特殊飲食需求的溝通方式，以及老師如何協助孩子練習用餐。':
    '廚房每天現煮早餐、午餐和下午點心，另外每天兩份蔬果；食物過敏或特殊飲食，開學前先告訴導師。',
  '可以向園所了解休息空間與安排，以及孩子尚未習慣午休時，老師會如何陪伴和與家長溝通。':
    '午休請帶自己的棉被和枕頭；孩子還不習慣午睡的話，老師怎麼陪，參觀時可以先聊聊。',
  '可以詢問園所的接送流程、家長與老師的聯繫方式，以及如何了解孩子在校的生活情況。':
    '接孩子時出示接送證；臨時請別人代接，要在對方到園前 30 分鐘打電話告訴老師。'
}

/** 把已經有答案、卻寫成「參觀時再問」或一段形容詞的原文，換成站上查得到的事實（不修改傳入的物件）。 */
export function withTaFacts(site: SiteContent): SiteContent {
  const { home, dayExperience: day } = site
  return {
    ...site,
    home: { ...home, about: { ...home.about, bodyText: swap(home.about.bodyText, ABOUT_BODY, ABOUT_BODY_FACTS) } },
    dayExperience: day && { ...day, moments: day.moments.map((moment) => ({ ...moment, answer: DAY_ANSWERS[moment.answer] ?? moment.answer })) }
  }
}

/** 僅替換已知原型原文，不蓋掉園方後來發布的自訂說明；順便拿掉官網已不顯示的舊欄位。 */
export function publicCopy(source: SiteContent): SiteContent {
  const site = withTaFacts(withoutRepeatedCopy(withSourceNotes(withoutRetiredFields(source))))
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
