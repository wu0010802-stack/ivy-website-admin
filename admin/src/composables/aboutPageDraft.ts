// 關於常春藤頁的內建內容：官網 web/server/data/site-fixture.json 的 aboutPage，一字不差
// （aboutPage.test.ts 逐欄比對文字）。從未存過任何版本時編輯頁的表單就是它。照片版位是
// null／''＝官網內建照片與內建說明，形狀同後端 AboutPagePayload.model_dump()：表單換了照片又
// 改回內建時會寫回 null／''，初稿要先有這些鍵，快照才對得上，不會被當成「有未儲存的修改」。
import type { AboutPagePayload } from '../api/types'

// 沿革五站（同後端 content/page_schemas.py 的 ABOUT_MILESTONE_KEYS 與官網立體書的五站）。
export const ABOUT_MILESTONE_KEYS = ['yihua', 'minghua', 'chongde', 'international', 'renwu'] as const
export const ABOUT_CHAPTER_HINTS = ['第一章', '第二章', '第三章', '第四章（沒有家長分享影片時整章不出現）'] as const

// 官網內建照片的代號（web/public/assets/<代號>.webp，同 AboutContent.vue）。
export const ABOUT_BUILTIN_PHOTOS = { hero: 'about-hero', heroBack: 'about-curious', hope: 'about-together' } as const

// 官網實際裁切的比例（web/app/assets/css/about.css）：首屏大卡與後排小卡都在卡紙裡
// （.abk-card img 4:3；.abk-pop.is-back img 4:5 直式），各寬度一樣。紙房子窗戶（.abk-window）
// 沒有設比例，照片依本身比例顯示、不裁切，所以不放預覽。
export const ABOUT_PHOTO_PREVIEWS = {
  hero: [{ label: '官網裁切（4:3）', ratio: '4 / 3' }],
  heroBack: [{ label: '官網裁切（4:5 直式）', ratio: '4 / 5' }],
} as const

export function aboutPageDraft(): AboutPagePayload {
  return {
    hero_title: '從一間幼兒園，\n長成五所校園。',
    hero_lede: '1997 年，第一間常春藤在高雄義華路成立。近三十年來，我們守著同一份教育理念與專業保育，陪孩子過一段獨一無二的童年。',
    hero_caption: '把每個孩子，放在心上。',
    hero_photo: null,
    hero_photo_alt: '',
    hero_back_photo: null,
    hero_back_photo_alt: '',
    chapter_names: ['一路走來', '全人教育', '我們的期許', '家長怎麼說'],
    story_title: '近三十年，\n長出五所校園。',
    story_text: '我們秉持不變的教育理念，堅持專業的保育，也不斷精進、嘗試新的教學方式，努力為孩子營造安心的環境，讓每個孩子都擁有獨一無二的童年。',
    milestones: [
      { key: 'yihua', year: 1997, text: '第一間常春藤，在三民區義華路成立。' },
      { key: 'minghua', year: 2001, text: '走進左營區，有了第二所校園。' },
      { key: 'chongde', year: 2005, text: '左營區的第二所校園。' },
      { key: 'international', year: 2020, text: '在鳥松區球場路成立。' },
      { key: 'renwu', year: 2021, text: '第五所校園，在仁武區成立。' },
    ],
    whole_title: '六大領域，\n陪孩子完整長大。',
    whole_text: '秉持全人教育的精神，從「幼兒的發展」與「社會文化的期待」出發，以螺旋式的方式加深、加廣課程。',
    whole_fine: '六大領域彼此關聯、環環相扣，課程在跨領域的統整下同時進行，讓孩子在參與生活與活動的過程中全面發展。',
    whole_fine_source: '源自幼兒園教保活動課程大綱',
    hope_title: '孩子的第一所學校，\n也是第二個家。',
    hope_quotes: [
      '常春藤的孩子，沒有美艷的花朵，沒有引人的清香，卻擁有優美高雅的氣質。',
      '我們期許，常春藤的孩子，未來在名為全世界的舞台，展現自我、發光發熱。',
    ],
    hope_photo: null,
    hope_photo_alt: '',
    outro_title: '五所校園',
    outro_text: '三民、左營、鳥松、仁武，五所校園各有自己的樣子。拉一條書籤，看看那所校園。',
  }
}
