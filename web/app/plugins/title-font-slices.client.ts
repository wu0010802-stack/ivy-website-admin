import fontManifest from '../generated/font-manifest.json'
import { attachTitleFontStylesheet } from '../utils/title-fonts'

// 標題字 LINE Seed TW 其餘分片的 @font-face（見 utils/title-fonts.ts）；沒有 JS 時那些字退回系統字。
export default defineNuxtPlugin(() => {
  attachTitleFontStylesheet(document, fontManifest.stylesheet.src)
})
