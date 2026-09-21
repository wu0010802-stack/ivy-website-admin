import type { SiteContent } from '~/types/site-content'

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

export interface ContentOverlay {
  home_about?: LiveHomeAbout | null
  home_hero?: LiveHomeHero | null
  site_footer?: LiveSiteFooter | null
  site_meta?: LiveSiteMeta | null
  home_campus_board?: LiveHomeCampusBoard | null
  booking_content?: LiveBookingContent | null
  day_experience?: LiveDayExperience | null
  // 這兩種是每校各一份，key 是 campus_key（見後端 get_public_content /
  // useDraftPreview 對應處理，跟其餘扁平 kind 的形狀不同）。
  campus_profile?: Record<string, LiveCampusProfile> | null
  campus_faq?: Record<string, LiveCampusFaq> | null
}

/**
 * 把後端已接上 CMS 的欄位疊到 fixture 內容上，兩邊都不修改傳入的物件
 * （回傳新物件），也不假設 overlay 一定齊全——缺哪個 kind、或某校缺某
 * 個 kind，就保留 fixture 原文，不讓公開頁面因為某項還沒發布過就壞掉。
 *
 * `usePublishedSite`（讀已發布內容）跟 `useDraftPreview`（讀最新未發布
 * revision）共用這個函式，差別只在 overlay 資料是從哪支 API 拿的。
 *
 * 仍未搬進 CMS、維持 fixture 靜態資料的部分：消息（news，跟使用者當時
 * 進行中的首頁優化工作重疊，本輪刻意不動）、探索（tourScenes，含地圖
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
      }
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
      bannerButtonLabel: booking.banner_button_label
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

  return next
}
