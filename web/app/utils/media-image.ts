/**
 * 素材庫素材在官網上的網址、srcset 與焦點（規格 L108、L139）。
 *
 * 後台的素材版位存 `{ media_id, focus_x, focus_y }`（焦點 0–100，留空＝用素材
 * 本身的焦點）。公開 API 另外給 `media`：每個被引用素材的尺寸、衍生檔（縮圖、
 * 大圖、影片 poster）與素材預設焦點，官網據此組 srcset 與 object-position。
 * 檔案一律走同源 `/api/website/v1/public/media/...`（web/server/routes/api/
 * website/v1/[...].ts 轉給 API，Range 原樣轉送），權限由 API 判斷。
 */
import type { Campus, HeroContent } from '../types/site-content'
import { HOME_HERO_SIZES, responsiveImage } from './responsive-image'

export interface PublicMediaVariant {
  kind: 'thumbnail' | 'poster' | 'large'
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

export function mediaImage(id: string, info?: PublicMediaInfo, position: string | null = null): MediaImage {
  const candidates: { src: string; width: number }[] = []
  for (const variant of info?.variants ?? []) {
    // poster 是影片的畫面，不是這張圖的縮小版。寬度不明的衍生檔（舊縮圖沒依
    // 拍攝方向轉正、去背圖曾經失去透明，等重新產生）不放進 srcset，改用原檔。
    if (variant.kind === 'poster' || !variant.width) continue
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

/** 影片版位 → 檔案網址。 */
export function slotVideoSrc(slot: LiveMediaSlot | null | undefined): string | undefined {
  return slot && isMediaId(slot.media_id) ? mediaFileUrl(slot.media_id) : undefined
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

/** 首頁首屏照片：頁面 <img> 與 usePageSeo 的 preload 共用，才不會多下載一張。 */
export function heroImageAttrs(hero: Pick<HeroContent, 'heroImage' | 'heroImageMedia'>) {
  return pickImage(hero.heroImage, hero.heroImageMedia, HOME_HERO_SIZES)
}

/** 分校頁首屏照片（sizes 100vw）：頁面與 preload 共用。 */
export function campusHeroAttrs(campus: Pick<Campus, 'image' | 'imageMedia'>) {
  return pickImage(campus.image, campus.imageMedia)
}
