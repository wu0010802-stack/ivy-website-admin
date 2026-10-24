import type { AboutPageContent, AdmissionRefund, AdmissionStep, AdmissionPhase, AdmissionUniformDay, AdmissionSubsidy, AdmissionAllowance, CampusTestimonial, CurriculumPageContent, EnvironmentPageContent, HomeFilm, NewsArticle, NewsBlock, NewsEvent, PageSeoEntry, PageSeoKey, PagePhoto, SiteContent, SocialLink, SocialPlatform, TourScene } from '~/types/site-content'
import { newsMonth, safeWebUrl } from './news-content'
import { assertCounts, assertItems, assertStrings, PAGE_COUNTS } from './page-content'
import { privacyNotice } from './privacy-notice'
import { anniversaryEnabled, isAnniversaryHref, PAGE_SEO_KEYS } from './seo'
import { httpsUrl, siteLink } from './site-links'
import { youtubeId, youtubeThumb } from './filmCarousel'
import {
  focusPosition, isMediaId, mediaImage, slotImage, slotPosition, slotVideoSrc, videoPosterUrl,
  type LiveFocusPoint, type LiveMediaSlot, type MediaImage, type MediaInfoMap
} from './media-image'

// 素材版位都是 2026-09-25 新增的選填欄位：舊版本沒有、或值是 null＝沿用官網內建素材。

export interface LiveHomeAbout {
  title: string
  since_label: string
  body_text: string
  caption: string
  photo?: LiveMediaSlot | null
  photo_alt?: string
}

export interface LiveHomeHero {
  copy_lines: string[]
  /** 2026-09-23 拿掉首屏按鈕：舊版本才有，官網不讀 */
  cta_label?: string
  video_desktop?: LiveMediaSlot | null
  video_mobile?: LiveMediaSlot | null
  poster?: LiveMediaSlot | null
  poster_alt?: string
  fallback_image?: LiveMediaSlot | null
}

export interface LiveSiteLink {
  label: string
  href: string
}

export interface LiveNavLink extends LiveSiteLink {
  label_en?: string
}

export interface LiveSiteFooter {
  tagline: string
  copyright: string
  bottom_note: string
  campus_list_label: string
  /** 2026-09-25 新增；沒有（或 null）＝沿用內建頁尾連結 */
  links?: LiveSiteLink[] | null
}

export interface LiveSiteMeta {
  title: string
  description: string
  header_phone_number: string
  header_phone_note: string
  // 2026-09-24 新增，舊的已發布版本沒有這些欄位。
  share_image?: string
  share_image_alt?: string
  // 2026-10-12 起沒有 admission_title／admission_description：後端公開輸出已把舊值補進 page_seo.admission 再剔除，官網不讀。
  allow_indexing?: boolean
  /** 2026-10-24 新增；沒有＝開（舊版本照常有 30 週年） */
  anniversary_enabled?: boolean
  /** 2026-09-25 新增；沒有（或 null）＝沿用內建主選單 */
  primary_nav?: LiveNavLink[] | null
  /** 2026-10-12 新增；沒有（或 null）＝七頁全部沿用內建標題、描述與全站分享圖 */
  page_seo?: LivePageSeo | null
  /** 2026-10-12 新增；沒有（或 null）＝沿用內建機構社群；空陣列＝不顯示 */
  social_links?: LiveSocialLink[] | null
}

export interface LivePageSeoEntry {
  title?: string
  description?: string
  share_image?: string
  share_image_alt?: string
}
export type LivePageSeo = Partial<Record<PageSeoKey, LivePageSeoEntry>>

export interface LiveSocialLink {
  platform: SocialPlatform
  label: string
  url: string
}

export interface LiveHomeCampusBoard {
  section_title: string
  eyebrow: string
  /** 2026-09-25 新增：首頁五校順序與預設顯示的校區 */
  campus_order?: string[]
  default_campus?: string
}

export interface LiveBookingContent {
  cta_label: string
  cta_label_en: string
  // 2026-09-25 新增，舊的已發布版本沒有這兩個欄位。
  privacy_title?: string
  privacy_sections?: { heading: string; body: string }[]
}

export interface LiveDayMoment {
  key: string
  time: string
  label: string
  caption: string
  title: string
  story: string
  question: string
  answer: string
  photo?: LiveMediaSlot | null
  alt?: string
  tint?: string | null
}

export interface LiveDayExperience {
  eyebrow: string
  eyebrow_en: string
  note: string
  moments: LiveDayMoment[]
  film_desktop?: LiveMediaSlot | null
  film_mobile?: LiveMediaSlot | null
  film_poster?: LiveMediaSlot | null
  film_caption_zh?: string | null
  film_caption_en?: string | null
}

/** 全站消息的適用範圍；2026-09-25 以前發布的版本只有手打的 campus 文字。 */
export interface LiveNewsScope {
  scope?: 'global' | 'campus'
  campus_keys?: string[]
  campus?: string
}

export interface LiveNewsArticle extends LiveNewsScope {
  id: string
  date: string
  category: string
  title: string
  description: string
  body?: NewsBlock[]
  featured?: boolean
  image: string
  alt: string
}

export interface LiveNewsEvent extends LiveNewsScope {
  id: string
  date: string
  title: string
  description: string
  all_day?: boolean
  start_time?: string | null
  end_time?: string | null
  location?: string
  link_url?: string
  link_label?: string
}

export interface LiveHomeFilm {
  id: string
  title: string
  source: 'file' | 'youtube'
  video?: LiveMediaSlot | null
  start?: number
  end?: number | null
  poster?: LiveMediaSlot | null
  youtube_url?: string
}

export interface LiveHomeNews {
  sample_note: string
  articles: LiveNewsArticle[]
  events: LiveNewsEvent[]
  home_display_count?: number | null
  /** 首頁手機版活動影片；沒有（或 null）＝沿用內建清單 */
  films?: LiveHomeFilm[] | null
}

/** 各校自己的消息與活動：屬於那一校，沒有適用範圍與首頁推薦。 */
export interface LiveCampusNews {
  articles: LiveNewsArticle[]
  events: LiveNewsEvent[]
}

export interface LivePrivacyPolicy {
  title: string
  updated_on?: string | null
  sections: { heading: string; body: string }[]
}

export interface LivePagePhoto {
  photo?: LiveMediaSlot | null
  photo_alt?: string
}

/** 後端 content/page_schemas.py 的 CurriculumPagePayload */
export interface LiveCurriculumPage {
  hero_eyebrow: string
  hero_title: string
  hero_highlight?: string
  hero_lede: string
  hero_notice: string
  hero_photo?: LiveMediaSlot | null
  hero_photo_alt?: string
  chapters: { label: string; hint: string }[]
  years_title: string
  years_text: string
  spiral_label: string
  spiral_text: string
  years_photo?: LiveMediaSlot | null
  years_photo_alt?: string
  years_caption: string
  years: { motto: string; text: string }[]
  directions_title: string
  directions_text: string
  directions: ({ key: string; title: string; sub: string; text: string } & LivePagePhoto)[]
  gallery_title: string
  gallery_text: string
  gallery_source: string
  gallery: ({ label: string } & LivePagePhoto)[]
  daily_title: string
  daily_text: string
  daily_source: string
  daily: ({ title: string; text: string } & LivePagePhoto)[]
  belief_title: string
  beliefs: string[]
  belief_close: string
  belief_source: string
}

/** 後端 content/page_schemas.py 的 AboutPagePayload */
export interface LiveAboutPage {
  hero_title: string
  hero_lede: string
  hero_caption: string
  hero_photo?: LiveMediaSlot | null
  hero_photo_alt?: string
  hero_back_photo?: LiveMediaSlot | null
  hero_back_photo_alt?: string
  chapter_names: string[]
  story_title: string
  story_text: string
  milestones: { key: string; year: number; text: string }[]
  whole_title: string
  whole_text: string
  whole_fine: string
  whole_fine_source: string
  hope_title: string
  hope_quotes: string[]
  hope_photo?: LiveMediaSlot | null
  hope_photo_alt?: string
  outro_title: string
  outro_text: string
}

/** 後端 content/page_schemas.py 的 EnvironmentPagePayload */
export interface LiveEnvironmentPage {
  hero_title: string
  hero_highlight?: string
  hero_lede: string
  hero_notice: string
  hero_photo?: LiveMediaSlot | null
  hero_photo_alt?: string
  hero_caption: string
  chapter_names: string[]
  care_title: string
  care_lead: string
  hearts: string[]
  care_text: string
  care_photo?: LiveMediaSlot | null
  care_photo_alt?: string
  care_caption: string
  care_photo_note: string
  care_items: ({ title: string; text: string } & LivePagePhoto)[]
  spaces_title: string
  spaces_text: string
  feature: { tag: string; title: string; text: string; note: string } & LivePagePhoto
  trail_hint: string
  spaces: ({ title: string; text: string; note: string; campus_label?: string } & LivePagePhoto)[]
  meals_title: string
  meals_text: string
  meals_day_title: string
  meals: { time: string; name: string; note: string; text: string }[]
  tour_title: string
  tour_text: string
  tour_hint: string
}

export interface LiveAdmissionContent {
  notice: string
  intro: string
  steps: AdmissionStep[]
  phases: AdmissionPhase[]
  uniform_week: AdmissionUniformDay[]
  uniform_note: string
  pickup_notes: string[]
  registration_notes: string[]
  fee_intro: string
  subsidies: AdmissionSubsidy[]
  allowance_title: string
  allowance: AdmissionAllowance[]
  allowance_note: string
  refunds: AdmissionRefund[]
}

export interface LiveCampusProfile {
  name: string
  district: string
  address: string
  phone: string
  facebook: string
  line: string
  /** 2026-09-25 新增：Google 地圖網址，空字串＝用地址搜尋 */
  map_url?: string
  cover?: LiveMediaSlot | null
  /** 首頁五校卡片與預約頁的校區照片 */
  card_focus?: LiveFocusPoint | null
  line_art?: LiveMediaSlot | null
  line_art_colour?: LiveMediaSlot | null
  /** 2026-09-25 新增；之前存的版本沒有這兩欄。 */
  instagram?: string
  youtube?: string
  /** 2026-10-12 新增：關於頁家長分享影片。陣列＝整組取代（[]＝這校不放）；沒有（或 null）＝沿用內建清單 */
  testimonials?: LiveTestimonial[] | null
}

export interface LiveTestimonial {
  /** YouTube 網址或 11 碼影片 ID；官網只取 ID */
  youtube_url: string
  quote: string
  speaker: string
  /** 空＝內建同一支影片的封面，再沒有就用 YouTube 縮圖 */
  poster?: LiveMediaSlot | null
  poster_alt?: string
}

export interface LiveTourScene {
  key: string
  name: string
  image: string
  intro: string
}

export interface LiveCampusTour {
  scenes: LiveTourScene[]
}

export interface ContentOverlay {
  home_about?: LiveHomeAbout | null
  home_hero?: LiveHomeHero | null
  site_footer?: LiveSiteFooter | null
  site_meta?: LiveSiteMeta | null
  home_campus_board?: LiveHomeCampusBoard | null
  booking_content?: LiveBookingContent | null
  day_experience?: LiveDayExperience | null
  home_news?: LiveHomeNews | null
  admission_content?: LiveAdmissionContent | null
  privacy_policy?: LivePrivacyPolicy | null
  curriculum_page?: LiveCurriculumPage | null
  about_page?: LiveAboutPage | null
  environment_page?: LiveEnvironmentPage | null
  // 以下每校各一份，key 是 campus_key（見後端 get_public_content /
  // useDraftPreview 對應處理，跟其餘扁平 kind 的形狀不同）。
  campus_profile?: Record<string, LiveCampusProfile> | null
  campus_tour?: Record<string, LiveCampusTour> | null
  campus_news?: Record<string, LiveCampusNews> | null
}

/** 適用範圍 → 顯示用的校區文字與 key；舊版本沿用當時手打的文字。 */
function newsScope(entry: LiveNewsScope, names: Record<string, string>): { campus: string; campusKeys: string[] } {
  if (entry.scope === 'campus' && entry.campus_keys?.length) {
    return { campus: entry.campus_keys.map((key) => names[key] ?? key).join('、'), campusKeys: [...entry.campus_keys] }
  }
  if (entry.scope === 'global') return { campus: '全校', campusKeys: [] }
  return { campus: entry.campus || '全校', campusKeys: [] }
}

/**
 * 舊的圖片欄位（消息封面、內文圖片、校園探索場景）存的是素材 id 字串，沒有
 * 版位焦點；有素材資訊時補上 srcset 與素材預設焦點（fixture 代號不處理）。
 */
function legacyImage(image: string, media: MediaInfoMap): MediaImage | undefined {
  if (!isMediaId(image) || !media[image]) return undefined
  const info = media[image]
  return mediaImage(image, info, slotPosition({ media_id: image }, info))
}

function newsArticle(a: LiveNewsArticle, where: { campus: string; campusKeys: string[] }, media: MediaInfoMap, id = a.id): NewsArticle {
  const imageMedia = legacyImage(a.image, media)
  return {
    id,
    date: a.date,
    ...where,
    category: a.category,
    title: a.title,
    description: a.description,
    body: (a.body ?? []).map((block) => {
      if (block.type !== 'image') return { ...block } as NewsBlock
      const blockMedia = legacyImage(block.image, media)
      return (blockMedia ? { ...block, imageMedia: blockMedia } : { ...block }) as NewsBlock
    }),
    featured: Boolean(a.featured),
    image: a.image,
    alt: a.alt,
    ...(imageMedia ? { imageMedia } : {})
  }
}

/** 後台的活動影片清單 → 官網輪播用的格式；缺素材的那支略過。 */
export function homeFilms(films: LiveHomeFilm[], media: MediaInfoMap): HomeFilm[] {
  const out: HomeFilm[] = []
  for (const film of films) {
    const posterImage = slotImage(film.poster, media)
    if (film.source === 'youtube') {
      const id = youtubeId(film.youtube_url ?? '')
      if (!id) continue
      out.push({ id: film.id, title: film.title, type: 'youtube', youtubeId: id, poster: posterImage?.src ?? youtubeThumb(id) })
      continue
    }
    // 活動影片只在手機輪播（HomeFilms.vue），用手機版。
    const src = slotVideoSrc(film.video, media, 'mobile')
    if (!src || !film.video) continue
    out.push({
      id: film.id,
      title: film.title,
      type: 'file',
      src,
      start: film.start ?? 0,
      end: film.end ?? null,
      poster: posterImage?.src ?? videoPosterUrl(film.video.media_id, media[film.video.media_id])
    })
  }
  return out
}

/**
 * 後台的家長分享影片 → 官網用的格式（整組取代該校的內建清單）。封面依序：後台選的素材、
 * 內建清單裡同一支影片的封面（id 不分大小寫）、YouTube 縮圖。看不懂的影片網址整支略過。
 */
export function campusTestimonials(items: LiveTestimonial[], builtinPosters: Map<string, string>, media: MediaInfoMap): CampusTestimonial[] {
  const out: CampusTestimonial[] = []
  for (const item of items) {
    const id = youtubeId(typeof item.youtube_url === 'string' ? item.youtube_url : '')
    if (!id || typeof item.quote !== 'string' || typeof item.speaker !== 'string') continue
    const posterImage = slotImage(item.poster, media)
    // 說明：後台填的優先，沒填用素材庫的；都沒有就不帶（元件當裝飾圖）
    const alt = item.poster_alt || posterImage?.alt || ''
    out.push({
      youtubeId: id,
      quote: item.quote,
      speaker: item.speaker,
      poster: posterImage?.src ?? builtinPosters.get(id.toLowerCase()) ?? youtubeThumb(id),
      ...(posterImage ? { posterMedia: posterImage } : {}),
      ...(alt ? { posterAlt: alt } : {})
    })
  }
  return out
}

function newsEvent(e: LiveNewsEvent, where: { campus: string; campusKeys: string[] }, id = e.id): NewsEvent {
  return {
    id,
    date: e.date,
    month: newsMonth(e.date),
    ...where,
    title: e.title,
    description: e.description,
    allDay: e.all_day ?? true,
    startTime: e.start_time ?? null,
    endTime: e.end_time ?? null,
    location: e.location ?? '',
    linkUrl: e.link_url ?? '',
    linkLabel: e.link_label ?? ''
  }
}

/**
 * 把後端已接上 CMS 的欄位疊到 fixture 內容上，兩邊都不修改傳入的物件
 * （回傳新物件），也不假設 overlay 一定齊全——缺哪個 kind、或某校缺某
 * 個 kind，就保留 fixture 原文，不讓公開頁面因為某項還沒發布過就壞掉。
 *
 * `usePublishedSite`（讀已發布內容）跟 `useDraftPreview`（讀最新未發布
 * revision）共用這個函式，差別只在 overlay 資料是從哪支 API 拿的。
 *
 * 素材版位（首屏影片與照片、關於照片、孩子的一天、分校封面與線稿、活動
 * 影片）後台有設才換，沒設就維持 fixture 的內建素材，輸出與沒有這些欄位時
 * 完全相同。`media` 是公開 API 給的素材資訊（尺寸、衍生檔、預設焦點）。
 * 仍在 fixture 的：品牌名稱與 Logo（2026-09-19 核可鎖定）。
 */
/**
 * 每一種內容各自套用：某一種 payload 形狀不符（舊版 schema、欄位改名漏寫相容碼）
 * 只讓那一區退回內建內容並記錄，不能讓整份內容丟例外、全站 503。
 */
function guard(kind: string, apply: () => void): void {
  try {
    apply()
  } catch (error) {
    console.error(`[content-overlay] ${kind} 的內容格式不符，這一區改用內建內容`, error)
  }
}

/** 整頁內容的照片版位 → 官網用的照片與說明；沒選（或 id 無效）就不帶，元件用內建圖。 */
function pagePhoto(slot: LiveMediaSlot | null | undefined, alt: string | undefined, media: MediaInfoMap): PagePhoto {
  const photo = slotImage(slot, media)
  return photo ? { photo, photoAlt: alt || photo.alt } : {}
}

function curriculumPage(c: LiveCurriculumPage, media: MediaInfoMap): CurriculumPageContent {
  assertCounts({ chapters: c.chapters, years: c.years, directions: c.directions, gallery: c.gallery, daily: c.daily, beliefs: c.beliefs }, PAGE_COUNTS.curriculum)
  assertStrings(c, ['hero_eyebrow', 'hero_title', 'hero_lede', 'hero_notice', 'years_title', 'years_text', 'spiral_label', 'spiral_text', 'years_caption', 'directions_title', 'directions_text', 'gallery_title', 'gallery_text', 'gallery_source', 'daily_title', 'daily_text', 'daily_source', 'belief_title', 'belief_close', 'belief_source'], 'curriculum_page')
  assertItems(c.chapters, ['label', 'hint'], 'chapters')
  assertItems(c.years, ['motto', 'text'], 'years')
  assertItems(c.directions, ['key', 'title', 'sub', 'text'], 'directions')
  assertItems(c.gallery, ['label'], 'gallery')
  assertItems(c.daily, ['title', 'text'], 'daily')
  c.beliefs.forEach((b, i) => { if (typeof b !== 'string') throw new Error(`beliefs[${i}] 應為字串`) })
  const hero = pagePhoto(c.hero_photo, c.hero_photo_alt, media)
  const yearsPhoto = pagePhoto(c.years_photo, c.years_photo_alt, media)
  return {
    heroEyebrow: c.hero_eyebrow,
    heroTitle: c.hero_title,
    heroHighlight: c.hero_highlight ?? '',
    heroLede: c.hero_lede,
    heroNotice: c.hero_notice,
    heroPhoto: hero.photo,
    heroPhotoAlt: hero.photoAlt,
    chapters: c.chapters.map((x) => ({ label: x.label, hint: x.hint })),
    yearsTitle: c.years_title,
    yearsText: c.years_text,
    spiralLabel: c.spiral_label,
    spiralText: c.spiral_text,
    yearsPhoto: yearsPhoto.photo,
    yearsPhotoAlt: yearsPhoto.photoAlt,
    yearsCaption: c.years_caption,
    years: c.years.map((x) => ({ motto: x.motto, text: x.text })),
    directionsTitle: c.directions_title,
    directionsText: c.directions_text,
    directions: c.directions.map((x) => ({ key: x.key, title: x.title, sub: x.sub, text: x.text, ...pagePhoto(x.photo, x.photo_alt, media) })),
    galleryTitle: c.gallery_title,
    galleryText: c.gallery_text,
    gallerySource: c.gallery_source,
    gallery: c.gallery.map((x) => ({ label: x.label, ...pagePhoto(x.photo, x.photo_alt, media) })),
    dailyTitle: c.daily_title,
    dailyText: c.daily_text,
    dailySource: c.daily_source,
    daily: c.daily.map((x) => ({ title: x.title, text: x.text, ...pagePhoto(x.photo, x.photo_alt, media) })),
    beliefTitle: c.belief_title,
    beliefs: [...c.beliefs],
    beliefClose: c.belief_close,
    beliefSource: c.belief_source
  }
}

function aboutPage(a: LiveAboutPage, media: MediaInfoMap): AboutPageContent {
  assertCounts({ chapterNames: a.chapter_names, milestones: a.milestones, hopeQuotes: a.hope_quotes }, PAGE_COUNTS.about)
  assertStrings(a, ['hero_title', 'hero_lede', 'hero_caption', 'story_title', 'story_text', 'whole_title', 'whole_text', 'whole_fine', 'whole_fine_source', 'hope_title', 'outro_title', 'outro_text'], 'about_page')
  assertItems(a.milestones, ['key', 'text'], 'milestones')
  a.milestones.forEach((m, i) => { if (!Number.isInteger(m.year)) throw new Error(`milestones[${i}].year 應為整數`) })
  a.chapter_names.forEach((x, i) => { if (typeof x !== 'string') throw new Error(`chapter_names[${i}] 應為字串`) })
  a.hope_quotes.forEach((x, i) => { if (typeof x !== 'string') throw new Error(`hope_quotes[${i}] 應為字串`) })
  const hero = pagePhoto(a.hero_photo, a.hero_photo_alt, media)
  const back = pagePhoto(a.hero_back_photo, a.hero_back_photo_alt, media)
  const hope = pagePhoto(a.hope_photo, a.hope_photo_alt, media)
  return {
    heroTitle: a.hero_title,
    heroLede: a.hero_lede,
    heroCaption: a.hero_caption,
    heroPhoto: hero.photo,
    heroPhotoAlt: hero.photoAlt,
    heroBackPhoto: back.photo,
    heroBackPhotoAlt: back.photoAlt,
    chapterNames: [...a.chapter_names],
    storyTitle: a.story_title,
    storyText: a.story_text,
    milestones: a.milestones.map((m) => ({ key: m.key, year: m.year, text: m.text })),
    wholeTitle: a.whole_title,
    wholeText: a.whole_text,
    wholeFine: a.whole_fine,
    wholeFineSource: a.whole_fine_source,
    hopeTitle: a.hope_title,
    hopeQuotes: [...a.hope_quotes],
    hopePhoto: hope.photo,
    hopePhotoAlt: hope.photoAlt,
    outroTitle: a.outro_title,
    outroText: a.outro_text
  }
}

function environmentPage(e: LiveEnvironmentPage, media: MediaInfoMap): EnvironmentPageContent {
  assertCounts({ chapterNames: e.chapter_names, hearts: e.hearts, careItems: e.care_items, spaces: e.spaces, meals: e.meals }, PAGE_COUNTS.environment)
  assertStrings(e, ['hero_title', 'hero_lede', 'hero_notice', 'hero_caption', 'care_title', 'care_lead', 'care_text', 'care_caption', 'care_photo_note', 'spaces_title', 'spaces_text', 'trail_hint', 'meals_title', 'meals_text', 'meals_day_title', 'tour_title', 'tour_text', 'tour_hint'], 'environment_page')
  assertStrings(e.feature, ['tag', 'title', 'text', 'note'], 'feature')
  assertItems(e.care_items, ['title', 'text'], 'care_items')
  assertItems(e.spaces, ['title', 'text', 'note'], 'spaces')
  assertItems(e.meals, ['time', 'name', 'note', 'text'], 'meals')
  e.chapter_names.forEach((x, i) => { if (typeof x !== 'string') throw new Error(`chapter_names[${i}] 應為字串`) })
  e.hearts.forEach((x, i) => { if (typeof x !== 'string') throw new Error(`hearts[${i}] 應為字串`) })
  // 餐點時間的格式（HH:MM）與先後（由早到晚）由後端擋存檔（page_schemas.EnvironmentMeal），官網這層只檢查項目數與型別。
  // 即時預覽打字打到一半（空字串、「8:3」、暫時倒序）時不要整份退回內建；太陽弧位置照序號固定，時間只是文字，不會破版。
  const hero = pagePhoto(e.hero_photo, e.hero_photo_alt, media)
  const care = pagePhoto(e.care_photo, e.care_photo_alt, media)
  return {
    heroTitle: e.hero_title,
    heroHighlight: typeof e.hero_highlight === 'string' ? e.hero_highlight : '',
    heroLede: e.hero_lede,
    heroNotice: e.hero_notice,
    heroPhoto: hero.photo,
    heroPhotoAlt: hero.photoAlt,
    heroCaption: e.hero_caption,
    chapterNames: [...e.chapter_names],
    careTitle: e.care_title,
    careLead: e.care_lead,
    hearts: [...e.hearts],
    careText: e.care_text,
    carePhoto: care.photo,
    carePhotoAlt: care.photoAlt,
    careCaption: e.care_caption,
    carePhotoNote: e.care_photo_note,
    careItems: e.care_items.map((x) => ({ title: x.title, text: x.text, ...pagePhoto(x.photo, x.photo_alt, media) })),
    spacesTitle: e.spaces_title,
    spacesText: e.spaces_text,
    feature: { tag: e.feature.tag, title: e.feature.title, text: e.feature.text, note: e.feature.note, ...pagePhoto(e.feature.photo, e.feature.photo_alt, media) },
    trailHint: e.trail_hint,
    spaces: e.spaces.map((x) => ({ title: x.title, text: x.text, note: x.note, campusLabel: typeof x.campus_label === 'string' ? x.campus_label : '', ...pagePhoto(x.photo, x.photo_alt, media) })),
    mealsTitle: e.meals_title,
    mealsText: e.meals_text,
    mealsDayTitle: e.meals_day_title,
    meals: e.meals.map((x) => ({ time: x.time, name: x.name, note: x.note, text: x.text })),
    tourTitle: e.tour_title,
    tourText: e.tour_text,
    tourHint: e.tour_hint
  }
}

const PAGE_SEO_FIELDS = [
  ['title', 'title'], ['description', 'description'], ['share_image', 'shareImage'], ['share_image_alt', 'shareImageAlt']
] as const
const SOCIAL_PLATFORMS: readonly string[] = ['facebook', 'line', 'instagram', 'youtube']

/** 各頁搜尋設定 snake_case → camelCase：只收七個已知頁面、字串欄位；空字串視為沒設定，整頁都空就不留。 */
function livePageSeo(value: unknown): Partial<Record<PageSeoKey, PageSeoEntry>> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const result: Partial<Record<PageSeoKey, PageSeoEntry>> = {}
  for (const key of PAGE_SEO_KEYS) {
    const raw = Object.prototype.hasOwnProperty.call(value, key) ? (value as Record<string, unknown>)[key] : undefined
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
    const entry: PageSeoEntry = {}
    for (const [from, to] of PAGE_SEO_FIELDS) {
      const text = (raw as Record<string, unknown>)[from]
      if (typeof text === 'string' && text.trim()) entry[to] = text.trim()
    }
    if (Object.keys(entry).length) result[key] = entry
  }
  return Object.keys(result).length ? result : undefined
}

/** 機構社群：平台在四種內、文字非空、網址通過 httpsUrl 才留；網址存驗證過（去空白）的值。 */
function liveSocialLinks(links: readonly unknown[]): SocialLink[] {
  return links.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const { platform, label, url } = item as Record<string, unknown>
    const href = typeof url === 'string' ? httpsUrl(url) : undefined
    if (typeof platform !== 'string' || !SOCIAL_PLATFORMS.includes(platform)) return []
    if (typeof label !== 'string' || !label.trim() || !href) return []
    return [{ platform: platform as SocialPlatform, label: label.trim(), url: href }]
  })
}

export function applyContentOverlay(content: SiteContent, overlay: ContentOverlay, media: MediaInfoMap = {}): SiteContent {
  const next: SiteContent = {
    ...content,
    home: { ...content.home, hero: { ...content.home.hero }, about: { ...content.home.about }, campusBoard: { ...content.home.campusBoard } },
    footer: { ...content.footer },
    siteMeta: { ...content.siteMeta },
    booking: { ...content.booking },
    dayExperience: { ...content.dayExperience },
    campuses: content.campuses.map((c) => ({ ...c }))
  }

  guard('home_about', () => {
    if (overlay.home_about) {
      const about = overlay.home_about
      next.home.about = {
        ...next.home.about,
        title: about.title,
        sinceLabel: about.since_label,
        bodyText: about.body_text,
        caption: about.caption
      }
      const photo = slotImage(about.photo, media)
      if (photo) {
        const [first, ...rest] = next.home.about.photos
        next.home.about.photos = [
          { image: '', role: first?.role ?? 'portrait', alt: about.photo_alt || photo.alt, media: photo },
          ...rest
        ]
      }
    }
  })

  guard('home_hero', () => {
    if (overlay.home_hero) {
      const hero = overlay.home_hero
      next.home.hero = {
        ...next.home.hero,
        copyLines: hero.copy_lines
      }
      const poster = slotImage(hero.poster, media)
      if (poster) {
        next.home.hero.heroImageMedia = poster
        next.home.hero.heroImageAlt = hero.poster_alt || poster.alt
      }
      const fallback = slotImage(hero.fallback_image, media)
      if (fallback) next.home.hero.heroFallbackMedia = { ...fallback, alt: fallback.alt || next.home.hero.heroImageAlt }
      const desktop = slotVideoSrc(hero.video_desktop, media, 'desktop')
      const mobile = slotVideoSrc(hero.video_mobile, media, 'mobile')
      if (desktop && hero.video_desktop) {
        next.home.hero.heroVideoSrc = desktop
        next.home.hero.heroVideoPosition = slotPosition(hero.video_desktop, media[hero.video_desktop.media_id])
      }
      // 手機沒設就用桌機那支（規格 L141 允許沿用同一支影片）。
      const mobileSlot = mobile ? hero.video_mobile : desktop ? hero.video_desktop : null
      if (mobileSlot) {
        next.home.hero.heroVideoSrcMobile = slotVideoSrc(mobileSlot, media, 'mobile')
        next.home.hero.heroVideoPositionMobile = slotPosition(mobileSlot, media[mobileSlot.media_id])
      }
    }
  })

  guard('site_footer', () => {
    if (overlay.site_footer) {
      next.footer = {
        ...next.footer,
        tagline: overlay.site_footer.tagline,
        copyright: overlay.site_footer.copyright,
        bottomNote: overlay.site_footer.bottom_note,
        campusListLabel: overlay.site_footer.campus_list_label
      }
      if (Array.isArray(overlay.site_footer.links)) {
        next.footer.links = overlay.site_footer.links
          .filter((link) => link.label?.trim() && siteLink(link.href))
          .map((link) => ({ label: link.label, href: link.href.trim() }))
      }
    }
  })

  guard('site_meta', () => {
    if (overlay.site_meta) {
      next.siteMeta = {
        ...next.siteMeta,
        title: overlay.site_meta.title,
        description: overlay.site_meta.description,
        headerPhone: {
          ...next.siteMeta.headerPhone,
          number: overlay.site_meta.header_phone_number,
          note: overlay.site_meta.header_phone_note
        },
        shareImage: overlay.site_meta.share_image || undefined,
        shareImageAlt: overlay.site_meta.share_image_alt || undefined,
        pageSeo: livePageSeo(overlay.site_meta.page_seo),
        allowIndexing: overlay.site_meta.allow_indexing ?? true
      }
      // 只在關閉時寫：開著（含舊版本沒有這個欄位）的輸出跟加開關之前逐欄相同。
      if (overlay.site_meta.anniversary_enabled === false) next.siteMeta.anniversaryEnabled = false
      // 機構社群：後台設定過就整組取代內建（過濾後可能是空的＝不顯示）；null／沒有這個鍵＝沿用內建。
      if (Array.isArray(overlay.site_meta.social_links)) next.siteMeta.socialLinks = liveSocialLinks(overlay.site_meta.social_links)
      const nav = (overlay.site_meta.primary_nav ?? [])
        .filter((item) => item.label?.trim() && siteLink(item.href))
        .map((item) => ({ label: item.label, labelEn: item.label_en ?? '', href: item.href.trim() }))
      // 選單至少要有一項：後台存的是空的（或全部無效）就沿用內建選單。
      if (nav.length) next.siteMeta.primaryNav = nav
    }
  })

  guard('home_campus_board', () => {
    if (overlay.home_campus_board) {
      const board = overlay.home_campus_board
      next.home.campusBoard = {
        ...next.home.campusBoard,
        sectionTitle: board.section_title,
        eyebrow: board.eyebrow
      }
      // 順序要剛好是現有校區的排列（後端已驗證五校不重複不缺漏）；對不上就沿用內建順序。
      const order = board.campus_order ?? []
      const known = content.home.campusBoard.campusOrder
      if (order.length === known.length && new Set(order).size === order.length && order.every((key) => known.includes(key))) {
        next.home.campusBoard.campusOrder = [...order]
      }
      if (board.default_campus && known.includes(board.default_campus)) {
        next.home.campusBoard.defaultCampus = board.default_campus
      }
    }
  })

  guard('booking_content', () => {
    if (overlay.booking_content) {
      const booking = overlay.booking_content
      next.booking = {
        ...next.booking,
        ctaLabel: booking.cta_label,
        ctaLabelEn: booking.cta_label_en,
        privacyNotice: privacyNotice(booking.privacy_title, booking.privacy_sections)
      }
    }
  })

  guard('day_experience', () => {
    if (overlay.day_experience) {
      const day = overlay.day_experience
      // 卡片清單以後台為準：張數、順序、刪卡都照發布的內容。照片、色調與 alt
      // 後台有設就用後台的；沒設的依 key 對回官網內建的同一張卡；後台新增、
      // 內建沒有的卡片沒有照片，色調沿用同位置內建卡的節奏，DayMomentCard 顯示
      // 無照片的相紙樣式。
      const builtin = next.dayExperience.moments
      const byKey = new Map(builtin.map((m) => [m.key, m]))
      next.dayExperience = {
        ...next.dayExperience,
        eyebrow: day.eyebrow,
        eyebrowEn: day.eyebrow_en,
        note: day.note,
        moments: day.moments.map((m, i) => {
          const original = byKey.get(m.key)
          const builtinMedia = original
            ? { tint: original.tint, photo: original.photo, alt: original.alt }
            : { tint: builtin.length ? builtin[i % builtin.length]!.tint : '', photo: '', alt: '' }
          const photo = slotImage(m.photo, media)
          const tint = m.tint || builtinMedia.tint
          return {
            ...(photo ? { tint, photo: '', alt: m.alt || photo.alt, photoMedia: photo } : { ...builtinMedia, tint, alt: m.alt || builtinMedia.alt }),
            key: m.key,
            time: m.time,
            label: m.label,
            caption: m.caption,
            title: m.title,
            story: m.story,
            question: m.question,
            answer: m.answer
          }
        })
      }
      const desktop = slotVideoSrc(day.film_desktop, media, 'desktop')
      const mobile = slotVideoSrc(day.film_mobile, media, 'mobile')
      if (desktop && day.film_desktop) {
        next.dayExperience.filmSrc = desktop
        next.dayExperience.filmPosition = slotPosition(day.film_desktop, media[day.film_desktop.media_id])
      }
      const mobileSlot = mobile ? day.film_mobile : desktop ? day.film_desktop : null
      if (mobileSlot) {
        next.dayExperience.filmSrcMobile = slotVideoSrc(mobileSlot, media, 'mobile')!
        next.dayExperience.filmPositionMobile = slotPosition(mobileSlot, media[mobileSlot.media_id])
      }
      const poster = slotImage(day.film_poster, media)
      if (poster) next.dayExperience.filmPosterMedia = poster
      if (day.film_caption_zh != null || day.film_caption_en != null) {
        next.dayExperience.filmCaption = {
          zh: day.film_caption_zh ?? next.dayExperience.filmCaption.zh,
          en: day.film_caption_en ?? next.dayExperience.filmCaption.en
        }
      }
    }
  })

  guard('admission_content', () => {
    if (overlay.admission_content) {
      // 整組取代：後台一次送出完整內容；巢狀欄位名稱兩邊相同，只有頂層要轉 camelCase。
      const a = overlay.admission_content
      next.admission = {
        notice: a.notice,
        intro: a.intro,
        steps: a.steps.map((x) => ({ ...x })),
        phases: a.phases.map((x) => ({ ...x, items: [...x.items], tips: [...x.tips] })),
        uniformWeek: a.uniform_week.map((x) => ({ ...x })),
        uniformNote: a.uniform_note,
        pickupNotes: [...a.pickup_notes],
        registrationNotes: [...a.registration_notes],
        feeIntro: a.fee_intro,
        subsidies: a.subsidies.map((x) => ({ ...x })),
        allowanceTitle: a.allowance_title,
        allowance: a.allowance.map((x) => ({ ...x })),
        allowanceNote: a.allowance_note,
        refunds: a.refunds.map((r) => ({ ...r, groups: r.groups.map((g) => ({ ...g, lines: [...g.lines] })) }))
      }
    }
  })

  guard('privacy_policy', () => {
    if (overlay.privacy_policy) {
      const policy = overlay.privacy_policy
      next.privacyPolicy = {
        title: policy.title,
        updatedOn: policy.updated_on ?? '',
        sections: policy.sections.map((section) => ({ heading: section.heading, body: section.body }))
      }
    }
  })

  guard('curriculum_page', () => {
    // 整份取代；項目數不符（舊版或壞資料）時 assertCounts 丟錯，guard 退回內建內容。
    if (overlay.curriculum_page) next.curriculumPage = curriculumPage(overlay.curriculum_page, media)
  })

  guard('about_page', () => {
    // 整份取代；項目數或格式不符時丟錯，guard 退回內建內容。
    if (overlay.about_page) next.aboutPage = aboutPage(overlay.about_page, media)
  })

  guard('environment_page', () => {
    // 整份取代；項目數、時間順序或格式不符時丟錯，guard 退回內建內容。
    if (overlay.environment_page) next.environmentPage = environmentPage(overlay.environment_page, media)
  })

  guard('campus_profile', () => {
    if (overlay.campus_profile) {
      const profiles = overlay.campus_profile
      // 內建家長影片的封面（各校合在一起，以影片 id 小寫查）：後台自訂的清單沒選封面、影片又是內建那幾支時沿用
      const builtinPosters = new Map(content.campuses.flatMap((c) => (c.testimonials ?? []).map((t) => [t.youtubeId.toLowerCase(), t.poster] as const)))
      next.campuses = next.campuses.map((c) => {
        const profile = profiles[c.key]
        if (!profile) return c
        return {
          ...c,
          name: profile.name,
          district: profile.district,
          address: profile.address,
          phone: profile.phone,
          // 社群連結直接綁進 href：已存檔的有後端允許清單擋，但即時預覽的草稿（preview-live）不經後端，
          // 這裡再擋一次，只收 http(s)，和消息、機構社群連結一致。
          facebook: safeWebUrl(profile.facebook),
          line: safeWebUrl(profile.line) || null,
          mapUrl: profile.map_url || undefined,
          // 有這欄就以後台為準（空字串＝尚未提供）；舊版本沒有這欄才沿用 fixture
          instagram: profile.instagram === undefined ? c.instagram : safeWebUrl(profile.instagram) || null,
          youtube: profile.youtube === undefined ? c.youtube : safeWebUrl(profile.youtube) || null,
          // 陣列（含 []）整組取代；null／沒有這欄＝保留 fixture 的內建清單
          ...(Array.isArray(profile.testimonials) ? { testimonials: campusTestimonials(profile.testimonials, builtinPosters, media) } : {}),
          ...campusMedia(c, profile, media)
        }
      })
    }
  })

  guard('home_news／campus_news', () => {
    if (overlay.home_news || overlay.campus_news) {
      // 整組取代：後台一次送出完整的消息與活動清單。全站消息（home_news）和
      // 各校消息（campus_news）合併成同一份清單，官網依日期排序；校區名稱用
      // 上面疊好的分校介紹，所以放在 campus_profile 之後。圖片欄位同
      // campus_tour，可以是素材庫 UUID 或 fixture 代號（NewsDialog 用
      // responsiveTourImage 解析）。
      const names = Object.fromEntries(next.campuses.map((c) => [c.key, c.name]))
      const news = overlay.home_news
      // 「示意內容」逐則標：全站消息（或還沒發布全站消息時沿用的內建消息）看
      // 示意說明有沒有值；各校消息是分校自己發布的真實消息，一律不是示意。
      const sample = Boolean(news ? news.sample_note : next.news.sampleNote)
      const articles: NewsArticle[] = news
        ? news.articles.map((a) => ({ ...newsArticle(a, newsScope(a, names), media), sample }))
        : next.news.articles.map((a) => ({ ...a, sample: a.sample ?? sample }))
      const events: NewsEvent[] = news
        ? news.events.map((e) => ({ ...newsEvent(e, newsScope(e, names)), sample }))
        : next.news.events.map((e) => ({ ...e, sample: e.sample ?? sample }))
      for (const c of next.campuses) {
        const own = overlay.campus_news?.[c.key]
        if (!own) continue
        const where = { campus: c.name, campusKeys: [c.key] }
        // 各校的 id 只在自己校內不重複，合併時加上校區避免撞到全站消息。
        articles.push(...own.articles.map((a) => ({ ...newsArticle(a, where, media, `${c.key}:${a.id}`), featured: false, sample: false })))
        events.push(...own.events.map((e) => ({ ...newsEvent(e, where, `${c.key}:${e.id}`), sample: false })))
      }
      next.news = {
        ...next.news,
        sampleNote: news ? news.sample_note : next.news.sampleNote,
        articles,
        events,
        homeCount: news?.home_display_count ?? null
      }
      const films = Array.isArray(news?.films) ? homeFilms(news.films, media) : []
      // 至少要有一支才換掉內建清單（輪播沒有影片會整塊空白）。
      if (films.length) next.news.films = films
    }
  })

  guard('campus_tour', () => {
    if (overlay.campus_tour) {
      const tours = overlay.campus_tour
      // 整組取代（不是逐場景/逐熱點合併）：後台編輯器一次送出完整
      // scenes 陣列，這裡直接換掉 tourScenes。
      next.campuses = next.campuses.map((c) => {
        const tour = tours[c.key]
        if (!tour) return c
        return { ...c, tourScenes: tour.scenes.map((scene) => tourScene(scene, media)) }
      })
    }
  })

  // 30 週年關閉時，主選單與頁尾不留連到 /anniversary 的連結（頁面本身回 404）。
  // 放在所有 guard 之後：頁尾連結可能是內建的，也可能是後台設定的。
  if (!anniversaryEnabled(next.siteMeta)) {
    const navWithout = next.siteMeta.primaryNav.filter((item) => !isAnniversaryHref(item.href))
    if (navWithout.length) next.siteMeta = { ...next.siteMeta, primaryNav: navWithout }
    next.footer = { ...next.footer, links: next.footer.links.filter((link) => !isAnniversaryHref(link.href)) }
  }

  return next
}

// 只帶官網環境頁用得到的欄位：舊版本存著的熱點（spots、spots_reviewed）不進頁面資料。
function tourScene(scene: LiveTourScene, media: MediaInfoMap): TourScene {
  const { key, name, image, intro } = scene
  const imageMedia = legacyImage(image, media)
  return imageMedia ? { key, name, image, intro, imageMedia } : { key, name, image, intro }
}

/**
 * 分校封面、各版位焦點與線稿。版位焦點（card_focus）優先；沒有時
 * 換了封面就用封面版位或素材的焦點，沒換封面就維持內建的 CSS 位置。
 */
function campusMedia(c: SiteContent['campuses'][number], profile: LiveCampusProfile, media: MediaInfoMap) {
  const cover = slotImage(profile.cover, media)
  const fallback = cover ? cover.position : undefined
  const pick = (focus: LiveFocusPoint | null | undefined, builtin: string | null) =>
    focusPosition(focus) ?? (fallback !== undefined ? fallback : builtin)
  const lineArt = slotImage(profile.line_art, media)
  // 只換了線稿、沒換上色版：上色版也用新線稿，不疊上舊建築的顏色。
  const lineArtColour = slotImage(profile.line_art_colour, media) ?? lineArt
  return {
    panoramaPos: pick(profile.card_focus, c.panoramaPos),
    photoPos: fallback !== undefined ? fallback : c.photoPos,
    ...(cover ? { imageMedia: cover } : {}),
    ...(lineArt ? { lineArtMedia: lineArt } : {}),
    ...(lineArtColour ? { lineArtColourMedia: lineArtColour } : {})
  }
}
