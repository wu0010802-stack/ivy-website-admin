/**
 * 素材庫素材在官網上的網址、srcset 與焦點（規格 L108、L139）。
 *
 * 後台的素材版位存 `{ media_id, focus_x, focus_y }`（焦點 0–100，留空＝用素材
 * 本身的焦點）。公開 API 另外給 `media`：每個被引用素材的尺寸、衍生檔（縮圖、中圖、
 * 大圖、影片 poster 與桌機／手機轉檔版本）與素材預設焦點，官網據此組 srcset 與 object-position。
 * 檔案一律走同源 `/api/website/v1/public/media/...`（web/server/routes/api/
 * website/v1/[...].ts 轉給 API，Range 原樣轉送），權限由 API 判斷。
 */
import type { AboutPageContent, Campus, CurriculumPageContent, HeroContent } from '../types/site-content'
import { ABOUT_HERO_IMAGE, ABOUT_HERO_SIZES, CURRICULUM_HERO_IMAGE, CURRICULUM_HERO_SIZES, HOME_HERO_SIZES, responsiveImage } from './responsive-image'

export interface PublicMediaVariant {
  kind: 'thumbnail' | 'medium' | 'large' | 'poster' | 'video_desktop' | 'video_mobile'
  width: number | null
  height: number | null
  /** 衍生檔版本：重新產生衍生檔時會換，加在網址上避開長快取過的舊檔 */
  version?: string
}

/** 後端 media/schemas.py 的 PublicMediaOut。 */
export interface PublicMediaInfo {
  id: string
  kind: 'image' | 'video'
  content_type: string
  width: number | null
  height: number | null
  alt_text: string | null
  focus_x: number | null
  focus_y: number | null
  variants: PublicMediaVariant[]
}

export type MediaInfoMap = Record<string, PublicMediaInfo>

/** 後端 content/schemas.py 的 MediaSlotPayload。 */
export interface LiveMediaSlot {
  media_id: string
  focus_x?: number | null
  focus_y?: number | null
}

/** 後端 FocusPointPayload：0–100 的 x／y。 */
export interface LiveFocusPoint {
  x: number
  y: number
}

/** 解析好的素材圖片：元件用 mediaImageAttrs 綁到 <img>。 */
export interface MediaImage {
  src: string
  width?: number
  height?: number
  /** srcset 候選（由小到大）；少於兩個就不輸出 srcset */
  candidates: { src: string; width: number }[]
  /** object-position；null＝元件用自己的預設 */
  position: string | null
  /** 素材庫填的說明，內容沒寫替代文字時用 */
  alt: string
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const BASE = '/api/website/v1/public/media'

export function isMediaId(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value)
}

export function mediaFileUrl(id: string): string {
  return `${BASE}/${id}/file`
}

export function mediaVariantUrl(id: string, kind: PublicMediaVariant['kind'], version?: string): string {
  const url = `${BASE}/${id}/variants/${kind}`
  return version ? `${url}?v=${encodeURIComponent(version)}` : url
}

function clampPercent(value: number): number {
  return Math.round(Math.min(100, Math.max(0, value)) * 100) / 100
}

/** 焦點 → CSS object-position；沒有焦點回 null。 */
export function focusPosition(point: LiveFocusPoint | null | undefined): string | null {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null
  return `${clampPercent(point.x)}% ${clampPercent(point.y)}%`
}

/** 版位自己的焦點優先，其次是素材預設焦點。 */
export function slotPosition(slot: LiveMediaSlot, info?: PublicMediaInfo): string | null {
  if (slot.focus_x != null && slot.focus_y != null) return focusPosition({ x: slot.focus_x, y: slot.focus_y })
  if (info && info.focus_x != null && info.focus_y != null) return focusPosition({ x: info.focus_x, y: info.focus_y })
  return null
}

const IMAGE_VARIANTS = new Set<PublicMediaVariant['kind']>(['thumbnail', 'medium', 'large'])

export function mediaImage(id: string, info?: PublicMediaInfo, position: string | null = null): MediaImage {
  const candidates: { src: string; width: number }[] = []
  for (const variant of info?.variants ?? []) {
    // 只收圖片的縮小版：poster 與影片轉檔版本不是這張圖。寬度不明的衍生檔（舊縮圖沒依
    // 拍攝方向轉正、去背圖曾經失去透明，等重新產生）不放進 srcset，改用原檔。
    if (!IMAGE_VARIANTS.has(variant.kind) || !variant.width) continue
    candidates.push({ src: mediaVariantUrl(id, variant.kind, variant.version), width: variant.width })
  }
  if (info?.width) candidates.push({ src: mediaFileUrl(id), width: info.width })
  candidates.sort((a, b) => a.width - b.width)
  const unique = candidates.filter((candidate, i) => i === 0 || candidate.width !== candidates[i - 1]!.width)
  return {
    src: mediaFileUrl(id),
    width: info?.width ?? undefined,
    height: info?.height ?? undefined,
    candidates: unique,
    position,
    alt: info?.alt_text ?? ''
  }
}

/** 版位 → 圖片；版位沒設（或不是有效 id）回 undefined＝沿用官網內建。 */
export function slotImage(slot: LiveMediaSlot | null | undefined, media: MediaInfoMap | undefined): MediaImage | undefined {
  if (!slot || !isMediaId(slot.media_id)) return undefined
  const info = media?.[slot.media_id]
  return mediaImage(slot.media_id, info, slotPosition(slot, info))
}

/**
 * 影片版位 → 檔案網址。素材有背景轉好的版本（後端 app/media/jobs.py）就用對應的
 * 那一版（手機版同解析度、CRF 較高，見 media-policy.ts）；沒有版本（舊素材，或原檔
 * 本來就能直接播、後端判定沿用原檔）用原檔。
 *
 * 素材不在 media 裡就回 undefined，呼叫端沿用官網內建影片：公開 API 與草稿預覽
 * （draft-preview.ts 的 previewMedia）只列處理好的素材，轉檔中的影片原檔公開路由拿
 * 不到，給網址只會放一支播不出來的影片。
 */
export function slotVideoSrc(
  slot: LiveMediaSlot | null | undefined,
  media: MediaInfoMap | undefined,
  edition: 'desktop' | 'mobile' = 'desktop'
): string | undefined {
  if (!slot || !isMediaId(slot.media_id)) return undefined
  const info = media?.[slot.media_id]
  if (!info) return undefined
  const kind = edition === 'mobile' ? 'video_mobile' : 'video_desktop'
  const variant = info.variants.find((v) => v.kind === kind)
  return variant ? mediaVariantUrl(slot.media_id, kind, variant.version) : mediaFileUrl(slot.media_id)
}

/** 影片自動抽的畫面（沒有就空字串）。 */
export function videoPosterUrl(id: string, info?: PublicMediaInfo): string {
  const poster = info?.variants.find((v) => v.kind === 'poster')
  return poster ? mediaVariantUrl(id, 'poster', poster.version) : ''
}

export function mediaImageAttrs(image: MediaImage, sizes: string) {
  const srcset = image.candidates.length > 1 ? image.candidates.map((c) => `${c.src} ${c.width}w`).join(', ') : undefined
  return { src: image.src, width: image.width, height: image.height, srcset, sizes: srcset ? sizes : undefined }
}

/** 後台有選素材就用素材（srcset 由衍生檔組成），否則用官網內建圖片的 manifest。 */
export function pickImage(name: string, media: MediaImage | undefined, sizes = '100vw') {
  return media ? mediaImageAttrs(media, sizes) : responsiveImage(name, sizes)
}

/**
 * 五校線稿的小圖（首頁分校分頁、預約結果）：內建線稿用透明底的墨線版 `<代號>-ink`
 * （scripts/optimize-site-images.py 產生），不再靠 filter＋mix-blend-mode:multiply 融掉紙底——
 * iPhone 把圖或祖先移到獨立合成層時 multiply 碰不到底色，會露出整塊紙底方塊。
 * 後台換過線稿（lineArtMedia）時沒有墨線版，照舊用原圖，呼叫端依 lineArtBlends() 掛 `is-blend` 走 filter＋multiply。
 */
export function lineArtInkImage(campus: Pick<Campus, 'key' | 'lineArtMedia'>, sizes: string) {
  return campus.lineArtMedia ? mediaImageAttrs(campus.lineArtMedia, sizes) : responsiveImage(`campus-line-art-${campus.key}-ink`, sizes)
}

export function lineArtBlends(campus: Pick<Campus, 'lineArtMedia'>) {
  return Boolean(campus.lineArtMedia)
}

/** 首頁首屏照片：頁面 <img> 與 usePageSeo 的 preload 共用，才不會多下載一張。 */
export function heroImageAttrs(hero: Pick<HeroContent, 'heroImage' | 'heroImageMedia'>) {
  return pickImage(hero.heroImage, hero.heroImageMedia, HOME_HERO_SIZES)
}

/** 分校頁首屏照片（sizes 100vw）：頁面與 preload 共用。 */
export function campusHeroAttrs(campus: Pick<Campus, 'image' | 'imageMedia'>) {
  return pickImage(campus.image, campus.imageMedia)
}

/** 特色教學頁首屏照片：頁面 <img> 與 usePageSeo 的 preload 共用，才不會多下載一張。 */
export function curriculumHeroAttrs(page: Pick<CurriculumPageContent, 'heroPhoto'>) {
  return pickImage(CURRICULUM_HERO_IMAGE, page.heroPhoto, CURRICULUM_HERO_SIZES)
}

/** 關於常春藤頁首屏照片：頁面 <img> 與 usePageSeo 的 preload 共用。 */
export function aboutHeroAttrs(page: Pick<AboutPageContent, 'heroPhoto'>) {
  return pickImage(ABOUT_HERO_IMAGE, page.heroPhoto, ABOUT_HERO_SIZES)
}
