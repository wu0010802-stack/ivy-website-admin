/**
 * 首屏資源提示（字型與首屏照片的 `<link rel="preload">`）在 `<head>` 裡的排序權重（2026-11-27）。
 *
 * unhead 的預設權重：inline `<style>` 與 stylesheet 是 60、preload 是 70。`features.inlineStyles` 開著，
 * Nuxt 把各頁約 136 KB 的樣式 inline 進 `<head>`，預載全部排在它們後面：手機 1.6 Mbps 要多等 0.5–0.7 秒
 * 才讀到預載、開始抓首屏照片。數字型 tagPriority 直接取代權重，40 排在 charset／viewport／title 之後、
 * 所有樣式之前（也在 motion-layout 這類 critical inline script 的 42 之前，那支只是設 data 屬性，位置不影響）。
 *
 * 同機 HTTP/2、390×844、1.6 Mbps／150 ms、CPU 4×，各 4 次中位數：LCP 首頁 1988→1736、環境 3108→2672、
 * 特色教學 2608→2480、入學 2044→1928 ms，/about 持平；FCP 晚 0–80 ms（照片提早和 HTML 後段分頻寬）。
 * 只給首屏一定用到的預載；其他 preload／modulepreload 照 unhead 預設。
 */
export const EARLY_PRELOAD_PRIORITY = 40
