import type { SiteContent } from '~/types/site-content'
import type { ContentOverlay } from '~/utils/content-overlay'
import { applyContentOverlay } from '~/utils/content-overlay'

interface MeResponse {
  csrf_token: string
  user: { id: string; email: string; role: string; is_active: boolean; campus_keys: string[] }
}

interface ContentRevisionOut {
  id: string
  version: number
  payload: Record<string, unknown>
  created_at: string
}

interface ContentItemOut {
  id: string
  kind: keyof ContentOverlay
  campus_key: string | null
  latest_version: number
  current_published_revision_id: string | null
  latest_revision: ContentRevisionOut | null
}

export interface DraftPreviewResult {
  authorized: boolean
  content: SiteContent | null
}

/**
 * `/preview` 專用：只在瀏覽器端執行（client-only），先確認目前瀏覽器
 * 帶的是不是有效的管理員 session（打 `/auth/me`，401 就視為未授權，
 * 不嘗試繞過或猜測），再讀已登入才能看的 `/admin/content-items/{kind}`
 * 取「最新一版 revision」（可能還沒發布），疊在 fixture 上顯示草稿。
 *
 * 疊資料用跟 `usePublishedSite` 同一支 `applyContentOverlay`：那邊疊的
 * 是「已發布」內容，這裡疊的是「最新未發布」內容，形狀完全一樣。
 *
 * 目前 CONTENT_KIND_REGISTRY 只有 home_about/home_hero/site_footer 三種
 * kind 真的接了後端（其餘內容仍是 fixture），所以這裡也只疊這三項——
 * 這是後端目前的真實能力範圍，不是刻意漏掉。
 */
export async function useDraftPreview(): Promise<DraftPreviewResult> {
  const content = await $fetch<SiteContent>('/api/site-fixture')

  let me: MeResponse
  try {
    me = await $fetch<MeResponse>('/api/website/v1/auth/me')
  } catch {
    return { authorized: false, content: null }
  }
  if (!me?.user?.is_active) {
    return { authorized: false, content: null }
  }

  const kinds: Array<keyof ContentOverlay> = ['home_about', 'home_hero', 'site_footer']

  const items = await Promise.all(
    kinds.map((kind) =>
      $fetch<ContentItemOut>(`/api/website/v1/admin/content-items/${kind}`).catch(() => null)
    )
  )

  const overlay: ContentOverlay = {}
  for (const item of items) {
    const draft = item?.latest_revision?.payload
    if (!draft || !item) continue
    if (item.kind === 'home_about') overlay.home_about = draft as unknown as ContentOverlay['home_about']
    else if (item.kind === 'home_hero') overlay.home_hero = draft as unknown as ContentOverlay['home_hero']
    else if (item.kind === 'site_footer') overlay.site_footer = draft as unknown as ContentOverlay['site_footer']
  }

  return { authorized: true, content: applyContentOverlay(content, overlay) }
}
