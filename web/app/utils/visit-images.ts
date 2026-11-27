import type { Campus } from '~/types/site-content'
import { pickImage } from './media-image'
import { heroPreloadLink, responsiveImage } from './responsive-image'

/**
 * 預約頁的首屏照片（VisitForm.vue）與頁面的預載（pages/visit/[[key]].vue）共用同一份 attrs：
 * 預載的 imagesrcset／imagesizes 跟 `<img>` 不一致時，瀏覽器會多下載一張（2026-11-27）。
 *
 * 選校卡 sizes 的理由見 VisitForm.vue 的註解：手機是細條、DPR 2.5 以上估七成寬；761px 以上是 3:4 直框裁橫幅照。
 */
export const VISIT_CARD_SIZES = '(max-width: 760px) and (min-resolution: 2.5dppx) calc((100vw - 40px) * .7), (max-width: 760px) calc(100vw - 40px), (max-width: 960px) and (max-height: 500px) and (orientation: landscape) calc(50vw - 28px), (max-width: 960px) 77vw, 620px'
/** 第二步（/visit/<校>）左欄所選校園的小照片 */
export const VISIT_ASIDE_SIZES = '(max-width: 960px) 96px, 420px'
/** 第一步迎賓區的照片（內建，後台不能換） */
export const VISIT_WELCOME_IMAGE = 'about-curious'
export const VISIT_WELCOME_SIZES = '(max-width: 760px) 50vw, (max-width: 960px) calc(100vw - 64px), min(52vw, 710px)'

/**
 * 各張預載只在它是 LCP 的寬度下載（正式站 2026-11-26 量）：
 * - 第一張選校卡：手機（≤760）是 LCP，原本要等 HTML 後段的 `<img fetchpriority=high>` 才開始抓，1.6 Mbps 下 LCP 2.9 s。
 * - 迎賓照：桌機與平板是 LCP；橫拿手機（≤960 寬、≤500 高、landscape）換成 1×1 透明圖不顯示，所以用
 *   「≥961 寬，或 ≥761 寬且 ≥501 高」排除它（直拿時寬 ≥761 的高一定大於 500）。
 * - 第二步左欄照片：桌機（≥961）是 LCP；以下是 96px 小圖，LCP 是文字。
 */
export const VISIT_CARD_PRELOAD_MEDIA = '(max-width: 760px)'
export const VISIT_WELCOME_PRELOAD_MEDIA = '(min-width: 961px), (min-width: 761px) and (min-height: 501px)'
export const VISIT_ASIDE_PRELOAD_MEDIA = '(min-width: 961px)'

type CampusImage = Pick<Campus, 'image' | 'imageMedia'>

export const visitCardImage = (campus: CampusImage) => pickImage(campus.image, campus.imageMedia, VISIT_CARD_SIZES)
export const visitAsideImage = (campus: CampusImage) => pickImage(campus.image, campus.imageMedia, VISIT_ASIDE_SIZES)
export const visitWelcomeImage = () => responsiveImage(VISIT_WELCOME_IMAGE, VISIT_WELCOME_SIZES)

/** 第一步（selected 未定）預載第一張選校卡與迎賓照；第二步預載左欄照片。 */
export function visitImagePreloads(campuses: readonly CampusImage[], selected?: CampusImage) {
  if (selected) return [{ ...heroPreloadLink(visitAsideImage(selected)), media: VISIT_ASIDE_PRELOAD_MEDIA }]
  const first = campuses[0]
  return [
    ...(first ? [{ ...heroPreloadLink(visitCardImage(first)), media: VISIT_CARD_PRELOAD_MEDIA }] : []),
    { ...heroPreloadLink(visitWelcomeImage()), media: VISIT_WELCOME_PRELOAD_MEDIA }
  ]
}
