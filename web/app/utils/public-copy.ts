import type { SiteContent } from '../types/site-content'

const OLD_DESCRIPTION = '走進常春藤，認識五校的環境與孩子的校園生活。官網設計互動提案。'

// 官網已不顯示、但 fixture 還留著的欄位（後端初始化內容要讀，見 types/site-content.ts
// 開頭說明）。公開輸出前拿掉，頁面資料不帶這些舊文字（例如原型的示範同意文字與常見
// 問題）。2026-10-04 隨後台拿掉這些欄位一起整理；2026-10-05 再加原型預約表單的示範說明、
// 步驟與欄位清單（isDemo／demoNote／steps／fields，官網的預約表單從沒讀過）。
const RETIRED = {
  hero: ['eyebrow'],
  campusBoard: ['note'],
  dayExperience: ['sourceNote'],
  booking: ['consentText', 'bannerTitleTemplate', 'bannerBody', 'bannerButtonLabel', 'isDemo', 'demoNote', 'steps', 'fields'],
  campus: ['intro', 'description', 'fbNote', 'heroPhotoPos', 'faq'],
  tourScene: ['spots', 'spots_reviewed']
} as const

function omit<T extends object>(value: T, keys: readonly string[]): T {
  const copy = { ...value } as Record<string, unknown>
  for (const key of keys) delete copy[key]
  return copy as T
}

/** 拿掉官網已不顯示的舊欄位（不修改傳入的物件）。 */
export function withoutRetiredFields(site: SiteContent): SiteContent {
  return {
    ...site,
    home: { ...site.home, hero: omit(site.home.hero, RETIRED.hero), campusBoard: omit(site.home.campusBoard, RETIRED.campusBoard) },
    dayExperience: omit(site.dayExperience, RETIRED.dayExperience),
    booking: omit(site.booking, RETIRED.booking),
    campuses: site.campuses.map((campus) => ({
      ...omit(campus, RETIRED.campus),
      tourScenes: Array.isArray(campus.tourScenes)
        ? campus.tourScenes.map((scene) => omit(scene, RETIRED.tourScene))
        : campus.tourScenes
    }))
  }
}

/** 僅替換已知原型原文，不蓋掉園方後來發布的自訂說明；順便拿掉官網已不顯示的舊欄位。 */
export function publicCopy(source: SiteContent): SiteContent {
  const site = withoutRetiredFields(source)
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
