// 入學資訊頁（/admission）專用字型：明體 Noto Serif TC（護照印章 Black 900、小標 SemiBold 600，靜態子集）。
// scripts/subset-admission-fonts.py 產生：本頁現有用字切成一片 critical（宣告在 assets/css/admission-fonts.css，
// 跟著頁面 CSS 進來），900 印章字的其餘字依字頻切成小片，宣告在帶雜湊的樣式表，這裡在執行時掛上
// （後台改了入學資訊文字、用到新字時才下載）。只有這一頁載入；其他分頁仍用 LINE Seed TW＋系統字。
import manifest from '../generated/admission-font-manifest.json'
import { attachTitleFontStylesheet } from './title-fonts'

/** 首屏就用得到的 critical 分片（印章 Black 900），頁面 <head> 預載。 */
export const ADMISSION_FONT_PRELOAD: string[] = manifest.preload

/** 其餘分片的樣式表；已經掛過就沿用。 */
export function attachAdmissionFontStylesheet(doc: Document): HTMLLinkElement {
  return attachTitleFontStylesheet(doc, manifest.stylesheet.src)
}
