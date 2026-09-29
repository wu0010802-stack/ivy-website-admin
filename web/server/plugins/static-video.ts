import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createStaticVideoHandler, installFirst } from '../utils/static-video'

// web/public 的 mp4 改由 utils/static-video.ts 串流（Range＋背壓），排在
// nitro 靜態資源處理器之前。nuxt dev 的靜態檔由 dev server 另外處理，這裡
// 找不到檔案就交回原本的流程。
export default defineNitroPlugin((nitroApp) => {
  // public 目錄要等第一個請求才算：正式建置時 nitro 把 import.meta.url 換成
  // globalThis._importMeta_.url，入口 .output/server/index.mjs 要等它 import
  // 的模組（含這個 plugin）都執行完才設定真值；plugin 執行當下拿到的還是
  // file:///_entry.js。請求進來時已經是入口網址，public 在 .output/public
  // （nitro 自己的 readAsset 也是在請求時才讀）。
  const publicDir = () => resolve(dirname(fileURLToPath(import.meta.url)), '../public')
  // 這一層在 route rules handler 之前，/assets/** 的快取標頭要自己套。
  installFirst(nitroApp.h3App, createStaticVideoHandler(publicDir, event => getRouteRules(event).headers))
})
