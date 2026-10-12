// 官網關於頁「家長怎麼說」的內建家長分享影片：官網 web/server/data/site-fixture.json 各校的
// testimonials，影片編號、說的話、稱呼一字不差（campusTestimonials.test.ts 逐支比對）。
// 分校資料的 testimonials 是 null 時官網用這份；按「改成自訂」就把它帶進表單當起點。
// 目前只有義華有內建影片，其他四校是空清單。
import type { TestimonialPayload } from '../api/types'
import { youtubeIdOf } from './homeFilms'

/** 跟後端 content/schemas.TESTIMONIALS_MAX 相同。 */
export const TESTIMONIALS_MAX = 4
/** 跟後端 TestimonialPayload 的欄位上限相同。 */
export const TESTIMONIAL_URL_MAX = 300

interface BuiltinTestimonial {
  youtubeId: string
  quote: string
  speaker: string
}

const BUILTIN_TESTIMONIALS: Readonly<Record<string, readonly BuiltinTestimonial[]>> = {
  yihua: [
    { youtubeId: 'oaVMxHvquU0', quote: '老師把孩子放第一，不是把父母放第一。', speaker: '樂樂媽咪' },
    { youtubeId: 'U5kRPt7By90', quote: '幼幼班就自己走進去學校的背影，真的很感動。', speaker: '榕榕媽咪' },
    { youtubeId: '7yM201hNUc0', quote: '學校每日一本故事書，讓我的孩子愛上閱讀。', speaker: '祈祈爸比' },
    { youtubeId: 'B8qR0D4kLMU', quote: '孩子在進步！學校的用心，奶奶看得見。', speaker: '函函奶奶' },
  ],
}

/** 內建封面的檔名規則（web/public/assets/story-<校>-<影片編號小寫>.webp），影片編號對得上才有。 */
const BUILTIN_POSTERS: ReadonlyMap<string, string> = new Map(
  Object.entries(BUILTIN_TESTIMONIALS).flatMap(([campus, list]) =>
    list.map((t) => [t.youtubeId.toLowerCase(), `/assets/story-${campus}-${t.youtubeId.toLowerCase()}.webp`] as const),
  ),
)

/** 這一校官網現在內建的家長影片，轉成表單用的形狀（每次回傳新的一份，可以放心改）。 */
export function campusTestimonialsDraft(campusKey: string): TestimonialPayload[] {
  const list = Object.prototype.hasOwnProperty.call(BUILTIN_TESTIMONIALS, campusKey) ? BUILTIN_TESTIMONIALS[campusKey]! : []
  return list.map((t) => ({
    youtube_url: `https://www.youtube.com/watch?v=${t.youtubeId}`,
    quote: t.quote,
    speaker: t.speaker,
    poster: null,
    poster_alt: '',
  }))
}

/** 影片編號（不分大小寫）對得上內建那幾支時，官網沒選封面就用的內建封面網址；對不上回空字串。 */
export function builtinTestimonialPoster(youtubeId: string): string {
  return BUILTIN_POSTERS.get(youtubeId.toLowerCase()) ?? ''
}

export function newTestimonial(): TestimonialPayload {
  return { youtube_url: '', quote: '', speaker: '', poster: null, poster_alt: '' }
}

/** 影片網址欄的即時檢查（規則同後端 youtube_id）：沒填不提示（存檔時後端擋），沒問題回空字串。 */
export function testimonialUrlError(value: string): string {
  const text = value.trim()
  if (!text) return ''
  if (text.length > TESTIMONIAL_URL_MAX) return `網址太長，最多 ${TESTIMONIAL_URL_MAX} 字`
  return youtubeIdOf(text) ? '' : '看不出 YouTube 影片編號'
}
