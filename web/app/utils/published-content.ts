import { publicCopy } from './public-copy'
import type { SiteContent } from '../types/site-content'
import { applyContentOverlay, type ContentOverlay } from './content-overlay'
import type { MediaInfoMap } from './media-image'

export interface LivePublicSite {
  schema_version: string
  release_id: string | null
  content: ContentOverlay
  /** 內容引用到的素材資訊（尺寸、衍生檔、預設焦點）；舊版 API 沒有 */
  media?: MediaInfoMap
}

export interface PublishedSite {
  schemaVersion: string
  releaseId: string
  content: SiteContent
}

export function publishedContent(fixture: SiteContent, live: LivePublicSite): PublishedSite {
  if (!live.release_id) throw new Error('尚無已發布內容')
  const content = applyContentOverlay(fixture, live.content, live.media ?? {})
  // 校區、頁尾連結與 sitemap 都使用同一 release 中已發布的 profile。
  content.campuses = content.campuses.filter((campus) => Boolean(live.content.campus_profile?.[campus.key]))
  content.isDemo = false
  return { schemaVersion: live.schema_version, releaseId: live.release_id, content: publicCopy(content) }
}
