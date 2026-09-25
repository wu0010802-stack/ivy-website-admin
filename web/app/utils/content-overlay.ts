import type { AdmissionRefund, AdmissionStep, AdmissionPhase, AdmissionUniformDay, AdmissionSubsidy, AdmissionAllowance, SiteContent } from '~/types/site-content'
import { newsMonth } from './news-content'
import { privacyNotice } from './privacy-notice'

export interface LiveHomeAbout {
  title: string
  since_label: string
  body_text: string
  caption: string
}

export interface LiveHomeHero {
  eyebrow: string
  copy_lines: string[]
  cta_label: string
}

export interface LiveSiteFooter {
  tagline: string
  copyright: string
  bottom_note: string
  campus_list_label: string
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
}

export interface LiveHomeCampusBoard {
  section_title: string
  eyebrow: string
  note: string
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

export interface LiveNewsArticle {
  id: string
  date: string
  campus: string
  category: string
  title: string
  description: string
  image: string
  alt: string
}

export interface LiveNewsEvent {
  id: string
  date: string
  campus: string
  title: string
  description: string
}

export interface LiveHomeNews {
  sample_note: string
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
}

export interface LiveCampusFaq {
  items: { q: string; a: string }[]
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
  // 這兩種是每校各一份，key 是 campus_key（見後端 get_public_content /
  // useDraftPreview 對應處理，跟其餘扁平 kind 的形狀不同）。
  campus_profile?: Record<string, LiveCampusProfile> | null
  campus_faq?: Record<string, LiveCampusFaq> | null
  campus_tour?: Record<string, LiveCampusTour> | null
}

/**
 * 把後端已接上 CMS 的欄位疊到 fixture 內容上，兩邊都不修改傳入的物件
 * （回傳新物件），也不假設 overlay 一定齊全——缺哪個 kind、或某校缺某
 * 個 kind，就保留 fixture 原文，不讓公開頁面因為某項還沒發布過就壞掉。
 *
 * `usePublishedSite`（讀已發布內容）跟 `useDraftPreview`（讀最新未發布
 * revision）共用這個函式，差別只在 overlay 資料是從哪支 API 拿的。
 *
 * 仍未搬進 CMS、維持 fixture 靜態資料的部分：探索（tourScenes，含地圖
 * 座標的複雜巢狀結構）、影片／照片素材本身（仍是路徑字串，尚未接媒體
 * 庫）、首頁五校排序與預設校區（結構性設定，不當文字內容編輯）。
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
      copyLines: hero.copy_lines,
      ctaLabel: hero.cta_label
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
  }

  if (overlay.home_campus_board) {
    const board = overlay.home_campus_board
    next.home.campusBoard = {
      ...next.home.campusBoard,
      sectionTitle: board.section_title,
      eyebrow: board.eyebrow,
      note: board.note
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
    // 只覆蓋文字欄位；photo/tint/alt 這些跟素材綁定的欄位還沒接媒體庫
    // （見上方註解），所以疊資料的筆數上限是 fixture 既有的照片卡數量
    // ——後台多新增的卡片目前不會顯示，避免出現沒有照片的破圖卡片。
    const mergedCount = Math.min(day.moments.length, next.dayExperience.moments.length)
    next.dayExperience = {
      ...next.dayExperience,
      eyebrow: day.eyebrow,
      eyebrowEn: day.eyebrow_en,
      note: day.note,
      sourceNote: day.source_note,
      moments: next.dayExperience.moments.map((original, i) => {
        const m = i < mergedCount ? day.moments[i] : undefined
        if (!m) return original
        return {
          ...original,
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

  if (overlay.home_news) {
    // 整組取代：後台一次送出完整的消息與活動清單。圖片欄位同 campus_tour，
    // 可以是素材庫 UUID 或 fixture 代號（NewsDialog 用 responsiveTourImage 解析）。
    const news = overlay.home_news
    next.news = {
      ...next.news,
      sampleNote: news.sample_note,
      articles: news.articles.map((a) => ({ ...a })),
      events: news.events.map((e) => ({ ...e, month: newsMonth(e.date) }))
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
        line: profile.line || null
      }
    })
  }

  if (overlay.campus_faq) {
    const faqs = overlay.campus_faq
    next.campuses = next.campuses.map((c) => {
      const faq = faqs[c.key]
      if (!faq) return c
      return { ...c, faq: { ...c.faq, items: faq.items } }
    })
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
