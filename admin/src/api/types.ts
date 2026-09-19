// UserOut/CampusOut/ContentItemOut/MediaAssetOut/MediaVariantOut 從後端
// 生成的 OpenAPI 型別重新匯出，避免手抄造成 drift；`npm run contract:check`
// 會偵測這份生成檔跟目前 API 是否一致。HomeAboutPayload 等各 kind 的
// payload 形狀後端目前收 dict、不是獨立 schema，暫時仍手抄維護（見下）。
import type { components } from '../../../contracts/generated/website-api'

export type Role = 'super_admin' | 'campus_admin' | 'editor' | 'reception' | 'readonly'
export type UserOut = components['schemas']['UserOut']
export type CampusOut = components['schemas']['CampusOut']

export const CAMPUS_KEYS = ['yihua', 'minghua', 'chongde', 'international', 'renwu'] as const

export interface HomeAboutPayload {
  title: string
  since_label: string
  body_text: string
  caption: string
}

export interface HomeHeroPayload {
  eyebrow: string
  copy_lines: string[]
  cta_label: string
}

export interface SiteFooterPayload {
  tagline: string
}

export type MediaKind = 'image' | 'video'
export type MediaStatus = 'processing' | 'ready' | 'failed'
export type VariantKind = 'thumbnail' | 'poster'

export type MediaVariantOut = components['schemas']['MediaVariantOut']
export type MediaAssetOut = components['schemas']['MediaAssetOut']
export type ContentItemOut = components['schemas']['ContentItemOut']
export type BookingConfigOut = components['schemas']['BookingConfigOut']
