import { WEBSITE_ASSET_BASE } from '../config'

// 內容編輯頁右側的官網預覽（2026-10-06 方向 D）：每種內容在官網哪一頁、哪一塊看得到。
// page 對應官網 /preview?page=（web/app/utils/draft-preview.ts 的 PreviewPage），block 對應
// web/app/utils/preview-live.ts 的 PREVIEW_BLOCKS；兩邊的名字由 previewProtocol.test.ts 比對。

export type PreviewPage = 'home' | 'admission' | 'visit' | 'privacy' | 'curriculum' | 'about' | 'environment'
export type PreviewBlock =
  | 'home-hero' | 'home-about' | 'home-day' | 'home-campuses' | 'home-news'
  | 'site-header' | 'site-footer' | 'visit-booking' | 'page-top'
export type PreviewViewport = 'desktop' | 'mobile'
/** connecting＝等預覽頁回應；live＝預覽的是還沒存的修改；saved＝只看得到上次儲存的草稿；failed＝預覽頁拒絕（沒登入）。 */
export type PreviewPaneState = 'connecting' | 'live' | 'saved' | 'failed'

export interface PreviewTarget {
  /** 分頁代號，同一種內容裡唯一 */
  id: string
  /** 分頁上的字 */
  label: string
  page: PreviewPage
  block: PreviewBlock
  /** 只有這些最外層欄位會出現在這一塊；沒寫＝全部欄位。改到其他欄位時預覽不框、不捲。 */
  fields?: readonly string[]
}

const HOME_NEWS: readonly PreviewTarget[] = [{ id: 'news', label: '首頁最新消息', page: 'home', block: 'home-news' }]

export const PREVIEW_TARGETS: Readonly<Record<string, readonly PreviewTarget[]>> = {
  home_hero: [{ id: 'hero', label: '首頁首屏', page: 'home', block: 'home-hero' }],
  home_about: [{ id: 'about', label: '首頁關於常春藤', page: 'home', block: 'home-about' }],
  day_experience: [{ id: 'day', label: '首頁孩子的一天', page: 'home', block: 'home-day' }],
  home_campus_board: [{ id: 'campuses', label: '首頁五校', page: 'home', block: 'home-campuses' }],
  home_news: HOME_NEWS,
  campus_news: HOME_NEWS,
  // 不做預約頁：官網 /preview?page=visit 只畫個資說明，沒有真正的預約表單（計畫裁定 10）。
  campus_profile: [
    { id: 'campuses', label: '首頁五校', page: 'home', block: 'home-campuses' },
    { id: 'footer', label: '頁尾', page: 'home', block: 'site-footer' },
  ],
  booking_content: [
    { id: 'visit', label: '預約頁', page: 'visit', block: 'visit-booking', fields: ['privacy_title', 'privacy_sections'] },
    { id: 'header', label: '頁首預約鈕', page: 'home', block: 'site-header', fields: ['cta_label', 'cta_label_en'] },
  ],
  admission_content: [{ id: 'page', label: '入學資訊頁', page: 'admission', block: 'page-top' }],
  privacy_policy: [{ id: 'page', label: '隱私權政策頁', page: 'privacy', block: 'page-top' }],
  curriculum_page: [{ id: 'page', label: '特色教學頁', page: 'curriculum', block: 'page-top' }],
  about_page: [{ id: 'page', label: '關於常春藤頁', page: 'about', block: 'page-top' }],
  site_footer: [{ id: 'footer', label: '頁尾', page: 'home', block: 'site-footer' }],
  // 網站描述、分享圖等只用在搜尋與分享，預覽頁上看不到；只有頁首電話與主選單會框。
  site_meta: [{ id: 'header', label: '頁首', page: 'home', block: 'site-header', fields: ['header_phone_number', 'header_phone_note', 'primary_nav'] }],
  // 校園探索是寬版編輯器（場景大圖＋熱點），不放預覽欄；照舊用「存草稿並預覽」。
  campus_tour: [],
}

export function previewTargetsFor(kind: string | undefined): readonly PreviewTarget[] {
  // 用 hasOwnProperty 查：toString、constructor 這類原型鍵不是編輯頁。
  return kind && Object.prototype.hasOwnProperty.call(PREVIEW_TARGETS, kind) ? PREVIEW_TARGETS[kind]! : []
}

/**
 * 預覽 iframe 的來源。後台與官網同源（正式站 VITE_WEBSITE_ASSET_BASE 是空字串、stack build）才嵌；
 * 不同源（本機 npm run dev 的 5173 對 3000）回 null，不顯示預覽欄：官網的 frame-ancestors 只允許同源。
 */
export function livePreviewOrigin(
  base: string = WEBSITE_ASSET_BASE,
  here: Pick<Location, 'href' | 'origin'> = window.location,
): string | null {
  try {
    const origin = new URL(base || here.origin, here.href).origin
    return origin === here.origin ? origin : null
  } catch {
    return null
  }
}

/** 網址只帶 embed／live／page；草稿內容一律走 postMessage，不進網址。 */
export function previewFrameUrl(origin: string, page: PreviewPage, options: { live: boolean }): string {
  const params = new URLSearchParams({ embed: '1' })
  if (options.live) params.set('live', '1')
  params.set('page', page)
  return `${origin}/preview?${params.toString()}`
}

/** 桌機用 1280 寬渲染再縮小；手機 390（同官網 /preview 的手機框）。 */
export const PREVIEW_FRAME_WIDTH: Readonly<Record<PreviewViewport, number>> = { desktop: 1280, mobile: 390 }

/** 桌機預覽的虛擬視窗高度上限：stack 與正式站桌機基準 1440×900 的高。 */
export const PREVIEW_DESKTOP_MAX_HEIGHT = 900

/**
 * iframe 用原寬渲染、整個縮到放得進欄內（不放大），靠左上（呼叫端把它放在欄內頂端）。
 * 手機的虛擬視窗高度反算成剛好填滿欄高；桌機的高度最多 900：欄高 700、縮到三成時反算會得到 2299，
 * 官網 100svh 的大圖就被拉成三倍高，預覽和真正的桌機畫面差很多。桌機頁面長，靠 iframe 裡自己捲。
 */
export function fitPreviewFrame(stage: { width: number; height: number }, viewport: PreviewViewport, padding = 12) {
  const width = PREVIEW_FRAME_WIDTH[viewport]
  const innerWidth = Math.max(1, stage.width - padding * 2)
  const innerHeight = Math.max(1, stage.height - padding * 2)
  const scale = Math.min(1, Math.round((innerWidth / width) * 1000) / 1000)
  const fill = Math.round(innerHeight / scale)
  return { width, height: viewport === 'desktop' ? Math.min(PREVIEW_DESKTOP_MAX_HEIGHT, fill) : fill, scale }
}

export const PREVIEW_VIEWPORT_KEY = 'ivy-admin-preview-viewport'

/** 預設手機（右欄 320–460px，桌機縮到三成看不清字）；切換後記在這台瀏覽器。 */
export function readPreviewViewport(): PreviewViewport {
  try {
    return localStorage.getItem(PREVIEW_VIEWPORT_KEY) === 'desktop' ? 'desktop' : 'mobile'
  } catch {
    return 'mobile'
  }
}

export function rememberPreviewViewport(value: PreviewViewport): void {
  try {
    localStorage.setItem(PREVIEW_VIEWPORT_KEY, value)
  } catch {
    /* 私密模式等存不了就不記 */
  }
}
