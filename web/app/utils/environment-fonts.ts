// 常春藤環境頁（2026-09-28 手繪版）專用字型：圓體 Chiron GoRound TC（標題 800、小標 700、內文 400，
// 可變字型）與手寫字芫荽 Iansui（便條、菜名、場景名）。scripts/subset-environment-fonts.py 產生：
// 本頁現有用字切成一片 critical（宣告在 assets/css/environment-fonts.css，跟著頁面 CSS 進來），
// 其餘字依字頻切成小片，宣告在帶雜湊的樣式表，這裡在執行時掛上（後台改了校園探索文字、用到新字時才下載）。
// 只有這一頁載入；其他分頁仍用 LINE Seed TW＋系統字。
import manifest from '../generated/environment-font-manifest.json'
import { attachTitleFontStylesheet } from './title-fonts'

/** 首屏就用得到的 critical 分片（圓體），頁面 <head> 預載。 */
export const ENVIRONMENT_FONT_PRELOAD: string[] = manifest.preload

/** 其餘分片的樣式表；已經掛過就沿用。 */
export function attachEnvironmentFontStylesheet(doc: Document): HTMLLinkElement {
  return attachTitleFontStylesheet(doc, manifest.stylesheet.src)
}
