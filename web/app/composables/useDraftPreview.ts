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
  kind: string
  campus_key: string | null
  latest_version: number
  current_published_revision_id: string | null
  latest_revision: ContentRevisionOut | null
}

export interface DraftPreviewResult {
  authorized: boolean
  content: SiteContent | null
}

type SharedKind = 'home_about' | 'home_hero' | 'site_footer' | 'site_meta' | 'home_campus_board' | 'booking_content' | 'day_experience' | 'home_news'
const SHARED_KINDS: SharedKind[] = [
  'home_about',
  'home_hero',
  'site_footer',
  'site_meta',
  'home_campus_board',
  'booking_content',
  'day_experience',
  'home_news'
]
type CampusKind = 'campus_profile' | 'campus_faq' | 'campus_tour'
const CAMPUS_KINDS: CampusKind[] = ['campus_profile', 'campus_faq', 'campus_tour']

/**
 * `/preview` 專用：只在瀏覽器端執行（client-only），先確認目前瀏覽器
 * 帶的是不是有效的管理員 session（打 `/auth/me`，401 就視為未授權，
 * 不嘗試繞過或猜測），再讀已登入才能看的 `/admin/content-items/{kind}`
 * 取「最新一版 revision」（可能還沒發布），疊在 fixture 上顯示草稿。
 *
 * 疊資料用跟 `usePublishedSite` 同一支 `applyContentOverlay`：那邊疊的
 * 是「已發布」內容，這裡疊的是「最新未發布」內容，形狀完全一樣。
 *
 * `campus_profile`／`campus_faq` 是每校各一份，`/admin/content-items`
 * 沒有一次拿全部校區的端點，所以逐校打（校區清單直接讀 fixture 現有的
 * `campuses`，不在這裡另外寫死一份清單，避免兩份清單以後漂移）。
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

  const overlay: ContentOverlay = {}

  const sharedItems = await Promise.all(
    SHARED_KINDS.map((kind) =>
      $fetch<ContentItemOut>(`/api/website/v1/admin/content-items/${kind}`).catch(() => null)
    )
  )
  for (const item of sharedItems) {
    const draft = item?.latest_revision?.payload
    if (!draft || !item) continue
    overlay[item.kind as SharedKind] = draft as never
  }

  const campusKeys = content.campuses.map((c) => c.key)
  for (const kind of CAMPUS_KINDS) {
    const perCampus = await Promise.all(
      campusKeys.map(async (campusKey) => {
        const campusItem = await $fetch<ContentItemOut>(
          `/api/website/v1/admin/content-items/${kind}?campus_key=${encodeURIComponent(campusKey)}`
        ).catch(() => null)
        return [campusKey, campusItem?.latest_revision?.payload ?? null] as const
      })
    )
    const map: Record<string, unknown> = {}
    for (const [campusKey, payload] of perCampus) {
      if (payload) map[campusKey] = payload
    }
    if (Object.keys(map).length > 0) {
      overlay[kind] = map as never
    }
  }

  return { authorized: true, content: applyContentOverlay(content, overlay) }
}
