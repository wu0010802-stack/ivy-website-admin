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
const SOURCE_NOTES: Readonly<Record<string, string>> = {
  '日常情境提案，以義華校素材呈現；時刻取自官網一日流程，各校、各班實際安排請向園所確認。背景取自義華遊藝表演紀錄，與相片非同一天拍攝。':
    '照片：各校日常；背景影片：義華校遊藝表演。各校、各班作息略有不同，以園所安排為準。',
  '照片取自各校日常，實際課程安排以各校說明為準。': '照片：各校日常。課程安排以各校說明為準。',
  '作品照片取自機構網站「常春藤兒童美術館」。': '作品照片：常春藤兒童美術館。',
  '照片與介紹取自義華校。': '介紹：義華校；照片：義華校與各校活動。',
  '取自義華校教學理念。': '出自義華校教學理念。',
  '照片取自各校日常，空間配置各校略有不同。': '照片：各校日常。空間配置各校略有不同。'
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

/** 僅替換已知原型原文，不蓋掉園方後來發布的自訂說明；順便拿掉官網已不顯示的舊欄位。 */
export function publicCopy(source: SiteContent): SiteContent {
  const site = withSourceNotes(withoutRetiredFields(source))
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
