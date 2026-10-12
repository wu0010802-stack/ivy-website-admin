import type { Campus, CampusTestimonial } from '~/types/site-content'

/** 關於頁第四章最多放幾支家長分享影片（右頁一張大卡紙＋後排三張）。 */
export const VOICES_LIMIT = 4

/** 一支家長影片，連同它所屬的校區（標校名、連到該校 YouTube 頻道用）。 */
export type Voice = CampusTestimonial & { campus: Campus }

/**
 * 五校輪流取：每校先取第 1 支，再輪第 2 支，依此類推，取滿 limit 支為止（校的順序照傳入的
 * campuses）。輪到的那一校沒有了就跳過。這樣一校影片再多也不會占滿整章；只有一校有影片時，
 * 結果就是那一校的前 limit 支。
 */
export function pickVoices(campuses: Campus[], limit: number = VOICES_LIMIT): Voice[] {
  const picked: Voice[] = []
  const rounds = Math.max(0, ...campuses.map((campus) => campus.testimonials?.length ?? 0))
  for (let round = 0; round < rounds && picked.length < limit; round += 1) {
    for (const campus of campuses) {
      const item = campus.testimonials?.[round]
      if (item && picked.length < limit) picked.push({ ...item, campus })
    }
  }
  return picked
}
