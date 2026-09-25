import type { AdmissionRefund, AdmissionStep, AdmissionPhase, AdmissionUniformDay, AdmissionSubsidy, AdmissionAllowance, FaqItem, HomeFilm, NewsArticle, NewsBlock, NewsEvent, SiteContent, TourScene } from '~/types/site-content'
import { newsMonth } from './news-content'
import { privacyNotice } from './privacy-notice'
import { siteLink } from './site-links'
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
  eyebrow: string
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
  admission_title?: string
  admission_description?: string
  allow_indexing?: boolean
  /** 2026-09-25 新增；沒有（或 null）＝沿用內建主選單 */
  primary_nav?: LiveNavLink[] | null
}

export interface LiveHomeCampusBoard {
  section_title: string
  eyebrow: string
  note: string
  /** 2026-09-25 新增：首頁五校順序與預設顯示的校區 */
  campus_order?: string[]
  default_campus?: string
}

export interface LiveBookingContent {
  cta_label: string
  cta_label_en: string
  consent_text: string
  banner_title_template: string
  banner_body: string
  banner_button_label: string
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
  source_note: string
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
  intro: string
  description: string
  facebook: string
  fb_note: string
  line: string
  /** 2026-09-25 新增：Google 地圖網址，空字串＝用地址搜尋 */
  map_url?: string
  cover?: LiveMediaSlot | null
  /** 首頁五校卡片與預約頁的校區照片 */
  card_focus?: LiveFocusPoint | null
  /** 分校頁首屏 */
  hero_focus?: LiveFocusPoint | null
  line_art?: LiveMediaSlot | null
  line_art_colour?: LiveMediaSlot | null
}

export interface LiveCampusFaq {
  items: { q: string; a: string; enabled?: boolean }[]
  include_shared?: boolean
  shared_position?: 'before' | 'after'
}

export interface LiveSharedFaq {
  items: ({ id: string; q: string; a: string; enabled?: boolean } & LiveNewsScope)[]
}

export interface LiveTourSpot {
  name: string
  x: number
  y: number
  text: string
  question: string
}

export interface LiveTourScene {
  key: string
  name: string
  image: string
  intro: string
  spots: LiveTourSpot[]
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
  shared_faq?: LiveSharedFaq | null
  // 以下每校各一份，key 是 campus_key（見後端 get_public_content /
  // useDraftPreview 對應處理，跟其餘扁平 kind 的形狀不同）。
  campus_profile?: Record<string, LiveCampusProfile> | null
  campus_faq?: Record<string, LiveCampusFaq> | null
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
    const src = slotVideoSrc(film.video)
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
 * 分校頁的常見問題 = 本校題目＋全站共用題目（規格 3.2）。共用題目依各校設定
 * 放在本校題目之前或之後、或不顯示；只適用某幾校的共用題目只在那幾校出現。
 * 本校有一題和共用題目問題相同時，顯示本校的版本，停用就是這校不顯示那一題；
 * 其他校照樣顯示共用的答案。問題或回答空白的本校題目不顯示（後端 2026-09-26
 * 起擋下，這裡顧及之前發布的「本校不顯示」題被切回顯示的情形），同一題的共用
 * 題目也照樣藏起來，跟停用一樣。
 */
export function mergeCampusFaq(campusKey: string, faq: LiveCampusFaq, shared: LiveSharedFaq | null | undefined): FaqItem[] {
  const own = faq.items
  const ownQuestions = new Set(own.map((item) => item.q.trim()))
  const sharedItems = faq.include_shared === false
    ? []
    : (shared?.items ?? [])
      .filter((item) => item.enabled !== false)
      .filter((item) => item.scope !== 'campus' || (item.campus_keys ?? []).includes(campusKey))
      .filter((item) => !ownQuestions.has(item.q.trim()))
      .map((item) => ({ q: item.q, a: item.a }))
  const ownItems = own
    .filter((item) => item.enabled !== false && item.q.trim() && item.a.trim())
    .map((item) => ({ q: item.q, a: item.a }))
  return faq.shared_position === 'after' ? [...ownItems, ...sharedItems] : [...sharedItems, ...ownItems]
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
export function applyContentOverlay(content: SiteContent, overlay: ContentOverlay, media: MediaInfoMap = {}): SiteContent {
  const next: SiteContent = {
    ...content,
    home: { ...content.home, hero: { ...content.home.hero }, about: { ...content.home.about }, campusBoard: { ...content.home.campusBoard } },
    footer: { ...content.footer },
    siteMeta: { ...content.siteMeta },
    booking: { ...content.booking },
    dayExperience: { ...content.dayExperience },
    campuses: content.campuses.map((c) => ({ ...c, faq: { ...c.faq } }))
  }

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

  if (overlay.home_hero) {
    const hero = overlay.home_hero
    next.home.hero = {
      ...next.home.hero,
      eyebrow: hero.eyebrow,
      copyLines: hero.copy_lines
    }
    const poster = slotImage(hero.poster, media)
    if (poster) {
      next.home.hero.heroImageMedia = poster
      next.home.hero.heroImageAlt = hero.poster_alt || poster.alt
    }
    const fallback = slotImage(hero.fallback_image, media)
    if (fallback) next.home.hero.heroFallbackMedia = { ...fallback, alt: fallback.alt || next.home.hero.heroImageAlt }
    const desktop = slotVideoSrc(hero.video_desktop)
    const mobile = slotVideoSrc(hero.video_mobile)
    if (desktop && hero.video_desktop) {
      next.home.hero.heroVideoSrc = desktop
      next.home.hero.heroVideoPosition = slotPosition(hero.video_desktop, media[hero.video_desktop.media_id])
    }
    // 手機沒設就用桌機那支（規格 L141 允許沿用同一支影片）。
    const mobileSlot = mobile ? hero.video_mobile : desktop ? hero.video_desktop : null
    if (mobileSlot) {
      next.home.hero.heroVideoSrcMobile = slotVideoSrc(mobileSlot)
      next.home.hero.heroVideoPositionMobile = slotPosition(mobileSlot, media[mobileSlot.media_id])
    }
  }

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
      admissionTitle: overlay.site_meta.admission_title || undefined,
      admissionDescription: overlay.site_meta.admission_description || undefined,
      allowIndexing: overlay.site_meta.allow_indexing ?? true
    }
    const nav = (overlay.site_meta.primary_nav ?? [])
      .filter((item) => item.label?.trim() && siteLink(item.href))
      .map((item) => ({ label: item.label, labelEn: item.label_en ?? '', href: item.href.trim() }))
    // 選單至少要有一項：後台存的是空的（或全部無效）就沿用內建選單。
    if (nav.length) next.siteMeta.primaryNav = nav
  }

  if (overlay.home_campus_board) {
    const board = overlay.home_campus_board
    next.home.campusBoard = {
      ...next.home.campusBoard,
      sectionTitle: board.section_title,
      eyebrow: board.eyebrow,
      note: board.note
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

  if (overlay.booking_content) {
    const booking = overlay.booking_content
    next.booking = {
      ...next.booking,
      ctaLabel: booking.cta_label,
      ctaLabelEn: booking.cta_label_en,
      consentText: booking.consent_text,
      bannerTitleTemplate: booking.banner_title_template,
      bannerBody: booking.banner_body,
      bannerButtonLabel: booking.banner_button_label,
      privacyNotice: privacyNotice(booking.privacy_title, booking.privacy_sections)
    }
  }

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
      sourceNote: day.source_note,
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
    const desktop = slotVideoSrc(day.film_desktop)
    const mobile = slotVideoSrc(day.film_mobile)
    if (desktop && day.film_desktop) {
      next.dayExperience.filmSrc = desktop
      next.dayExperience.filmPosition = slotPosition(day.film_desktop, media[day.film_desktop.media_id])
    }
    const mobileSlot = mobile ? day.film_mobile : desktop ? day.film_desktop : null
    if (mobileSlot) {
      next.dayExperience.filmSrcMobile = slotVideoSrc(mobileSlot)!
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

  if (overlay.campus_profile) {
    const profiles = overlay.campus_profile
    next.campuses = next.campuses.map((c) => {
      const profile = profiles[c.key]
      if (!profile) return c
      return {
        ...c,
        name: profile.name,
        district: profile.district,
        address: profile.address,
        phone: profile.phone,
        intro: profile.intro,
        description: profile.description,
        facebook: profile.facebook,
        fbNote: profile.fb_note,
        line: profile.line || null,
        mapUrl: profile.map_url || undefined,
        ...campusMedia(c, profile, media)
      }
    })
  }

  if (overlay.campus_faq) {
    const faqs = overlay.campus_faq
    next.campuses = next.campuses.map((c) => {
      const faq = faqs[c.key]
      if (!faq) return c
      return { ...c, faq: { ...c.faq, items: mergeCampusFaq(c.key, faq, overlay.shared_faq) } }
    })
  }

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

  if (overlay.campus_tour) {
    const tours = overlay.campus_tour
    // 整組取代（不是逐場景/逐熱點合併）：後台編輯器一次送出完整
    // scenes 陣列，這裡直接換掉 tourScenes，含把原本的
    // GeneratedTourScenes 佔位樣板換成真正逐校撰寫的內容。
    next.campuses = next.campuses.map((c) => {
      const tour = tours[c.key]
      if (!tour) return c
      return { ...c, tourScenes: tour.scenes.map((scene) => tourScene(scene, media)) }
    })
  }

  return next
}

function tourScene(scene: LiveTourScene, media: MediaInfoMap): TourScene {
  const imageMedia = legacyImage(scene.image, media)
  return imageMedia ? { ...scene, imageMedia } : scene
}

/**
 * 分校封面、各版位焦點與線稿。版位焦點（card_focus／hero_focus）優先；沒有時
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
    heroPhotoPos: pick(profile.hero_focus, c.heroPhotoPos),
    photoPos: fallback !== undefined ? fallback : c.photoPos,
    ...(cover ? { imageMedia: cover } : {}),
    ...(lineArt ? { lineArtMedia: lineArt } : {}),
    ...(lineArtColour ? { lineArtColourMedia: lineArtColour } : {})
  }
}
