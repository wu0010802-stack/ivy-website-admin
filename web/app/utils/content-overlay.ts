import type { AdmissionRefund, AdmissionStep, AdmissionPhase, AdmissionUniformDay, AdmissionSubsidy, AdmissionAllowance, FaqItem, NewsArticle, NewsBlock, NewsEvent, SiteContent } from '~/types/site-content'
import { newsMonth } from './news-content'
import { privacyNotice } from './privacy-notice'
import { siteLink } from './site-links'

export interface LiveHomeAbout {
  title: string
  since_label: string
  body_text: string
  caption: string
}

export interface LiveHomeHero {
  eyebrow: string
  copy_lines: string[]
  /** 2026-09-23 拿掉首屏按鈕：舊版本才有，官網不讀 */
  cta_label?: string
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
}

export interface LiveDayExperience {
  eyebrow: string
  eyebrow_en: string
  note: string
  source_note: string
  moments: LiveDayMoment[]
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

export interface LiveHomeNews {
  sample_note: string
  articles: LiveNewsArticle[]
  events: LiveNewsEvent[]
  home_display_count?: number | null
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

function newsArticle(a: LiveNewsArticle, where: { campus: string; campusKeys: string[] }, id = a.id): NewsArticle {
  return {
    id,
    date: a.date,
    ...where,
    category: a.category,
    title: a.title,
    description: a.description,
    body: (a.body ?? []).map((block) => ({ ...block }) as NewsBlock),
    featured: Boolean(a.featured),
    image: a.image,
    alt: a.alt
  }
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
 * 其他校照樣顯示共用的答案。
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
  const ownItems = own.filter((item) => item.enabled !== false).map((item) => ({ q: item.q, a: item.a }))
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
 * 仍未搬進 CMS、維持 fixture 靜態資料的部分：影片／照片素材本身（仍是
 * 路徑字串，尚未接媒體庫，孩子的一天的照片依卡片 key 對回內建素材）、
 * 品牌名稱與 Logo（2026-09-19 核可鎖定）。
 */
export function applyContentOverlay(content: SiteContent, overlay: ContentOverlay): SiteContent {
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
  }

  if (overlay.home_hero) {
    const hero = overlay.home_hero
    next.home.hero = {
      ...next.home.hero,
      eyebrow: hero.eyebrow,
      copyLines: hero.copy_lines
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
    // 還沒接素材庫（素材版位另一批），依 key 對回官網內建的同一張卡；後台新增、
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
        const media = original
          ? { tint: original.tint, photo: original.photo, alt: original.alt }
          : { tint: builtin.length ? builtin[i % builtin.length]!.tint : '', photo: '', alt: '' }
        return {
          ...media,
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
        mapUrl: profile.map_url || undefined
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
    const articles: NewsArticle[] = news ? news.articles.map((a) => newsArticle(a, newsScope(a, names))) : [...next.news.articles]
    const events: NewsEvent[] = news ? news.events.map((e) => newsEvent(e, newsScope(e, names))) : [...next.news.events]
    for (const c of next.campuses) {
      const own = overlay.campus_news?.[c.key]
      if (!own) continue
      const where = { campus: c.name, campusKeys: [c.key] }
      // 各校的 id 只在自己校內不重複，合併時加上校區避免撞到全站消息。
      articles.push(...own.articles.map((a) => ({ ...newsArticle(a, where, `${c.key}:${a.id}`), featured: false })))
      events.push(...own.events.map((e) => newsEvent(e, where, `${c.key}:${e.id}`)))
    }
    next.news = {
      ...next.news,
      sampleNote: news ? news.sample_note : next.news.sampleNote,
      articles,
      events,
      homeCount: news?.home_display_count ?? null
    }
  }

  if (overlay.campus_tour) {
    const tours = overlay.campus_tour
    // 整組取代（不是逐場景/逐熱點合併）：後台編輯器一次送出完整
    // scenes 陣列，這裡直接換掉 tourScenes，含把原本的
    // GeneratedTourScenes 佔位樣板換成真正逐校撰寫的內容。
    next.campuses = next.campuses.map((c) => {
      const tour = tours[c.key]
      if (!tour) return c
      return { ...c, tourScenes: tour.scenes }
    })
  }

  return next
}
